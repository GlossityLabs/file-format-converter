import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const ORIGIN_PATTERN = /^chrome-extension:\/\/([a-p]{32})\/?$/;
const nativeHostDirectory = dirname(fileURLToPath(import.meta.url));
const resourcesDirectory = resolve(nativeHostDirectory, '..');
const companionDirectory = join(resourcesDirectory, 'companion');

interface CompanionOptions {
  host: string;
  port: number;
}

interface ConfigModule {
  loadRuntimeOptions(): CompanionOptions;
}

interface TokenModule {
  readPairingToken(): Promise<string>;
}

interface ContractsModule {
  SERVICE_VERSION: string;
  API_VERSION: number;
}

interface CapabilitiesResponse {
  service: string;
  version: string;
  apiVersion?: number;
}

interface NativeResponse {
  type: 'bootstrapResult' | 'bootstrapError';
  protocolVersion: 1;
  baseUrl?: string;
  token?: string;
  service?: string;
  version?: string;
  apiVersion?: number;
  code?: 'invalid_request' | 'engine_unavailable' | 'version_conflict' | 'internal_error';
  message?: string;
}

async function importCompanionFile<T>(fileName: string): Promise<T> {
  return (await import(pathToFileURL(join(companionDirectory, fileName)).href)) as T;
}

function encodeMessage(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > MAX_MESSAGE_BYTES) throw new Error('Native response is too large.');
  const frame = Buffer.allocUnsafe(body.length + 4);
  frame.writeUInt32LE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

class Decoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Uint8Array): unknown[] {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    const messages: unknown[] = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length > MAX_MESSAGE_BYTES) throw new Error('Native request is too large.');
      if (this.buffer.length < length + 4) break;
      messages.push(JSON.parse(this.buffer.subarray(4, length + 4).toString('utf8')) as unknown);
      this.buffer = this.buffer.subarray(length + 4);
    }
    return messages;
  }

  finish(): void {
    if (this.buffer.length > 0) throw new Error('Native request frame is incomplete.');
  }
}

function isBootstrapRequest(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Record<string, unknown>;
  return request.type === 'bootstrap' && request.protocolVersion === PROTOCOL_VERSION;
}

async function writeResponse(response: NativeResponse): Promise<void> {
  const frame = encodeMessage(response);
  await new Promise<void>((resolveWrite, rejectWrite) => {
    process.stdout.write(frame, (error) => (error ? rejectWrite(error) : resolveWrite()));
  });
}

async function engineIsReady(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(750) });
    return response.ok;
  } catch {
    return false;
  }
}

function launchDesktopEngine(sourceOrigin: string): void {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    FORMAT_FORGE_ALLOWED_ORIGINS: sourceOrigin.replace(/\/$/, ''),
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(process.execPath, ['--engine-only'], {
    detached: true,
    stdio: 'ignore',
    env: environment,
  });
  child.unref();
}

async function bootstrap(sourceOrigin: string): Promise<NativeResponse> {
  const configModule = await importCompanionFile<ConfigModule>('config.js');
  const options = configModule.loadRuntimeOptions();
  const baseUrl = `http://${options.host}:${options.port}`;

  if (!(await engineIsReady(baseUrl))) {
    launchDesktopEngine(sourceOrigin);
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline && !(await engineIsReady(baseUrl))) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
  if (!(await engineIsReady(baseUrl))) {
    return {
      type: 'bootstrapError',
      protocolVersion: PROTOCOL_VERSION,
      code: 'engine_unavailable',
      message: 'The local engine did not become ready. Open Format Forge and try again.',
    };
  }

  const tokenModule = await importCompanionFile<TokenModule>('token.js');
  const token = await tokenModule.readPairingToken();
  const response = await fetch(`${baseUrl}/v1/capabilities`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    return {
      type: 'bootstrapError',
      protocolVersion: PROTOCOL_VERSION,
      code: 'engine_unavailable',
      message: 'The engine started but Chrome could not verify its capabilities.',
    };
  }
  const capabilities = (await response.json()) as CapabilitiesResponse;
  if (capabilities.service !== 'format-forge-companion' || !capabilities.version) {
    return {
      type: 'bootstrapError',
      protocolVersion: PROTOCOL_VERSION,
      code: 'engine_unavailable',
      message: 'Chrome found an unexpected service on the local engine connection.',
    };
  }
  const contractsModule = await importCompanionFile<ContractsModule>('contracts.js');
  if (capabilities.version !== contractsModule.SERVICE_VERSION) {
    return {
      type: 'bootstrapError',
      protocolVersion: PROTOCOL_VERSION,
      code: 'version_conflict',
      message: `Format Forge ${capabilities.version} is still running, but Chrome started ${contractsModule.SERVICE_VERSION}. Restart Format Forge to finish the update.`,
    };
  }
  if (
    capabilities.apiVersion !== undefined
    && capabilities.apiVersion !== contractsModule.API_VERSION
  ) {
    return {
      type: 'bootstrapError',
      protocolVersion: PROTOCOL_VERSION,
      code: 'version_conflict',
      message: 'The running Local Engine is incompatible with this Format Forge app. Restart Format Forge to finish the update.',
    };
  }
  return {
    type: 'bootstrapResult',
    protocolVersion: PROTOCOL_VERSION,
    baseUrl,
    token,
    service: 'format-forge-companion',
    version: capabilities.version,
    apiVersion: contractsModule.API_VERSION,
  };
}

async function responseFor(value: unknown, sourceOrigin: string): Promise<NativeResponse> {
  if (!isBootstrapRequest(value)) {
    return {
      type: 'bootstrapError',
      protocolVersion: PROTOCOL_VERSION,
      code: 'invalid_request',
      message: 'The browser requested an unsupported native-host operation.',
    };
  }
  try {
    return await bootstrap(sourceOrigin);
  } catch {
    return {
      type: 'bootstrapError',
      protocolVersion: PROTOCOL_VERSION,
      code: 'internal_error',
      message: 'The Format Forge native connection failed.',
    };
  }
}

async function main(): Promise<void> {
  const sourceOrigin = process.argv.find((argument) => ORIGIN_PATTERN.test(argument));
  if (!sourceOrigin) {
    await writeResponse({
      type: 'bootstrapError',
      protocolVersion: PROTOCOL_VERSION,
      code: 'invalid_request',
      message: 'The native host was not started by a Chrome extension.',
    });
    return;
  }

  const normalizedOrigin = sourceOrigin.replace(/\/$/, '');
  const decoder = new Decoder();
  for await (const chunk of process.stdin) {
    for (const request of decoder.push(chunk as Buffer)) {
      await writeResponse(await responseFor(request, normalizedOrigin));
    }
  }
  decoder.finish();
}

void main().catch(async () => {
  await writeResponse({
    type: 'bootstrapError',
    protocolVersion: PROTOCOL_VERSION,
    code: 'internal_error',
    message: 'The Format Forge native connection failed.',
  }).catch(() => undefined);
  process.exitCode = 1;
});
