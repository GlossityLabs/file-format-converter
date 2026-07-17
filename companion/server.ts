import { createReadStream } from 'node:fs';
import { mkdir, open, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { detectTools, publicToolCapability } from './capabilities.js';
import { loadRuntimeOptions } from './config.js';
import {
  SERVICE_NAME,
  SERVICE_VERSION,
  isFormatId,
  isQualityPreset,
  type DetectedTools,
  type InternalJob,
  type RuntimeOptions,
} from './contracts.js';
import { JobManager } from './jobs.js';
import { ALLOWED_RECIPES, findRecipe } from './recipes.js';
import {
  bearerTokenFromHeader,
  contentDisposition,
  fileNameMatchesFormat,
  isOriginAllowed,
  loadOrCreatePairingToken,
  magicMatchesFormat,
  resolveConfiguredPairingToken,
  sanitizeFileName,
  tokensMatch,
} from './security.js';

const ALLOWED_METHODS = 'GET, POST, DELETE, OPTIONS';
const ALLOWED_HEADERS = [
  'authorization',
  'content-type',
  'x-file-name',
  'x-input-format',
  'x-output-format',
  'x-quality-preset',
] as const;

const MIME_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  csv: 'text/csv',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  m4v: 'video/x-m4v',
  gif: 'image/gif',
};

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class PayloadTooLargeError extends HttpError {
  constructor() {
    super(413, 'payload_too_large', 'The file exceeds the local companion size limit.');
  }
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function sendError(response: ServerResponse, error: HttpError): void {
  sendJson(response, error.status, {
    error: { code: error.code, message: error.message },
  });
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function validateCors(
  request: IncomingMessage,
  response: ServerResponse,
  options: RuntimeOptions,
): boolean {
  const origin = singleHeader(request, 'origin');
  if (!isOriginAllowed(origin, options.allowedExtensionIds, options.allowedDevOrigins)) {
    sendError(response, new HttpError(403, 'origin_forbidden', 'This browser origin is not allowed.'));
    return false;
  }

  response.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    response.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(', '));
    response.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Disposition, Content-Length, Content-Type',
    );
    response.setHeader('Access-Control-Max-Age', '600');
  }

  if (request.method !== 'OPTIONS') return true;
  const requestedMethod = singleHeader(request, 'access-control-request-method')?.toUpperCase();
  if (requestedMethod && !ALLOWED_METHODS.split(', ').includes(requestedMethod)) {
    sendError(response, new HttpError(405, 'method_not_allowed', 'The requested method is not allowed.'));
    return false;
  }
  const requestedHeaders = (singleHeader(request, 'access-control-request-headers') ?? '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some((header) => !(ALLOWED_HEADERS as readonly string[]).includes(header))) {
    sendError(response, new HttpError(403, 'headers_forbidden', 'A requested header is not allowed.'));
    return false;
  }
  if (singleHeader(request, 'access-control-request-private-network') === 'true') {
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  response.writeHead(204);
  response.end();
  return false;
}

function requireAuthentication(request: IncomingMessage, pairingToken: string): void {
  const provided = bearerTokenFromHeader(singleHeader(request, 'authorization'));
  if (!tokensMatch(provided, pairingToken)) {
    throw new HttpError(401, 'unauthorized', 'A valid companion pairing token is required.');
  }
}

function documentUploadLimit(options: RuntimeOptions): number {
  return Math.min(options.limits.maxUploadBytes, 256 * 1024 * 1024);
}

function uploadLimitForJob(job: InternalJob, options: RuntimeOptions): number {
  const recipe = findRecipe(job.inputFormat, job.outputFormat);
  return recipe?.requires === 'libreoffice'
    ? documentUploadLimit(options)
    : options.limits.maxUploadBytes;
}

async function streamUpload(
  request: IncomingMessage,
  job: InternalJob,
  maximumBytes: number,
): Promise<{ bytes: number; prefix: Buffer }> {
  const contentLengthValue = singleHeader(request, 'content-length');
  if (contentLengthValue !== undefined) {
    const contentLength = Number(contentLengthValue);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new HttpError(400, 'invalid_content_length', 'The Content-Length header is invalid.');
    }
    if (contentLength > maximumBytes) throw new PayloadTooLargeError();
  }

  const handle = await open(job.inputPath, 'wx', 0o600);
  let bytes = 0;
  let prefix = Buffer.alloc(0);
  try {
    for await (const value of request) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
      bytes += chunk.length;
      if (bytes > maximumBytes) throw new PayloadTooLargeError();
      if (prefix.length < 32) {
        prefix = Buffer.concat([prefix, chunk.subarray(0, 32 - prefix.length)]);
      }
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  if (!request.complete) {
    throw new HttpError(400, 'incomplete_upload', 'The local upload was interrupted.');
  }
  if (bytes === 0) throw new HttpError(400, 'empty_file', 'The file is empty.');
  return { bytes, prefix };
}

