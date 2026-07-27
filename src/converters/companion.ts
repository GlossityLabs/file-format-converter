import type {
  CompanionCapabilities,
  ConversionProgress,
  ConversionResult,
  FormatId,
  QualityPreset,
} from '../core/types';
import { makeOutputFileName, sanitizeFileName } from '../core/filenames';

export const DEFAULT_COMPANION_URL = 'http://127.0.0.1:43123';
export const COMPANION_NATIVE_HOST = 'com.glossitylabs.formatforge';
export const COMPANION_NATIVE_PROTOCOL_VERSION = 1 as const;
export const COMPANION_API_VERSION = 1;
export const MINIMUM_COMPANION_VERSION = '0.1.1';
export const COMPANION_STORAGE_KEYS = Object.freeze({
  token: 'formatForge.companion.token',
  baseUrl: 'formatForge.companion.baseUrl',
});

const COMPANION_SERVICE_NAME = 'format-forge-companion';
const LOOPBACK_URL_PATTERN = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i;
const NATIVE_BOOTSTRAP_URL_PATTERN = /^http:\/\/127\.0\.0\.1(?::\d+)?$/;
const PAIRING_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,256}$/;

export interface CompanionBootstrapRequest {
  type: 'bootstrap';
  protocolVersion: typeof COMPANION_NATIVE_PROTOCOL_VERSION;
}

export interface CompanionBootstrapResponse {
  type: 'bootstrapResult';
  protocolVersion: typeof COMPANION_NATIVE_PROTOCOL_VERSION;
  baseUrl: string;
  token: string;
  service: typeof COMPANION_SERVICE_NAME;
  version: string;
  apiVersion: number;
}

export interface CompanionBootstrapErrorResponse {
  type: 'bootstrapError';
  protocolVersion: typeof COMPANION_NATIVE_PROTOCOL_VERSION;
  code: 'invalid_request' | 'engine_unavailable' | 'version_conflict' | 'internal_error';
  message: string;
}

export type NativeMessenger = (
  hostName: string,
  message: CompanionBootstrapRequest,
) => Promise<unknown>;

export type CompanionJobState = 'queued' | 'converting' | 'finalizing' | 'complete' | 'failed' | 'canceled';

export interface CompanionJob {
  id: string;
  state: CompanionJobState;
  progress: number;
  outputName?: string;
  sizeBytes?: number;
  error?: string;
}

export interface CreateCompanionJobOptions {
  inputFormat: FormatId;
  outputFormat: FormatId;
  preset?: QualityPreset;
  signal?: AbortSignal;
}

export interface CompanionConversionOptions extends CreateCompanionJobOptions {
  onProgress?: (progress: ConversionProgress) => void;
}

export class CompanionApiError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'CompanionApiError';
    this.status = status;
    this.code = code;
  }
}

interface StorageAdapter {
  get(keys: readonly string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
}

const memoryStorage = new Map<string, unknown>();

function browserLocalStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  if (typeof process !== 'undefined' && process.versions?.node) return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function fallbackStorage(): StorageAdapter {
  return {
    async get(keys) {
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        try {
          const localValue = browserLocalStorage()?.getItem(key);
          if (localValue !== null && localValue !== undefined) result[key] = localValue;
          else if (memoryStorage.has(key)) result[key] = memoryStorage.get(key);
        } catch {
          if (memoryStorage.has(key)) result[key] = memoryStorage.get(key);
        }
      }
      return result;
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) {
        memoryStorage.set(key, value);
        try {
          browserLocalStorage()?.setItem(key, String(value));
        } catch {
          // Memory storage keeps local development and privacy-restricted browsers working.
        }
      }
    },
    async remove(keys) {
      for (const key of keys) {
        memoryStorage.delete(key);
        try {
          browserLocalStorage()?.removeItem(key);
        } catch {
          // Memory storage was still cleared.
        }
      }
    },
  };
}

function chromeStorage(): StorageAdapter | undefined {
  const area = globalThis.chrome?.storage?.local;
  if (!area) return undefined;
  return {
    async get(keys) {
      return area.get([...keys]);
    },
    async set(values) {
      await area.set(values);
    },
    async remove(keys) {
      await area.remove([...keys]);
    },
  };
}

async function withStorageFallback<T>(operation: (storage: StorageAdapter) => Promise<T>): Promise<T> {
  const primary = chromeStorage();
  if (primary) {
    try {
      return await operation(primary);
    } catch {
      // Extension APIs may be unavailable in Vite dev pages; use the local adapter below.
    }
  }
  return operation(fallbackStorage());
}

