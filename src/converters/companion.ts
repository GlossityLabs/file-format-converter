import type {
  CompanionCapabilities,
  ConversionProgress,
  ConversionResult,
  FormatId,
  QualityPreset,
} from '../core/types';
import { makeOutputFileName, sanitizeFileName } from '../core/filenames';

export const DEFAULT_COMPANION_URL = 'http://127.0.0.1:43123';
export const COMPANION_STORAGE_KEYS = Object.freeze({
  token: 'formatForge.companion.token',
  baseUrl: 'formatForge.companion.baseUrl',
});

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

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'CompanionApiError';
    this.status = status;
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
  try {
    const body = (await response.clone().json()) as {
      error?: string | { message?: string };
      message?: string;
    };
    detail = typeof body.error === 'string' ? body.error : body.error?.message ?? body.message ?? '';
  } catch {
    try {
      detail = (await response.text()).trim();
    } catch {
      // Fall through to the status description.
    }
  }
  const suffix = detail ? `: ${detail}` : '';
  return new CompanionApiError(`The local companion returned ${response.status} ${response.statusText || 'request error'}${suffix}`, response.status);
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

export interface CompanionClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
}

export class CompanionClient {
  private readonly explicitBaseUrl?: string;
  private readonly fetcher: typeof fetch;
  private readonly pollIntervalMs: number;

  constructor(options: CompanionClientOptions = {}) {
    this.explicitBaseUrl = options.baseUrl?.replace(/\/$/, '');
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.pollIntervalMs = options.pollIntervalMs ?? 350;
  }

  async getBaseUrl(): Promise<string> {
    if (this.explicitBaseUrl) return this.explicitBaseUrl;
    const stored = await withStorageFallback((storage) => storage.get([COMPANION_STORAGE_KEYS.baseUrl]));
    const value = stored[COMPANION_STORAGE_KEYS.baseUrl];
    return typeof value === 'string' && /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(value)
      ? value.replace(/\/$/, '')
      : DEFAULT_COMPANION_URL;
  }

  async setBaseUrl(baseUrl: string): Promise<void> {
    const normalized = baseUrl.replace(/\/$/, '');
    if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(normalized)) {
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
    return 'capabilities' in body ? body.capabilities : body;
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