function capabilityResponse(
  tools: DetectedTools,
  options: RuntimeOptions,
  paired: boolean,
): object {
  return {
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    paired,
    tools: {
      ffmpeg: publicToolCapability(tools.ffmpeg),
      ffprobe: publicToolCapability(tools.ffprobe),
      libreoffice: publicToolCapability(tools.libreoffice),
      poppler: publicToolCapability(tools.poppler),
    },
    recipes: ALLOWED_RECIPES.map((recipe) => ({
      ...recipe,
      available:
        recipe.requires === 'ffmpeg'
          ? tools.ffmpeg.available
          : recipe.requires === 'libreoffice'
            ? tools.libreoffice.available
            : tools.poppler.available,
    })),
    limits: {
      maxUploadBytes: options.limits.maxUploadBytes,
      maxDocumentUploadBytes: documentUploadLimit(options),
      maxConcurrentJobs: options.limits.maxConcurrentJobs,
      maxRetainedJobs: options.limits.maxRetainedJobs,
      jobTtlSeconds: Math.floor(options.limits.jobTtlMs / 1_000),
    },
  };
}

async function handleCreateJob(
  request: IncomingMessage,
  response: ServerResponse,
  manager: JobManager,
  tools: DetectedTools,
  options: RuntimeOptions,
): Promise<void> {
  if (!manager.canAccept()) {
    throw new HttpError(503, 'queue_full', 'The local companion job queue is full.');
  }

  const inputValue = singleHeader(request, 'x-input-format')?.trim().toLowerCase() ?? '';
  const outputValue = singleHeader(request, 'x-output-format')?.trim().toLowerCase() ?? '';
  const presetValue = singleHeader(request, 'x-quality-preset')?.trim().toLowerCase() || 'balanced';
  const rawFileName = singleHeader(request, 'x-file-name')?.trim() ?? '';
  if (!isFormatId(inputValue) || !isFormatId(outputValue)) {
    throw new HttpError(400, 'invalid_format', 'Input and output formats must be supported format IDs.');
  }
  if (!isQualityPreset(presetValue)) {
    throw new HttpError(400, 'invalid_preset', 'The requested quality preset is invalid.');
  }
  if (rawFileName.length === 0 || rawFileName.length > 1_024) {
    throw new HttpError(400, 'invalid_file_name', 'A valid X-File-Name header is required.');
  }
  if (!fileNameMatchesFormat(rawFileName, inputValue)) {
    throw new HttpError(
      400,
      'extension_mismatch',
      'The filename extension does not match X-Input-Format.',
    );
  }

  const recipe = findRecipe(inputValue, outputValue);
  if (!recipe) {
    throw new HttpError(422, 'recipe_not_allowed', 'This conversion recipe is not supported.');
  }
  const requiredTool = recipe.requires === 'libreoffice' ? tools.libreoffice : tools.ffmpeg;
  if (!requiredTool.available) {
    throw new HttpError(409, 'tool_unavailable', 'The required local conversion tool is unavailable.');
  }

  const job = await manager.create({
    inputFormat: inputValue,
    outputFormat: outputValue,
    preset: presetValue,
    fileName: sanitizeFileName(rawFileName),
  });
  try {
    const upload = await streamUpload(request, job, uploadLimitForJob(job, options));
    const magicMatch = magicMatchesFormat(upload.prefix, inputValue);
    if (magicMatch === false) {
      throw new HttpError(
        415,
        'content_mismatch',
        'The file content does not match the declared input format.',
      );
    }
    const result = manager.commitUpload(job, upload.bytes);
    sendJson(response, 202, { job: result });
  } catch (error) {
    request.resume();
    await manager.discardUpload(job);
    throw error;
  }
}