async function responseError(response: Response): Promise<CompanionApiError> {
  let detail = '';
  let code: string | undefined;
  try {
    const body = (await response.clone().json()) as {
      error?: string | { code?: string; message?: string };
      message?: string;
    };
    detail = typeof body.error === 'string' ? body.error : body.error?.message ?? body.message ?? '';
    code = typeof body.error === 'object' ? body.error?.code : undefined;
  } catch {
    try {
      detail = (await response.text()).trim();
    } catch {
      // Fall through to the status description.
    }
  }
  if (code === 'tool_unavailable') {
    return new CompanionApiError(
      detail || 'This conversion needs a tool that is not ready in the Format Forge Mac app.',
      response.status,
      code,
    );
  }
  const suffix = detail ? `: ${detail}` : '';
  return new CompanionApiError(
    `The local companion returned ${response.status} ${response.statusText || 'request error'}${suffix}`,
    response.status,
    code,
  );
}

function parseDownloadName(header: string | null): string | undefined {
  if (!header) return undefined;
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = header.match(/filename="?([^";]+)"?/i)?.[1];
  const encoded = utf8 ?? plain;
  if (!encoded) return undefined;
  try {
    return sanitizeFileName(decodeURIComponent(encoded));
  } catch {
    return sanitizeFileName(encoded);
  }
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Conversion canceled.', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException('Conversion canceled.', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function nativeMessagingError(message: string, code?: string): CompanionApiError {
  return new CompanionApiError(`Could not connect to the Format Forge app: ${message}`, undefined, code);
}

function defaultNativeMessenger(
  hostName: string,
  message: CompanionBootstrapRequest,
): Promise<unknown> {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendNativeMessage) {
    return Promise.reject(nativeMessagingError('the Mac app is not available in this browser.'));
  }

  return new Promise((resolve, reject) => {
    try {
      runtime.sendNativeMessage(hostName, message, (response) => {
        const runtimeMessage = runtime.lastError?.message;
        if (runtimeMessage) {
          reject(nativeMessagingError(runtimeMessage));
          return;
        }
        if (response === undefined) {
          reject(nativeMessagingError('the Mac app did not respond.'));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(nativeMessagingError(error instanceof Error ? error.message : String(error)));
    }
  });
}

function parseBootstrapResponse(value: unknown): CompanionBootstrapResponse {
  if (!value || typeof value !== 'object') {
    throw nativeMessagingError('the Mac app returned an invalid setup response.');
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.type === 'bootstrapError') {
    const nativeError = value as Partial<CompanionBootstrapErrorResponse>;
    const knownCodes = ['invalid_request', 'engine_unavailable', 'version_conflict', 'internal_error'];
    if (
      nativeError.protocolVersion === COMPANION_NATIVE_PROTOCOL_VERSION
      && typeof nativeError.code === 'string'
      && knownCodes.includes(nativeError.code)
      && typeof nativeError.message === 'string'
      && nativeError.message.trim().length > 0
      && nativeError.message.length <= 240
    ) {
      throw nativeMessagingError(nativeError.message.trim(), nativeError.code);
    }
    throw nativeMessagingError('the Mac app returned an invalid error response.');
  }
  const response = value as Partial<CompanionBootstrapResponse>;
  if (
    response.type !== 'bootstrapResult'
    || response.protocolVersion !== COMPANION_NATIVE_PROTOCOL_VERSION
    || response.service !== COMPANION_SERVICE_NAME
    || typeof response.version !== 'string'
    || !response.version
    || (
      response.apiVersion !== undefined
      && (!Number.isSafeInteger(response.apiVersion) || response.apiVersion < 1)
    )
    || typeof response.baseUrl !== 'string'
    || !NATIVE_BOOTSTRAP_URL_PATTERN.test(response.baseUrl.replace(/\/$/, ''))
    || typeof response.token !== 'string'
    || !PAIRING_TOKEN_PATTERN.test(response.token)
  ) {
    throw nativeMessagingError('the Mac app returned an invalid setup response.');
  }
  return {
    type: response.type,
    protocolVersion: response.protocolVersion,
    baseUrl: response.baseUrl.replace(/\/$/, ''),
    token: response.token,
    service: response.service,
    version: response.version,
    apiVersion: response.apiVersion ?? 1,
  };
}

export interface CompanionClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  nativeHostName?: string;
  nativeMessenger?: NativeMessenger | false;
  minimumVersion?: string | false;
  expectedApiVersion?: number;
}

function installedExtensionVersion(): string | undefined {
  try {
    const value = globalThis.chrome?.runtime?.getManifest?.().version;
    return typeof value === 'string' && value ? value : undefined;
  } catch {
    return undefined;
  }
}

function parsedReleaseVersion(value: string): [number, number, number, string?] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
  if (!match) return undefined;
  const numbers = match.slice(1, 4).map(Number) as [number, number, number];
  if (numbers.some((part) => !Number.isSafeInteger(part))) return undefined;
  return [numbers[0], numbers[1], numbers[2], match[4]];
}

export function versionIsAtLeast(candidate: string, minimum: string): boolean {
  const parsedCandidate = parsedReleaseVersion(candidate);
  const parsedMinimum = parsedReleaseVersion(minimum);
  if (!parsedCandidate || !parsedMinimum) return false;
  for (let index = 0; index < 3; index += 1) {
    if (parsedCandidate[index] !== parsedMinimum[index]) {
      return (parsedCandidate[index] as number) > (parsedMinimum[index] as number);
    }
  }
  const candidatePrerelease = parsedCandidate[3];
  const minimumPrerelease = parsedMinimum[3];
  if (candidatePrerelease === minimumPrerelease) return true;
  if (!candidatePrerelease) return true;
  if (!minimumPrerelease) return false;
  return candidatePrerelease.localeCompare(minimumPrerelease) >= 0;
}

export class CompanionClient {
  private readonly explicitBaseUrl?: string;
  private readonly fetcher: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly nativeHostName: string;
  private readonly nativeMessenger: NativeMessenger | false;
  private readonly minimumVersion?: string;
  private readonly expectedApiVersion: number;
  private connectInFlight: Promise<CompanionCapabilities> | null = null;

  constructor(options: CompanionClientOptions = {}) {
    this.explicitBaseUrl = options.baseUrl?.replace(/\/$/, '');
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.pollIntervalMs = options.pollIntervalMs ?? 350;
    this.nativeHostName = options.nativeHostName ?? COMPANION_NATIVE_HOST;
    this.nativeMessenger = options.nativeMessenger ?? defaultNativeMessenger;
    const extensionVersion = installedExtensionVersion();
    this.minimumVersion =
      options.minimumVersion === false
        ? undefined
        : options.minimumVersion ?? (extensionVersion ? MINIMUM_COMPANION_VERSION : undefined);
    this.expectedApiVersion = options.expectedApiVersion ?? COMPANION_API_VERSION;
  }

  private assertCompatibleVersion(version: string, apiVersion = 1): void {
    if (apiVersion !== this.expectedApiVersion) {
      throw new CompanionApiError(
        `The Format Forge Mac app uses Local Engine API ${apiVersion}, but Chrome needs API ${this.expectedApiVersion}. Update both Format Forge components and reconnect.`,
        409,
        'version_conflict',
      );
    }
    if (this.minimumVersion && !versionIsAtLeast(version, this.minimumVersion)) {
      throw new CompanionApiError(
        `Chrome needs Format Forge for Mac ${this.minimumVersion} or newer, but ${version} is installed. Update the Mac app and reconnect.`,
        409,
        'update_required',
      );
    }
  }

  async getBaseUrl(): Promise<string> {
    if (this.explicitBaseUrl) return this.explicitBaseUrl;
    const stored = await withStorageFallback((storage) => storage.get([COMPANION_STORAGE_KEYS.baseUrl]));
    const value = stored[COMPANION_STORAGE_KEYS.baseUrl];
    return typeof value === 'string' && LOOPBACK_URL_PATTERN.test(value)
      ? value.replace(/\/$/, '')
      : DEFAULT_COMPANION_URL;
  }

  async setBaseUrl(baseUrl: string): Promise<void> {
    const normalized = baseUrl.replace(/\/$/, '');
    if (!LOOPBACK_URL_PATTERN.test(normalized)) {
      throw new Error('The companion URL must use localhost or 127.0.0.1.');
    }
    await withStorageFallback((storage) => storage.set({ [COMPANION_STORAGE_KEYS.baseUrl]: normalized }));
  }

  async getToken(): Promise<string | undefined> {
    const stored = await withStorageFallback((storage) => storage.get([COMPANION_STORAGE_KEYS.token]));
    const value = stored[COMPANION_STORAGE_KEYS.token];
    return typeof value === 'string' && value ? value : undefined;
  }

  private async authenticatedHeaders(headers: HeadersInit = {}): Promise<Headers> {
    const token = await this.getToken();
    if (!token) throw new CompanionApiError('Pair the extension with the local companion before converting this file.', 401);
    const result = new Headers(headers);
    result.set('Authorization', `Bearer ${token}`);
    return result;
  }