async function handleOutput(
  response: ServerResponse,
  manager: JobManager,
  id: string,
): Promise<void> {
  const job = manager.getInternal(id);
  if (!job) throw new HttpError(404, 'job_not_found', 'The conversion job was not found.');
  if (job.state !== 'complete') {
    throw new HttpError(409, 'output_not_ready', 'The conversion output is not ready.');
  }
  const output = await stat(job.outputPath).catch(() => undefined);
  if (!output?.isFile()) {
    throw new HttpError(410, 'output_expired', 'The conversion output is no longer available.');
  }

  response.writeHead(200, {
    'Content-Type': MIME_TYPES[job.outputFormat] ?? 'application/octet-stream',
    'Content-Length': output.size,
    'Content-Disposition': contentDisposition(job.outputName),
  });
  await new Promise<void>((resolveStream, rejectStream) => {
    const stream = createReadStream(job.outputPath);
    stream.once('error', rejectStream);
    stream.once('end', resolveStream);
    response.once('close', resolveStream);
    stream.pipe(response);
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  manager: JobManager,
  tools: DetectedTools,
  options: RuntimeOptions,
  pairingToken: string,
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${options.host}:${options.port}`);
  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      status: 'ok',
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/v1/capabilities') {
    const suppliedToken = bearerTokenFromHeader(singleHeader(request, 'authorization'));
    sendJson(response, 200, capabilityResponse(tools, options, tokensMatch(suppliedToken, pairingToken)));
    return;
  }

  if (url.pathname.startsWith('/v1/jobs')) requireAuthentication(request, pairingToken);
  if (request.method === 'POST' && url.pathname === '/v1/jobs') {
    await handleCreateJob(request, response, manager, tools, options);
    return;
  }

  const jobMatch = /^\/v1\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\/output)?$/.exec(
    url.pathname,
  );
  if (jobMatch && request.method === 'GET' && jobMatch[2] === '/output') {
    await handleOutput(response, manager, jobMatch[1]);
    return;
  }
  if (jobMatch && request.method === 'GET' && !jobMatch[2]) {
    const job = manager.get(jobMatch[1]);
    if (!job) throw new HttpError(404, 'job_not_found', 'The conversion job was not found.');
    sendJson(response, 200, { job });
    return;
  }
  if (jobMatch && request.method === 'DELETE' && !jobMatch[2]) {
    const job = await manager.cancel(jobMatch[1]);
    if (!job) throw new HttpError(404, 'job_not_found', 'The conversion job was not found.');
    sendJson(response, 200, { job });
    return;
  }

  throw new HttpError(404, 'not_found', 'The requested companion endpoint does not exist.');
}

export interface CompanionService {
  readonly server: Server;
  readonly options: RuntimeOptions;
  readonly tokenFile: string;
  readonly port: number;
  start(): Promise<void>;
  close(): Promise<void>;
}

export async function createCompanionService(
  overrides: Partial<RuntimeOptions> = {},
): Promise<CompanionService> {
  const options = loadRuntimeOptions(overrides);
  await mkdir(options.tempDirectory, { recursive: true, mode: 0o700 });
  const configuredToken = resolveConfiguredPairingToken(options.pairingToken);
  const pairingToken = configuredToken ?? (await loadOrCreatePairingToken(options.tokenFile));
  const tools = await detectTools();
  const manager = new JobManager(tools, options);

  const server = createServer((request, response) => {
    setSecurityHeaders(response);
    if (!validateCors(request, response, options)) return;
    void routeRequest(request, response, manager, tools, options, pairingToken).catch((error) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof HttpError) sendError(response, error);
      else sendError(response, new HttpError(500, 'internal_error', 'The companion request failed.'));
    });
  });
  server.requestTimeout = 10 * 60 * 1_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 32;

  let started = false;
  return {
    server,
    options,
    tokenFile: options.tokenFile,
    get port(): number {
      const address = server.address();
      return address && typeof address !== 'string' ? (address as AddressInfo).port : options.port;
    },
    async start(): Promise<void> {
      if (started) return;
      await new Promise<void>((resolveListen, rejectListen) => {
        const onError = (error: Error): void => rejectListen(error);
        server.once('error', onError);
        server.listen(options.port, options.host, () => {
          server.off('error', onError);
          started = true;
          resolveListen();
        });
      });
    },
    async close(): Promise<void> {
      await manager.close();
      if (!started) return;
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
      started = false;
    },
  };
}

async function main(): Promise<void> {
  const service = await createCompanionService();
  await service.start();
  // This intentionally contains neither the pairing secret nor uploaded filenames.
  console.info(`Format Forge Companion listening on http://127.0.0.1:${service.port}`);
  console.info(
    service.options.pairingToken
      ? 'Pairing token is configured by FORMAT_FORGE_TOKEN; run the token command to display it.'
      : `Pairing token file: ${service.tokenFile} (or run the token command to display it).`,
  );

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    void service.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const isEntryPoint =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isEntryPoint) {
  void main().catch(() => {
    // Keep native paths and secrets out of stderr. Configuration errors are
    // intentionally summarized for a desktop-friendly failure mode.
    console.error('Format Forge Companion could not start. Check its configuration and port.');
    process.exitCode = 1;
  });
}