  private async endpoint(path: string): Promise<string> {
    return `${await this.getBaseUrl()}${path}`;
  }

  async health(signal?: AbortSignal): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetcher(await this.endpoint('/health'), { signal });
    } catch (error) {
      throw new CompanionApiError(`Could not reach the local companion at ${await this.getBaseUrl()}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw await responseError(response);
    return response.json() as Promise<Record<string, unknown>>;
  }

  async getCapabilities(signal?: AbortSignal): Promise<CompanionCapabilities> {
    const token = await this.getToken();
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await this.fetcher(await this.endpoint('/v1/capabilities'), { headers, signal });
    if (!response.ok) throw await responseError(response);
    const body = (await response.json()) as CompanionCapabilities | { capabilities: CompanionCapabilities };
    const capabilities = 'capabilities' in body ? body.capabilities : body;
    if (!capabilities || capabilities.service !== COMPANION_SERVICE_NAME) {
      throw new CompanionApiError('The service on the Local Engine port is not Format Forge.');
    }
    return capabilities;
  }

  /**
   * Ask the installed Mac app to start its loopback service and provide a
   * private local connection credential. Native Messaging carries setup
   * data only; conversion files continue to stream over loopback HTTP.
   */
  async bootstrap(signal?: AbortSignal): Promise<CompanionCapabilities> {
    if (this.nativeMessenger === false) {
      throw nativeMessagingError('automatic app connection is disabled.');
    }
    const previous = await withStorageFallback((storage) =>
      storage.get([COMPANION_STORAGE_KEYS.baseUrl, COMPANION_STORAGE_KEYS.token]),
    );
    const rawResponse = await this.nativeMessenger(this.nativeHostName, {
      type: 'bootstrap',
      protocolVersion: COMPANION_NATIVE_PROTOCOL_VERSION,
    });
    const bootstrap = parseBootstrapResponse(rawResponse);
    this.assertCompatibleVersion(bootstrap.version, bootstrap.apiVersion);

    await withStorageFallback((storage) => storage.set({
      [COMPANION_STORAGE_KEYS.baseUrl]: bootstrap.baseUrl,
      [COMPANION_STORAGE_KEYS.token]: bootstrap.token,
    }));

    try {
      const health = await this.health(signal);
      if (health.service !== COMPANION_SERVICE_NAME || health.status !== 'ok') {
        throw new CompanionApiError('The Mac app started an unexpected local service.');
      }
      const capabilities = await this.getCapabilities(signal);
      if (!capabilities.paired) {
        throw new CompanionApiError('The Mac app could not authorize this Chrome extension.', 401);
      }
      this.assertCompatibleVersion(capabilities.version, capabilities.apiVersion);
      return capabilities;
    } catch (error) {
      const valuesToRestore: Record<string, unknown> = {};
      const keysToRemove: string[] = [];
      for (const key of [COMPANION_STORAGE_KEYS.baseUrl, COMPANION_STORAGE_KEYS.token]) {
        if (previous[key] === undefined) keysToRemove.push(key);
        else valuesToRestore[key] = previous[key];
      }
      await withStorageFallback(async (storage) => {
        if (Object.keys(valuesToRestore).length > 0) await storage.set(valuesToRestore);
        if (keysToRemove.length > 0) await storage.remove(keysToRemove);
      });
      throw error;
    }
  }

  /**
   * Discover an already-running service first, then ask the installed Mac app
   * to launch and pair it. Coalescing prevents React development mode and a
   * simultaneous user click from opening two native connections.
   */
  connect(signal?: AbortSignal): Promise<CompanionCapabilities> {
    if (this.connectInFlight) return this.connectInFlight;
    const connecting = this.connectOnce(signal);
    this.connectInFlight = connecting;
    void connecting.finally(() => {
      if (this.connectInFlight === connecting) this.connectInFlight = null;
    }).catch(() => {
      // The caller receives the original rejection; this only handles finally's derived promise.
    });
    return connecting;
  }

  private async connectOnce(signal?: AbortSignal): Promise<CompanionCapabilities> {
    let discoveredCapabilities: CompanionCapabilities | undefined;
    try {
      const health = await this.health(signal);
      if (health.service !== COMPANION_SERVICE_NAME || health.status !== 'ok') {
        throw new CompanionApiError('The service on the Local Engine port is not Format Forge.');
      }
      discoveredCapabilities = await this.getCapabilities(signal);
      if (discoveredCapabilities.paired) {
        this.assertCompatibleVersion(
          discoveredCapabilities.version,
          discoveredCapabilities.apiVersion,
        );
        return discoveredCapabilities;
      }
    } catch {
      // The app may be closed. Native Messaging below can launch it on demand.
    }

    try {
      return await this.bootstrap(signal);
    } catch (error) {
      // A developer-run HTTP companion can still be paired with its manual code
      // even when no installed Native Messaging host exists.
      if (discoveredCapabilities && !discoveredCapabilities.paired) return discoveredCapabilities;
      throw error;
    }
  }

  async pair(token: string): Promise<CompanionCapabilities> {
    const normalized = token.trim();
    if (!normalized) throw new Error('Enter the pairing token shown by the local companion.');
    await withStorageFallback((storage) => storage.set({ [COMPANION_STORAGE_KEYS.token]: normalized }));
    try {
      const capabilities = await this.getCapabilities();
      if (!capabilities.paired) throw new CompanionApiError('The companion rejected that pairing token.', 401);
      return capabilities;
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await withStorageFallback((storage) => storage.remove([COMPANION_STORAGE_KEYS.token]));
  }

  async createJob(file: File, options: CreateCompanionJobOptions): Promise<CompanionJob> {
    const headers = await this.authenticatedHeaders({
      'Content-Type': file.type || 'application/octet-stream',
      'X-Input-Format': options.inputFormat,
      'X-Output-Format': options.outputFormat,
      'X-File-Name': encodeURIComponent(sanitizeFileName(file.name)),
      'X-Quality-Preset': options.preset ?? 'balanced',
    });
    const response = await this.fetcher(await this.endpoint('/v1/jobs'), {
      method: 'POST',
      headers,
      body: file,
      signal: options.signal,
    });
    if (!response.ok) throw await responseError(response);
    const body = (await response.json()) as { job: CompanionJob };
    if (!body.job?.id) throw new CompanionApiError('The local companion returned an invalid job response.');
    return body.job;
  }

  async getJob(jobId: string, signal?: AbortSignal): Promise<CompanionJob> {
    const headers = await this.authenticatedHeaders();
    const response = await this.fetcher(await this.endpoint(`/v1/jobs/${encodeURIComponent(jobId)}`), { headers, signal });
    if (!response.ok) throw await responseError(response);
    const body = (await response.json()) as { job: CompanionJob };
    return body.job;
  }

  async cancelJob(jobId: string): Promise<CompanionJob> {
    const headers = await this.authenticatedHeaders();
    const response = await this.fetcher(await this.endpoint(`/v1/jobs/${encodeURIComponent(jobId)}`), { method: 'DELETE', headers });
    if (!response.ok) throw await responseError(response);
    const body = (await response.json()) as { job: CompanionJob };
    return body.job;
  }

  async getOutput(jobId: string, fallbackName: string, signal?: AbortSignal): Promise<ConversionResult> {
    const headers = await this.authenticatedHeaders();
    const response = await this.fetcher(await this.endpoint(`/v1/jobs/${encodeURIComponent(jobId)}/output`), { headers, signal });
    if (!response.ok) throw await responseError(response);
    return {
      blob: await response.blob(),
      fileName: parseDownloadName(response.headers.get('content-disposition')) ?? sanitizeFileName(fallbackName),
    };
  }

  async convert(file: File, options: CompanionConversionOptions): Promise<ConversionResult> {
    options.onProgress?.({ phase: 'loading', value: 2 });
    const initial = await this.createJob(file, options);
    let job = initial;
    try {
      while (!['complete', 'failed', 'canceled'].includes(job.state)) {
        const phase = job.state === 'finalizing' ? 'finalizing' : 'converting';
        options.onProgress?.({ phase, value: Math.max(3, Math.min(98, job.progress)) });
        await wait(this.pollIntervalMs, options.signal);
        job = await this.getJob(job.id, options.signal);
      }

      if (job.state === 'failed') throw new CompanionApiError(job.error || 'The local companion could not convert this file.');
      if (job.state === 'canceled') throw new DOMException('Conversion canceled.', 'AbortError');
      options.onProgress?.({ phase: 'finalizing', value: 99 });
      return await this.getOutput(
        job.id,
        job.outputName ?? makeOutputFileName(file.name, options.inputFormat, options.outputFormat),
        options.signal,
      );
    } catch (error) {
      if (options.signal?.aborted && !['complete', 'failed', 'canceled'].includes(job.state)) {
        try {
          await this.cancelJob(job.id);
        } catch {
          // The original abort is the useful result; the service may already have stopped the job.
        }
      }
      throw error;
    }
  }
}

export const companionClient = new CompanionClient();
