import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanionCapabilities } from '../core/types';
import {
  COMPANION_NATIVE_HOST,
  DEFAULT_COMPANION_URL,
  CompanionClient,
  versionIsAtLeast,
} from './companion';

const capabilities: CompanionCapabilities = {
  service: 'format-forge-companion',
  version: 'test',
  paired: true,
  tools: {
    ffmpeg: { available: true },
    libreoffice: { available: true },
    poppler: { available: false },
  },
};

describe('CompanionClient', () => {
  beforeEach(async () => {
    const cleanupClient = new CompanionClient({
      baseUrl: 'http://127.0.0.1:43123',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    await cleanupClient.disconnect();
    await cleanupClient.setBaseUrl(DEFAULT_COMPANION_URL);
  });

  it('pairs, uploads a raw file, polls, and downloads the completed result', async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/v1/capabilities')) return Response.json(capabilities);
      if (url.endsWith('/v1/jobs') && init?.method === 'POST') {
        return Response.json({ job: { id: 'abc', state: 'queued', progress: 0 } }, { status: 202 });
      }
      if (url.endsWith('/v1/jobs/abc/output')) {
        return new Response('converted', {
          headers: { 'content-disposition': 'attachment; filename="song.wav"', 'content-type': 'audio/wav' },
        });
      }
      if (url.endsWith('/v1/jobs/abc')) {
        return Response.json({ job: { id: 'abc', state: 'complete', progress: 100, outputName: 'fallback.wav' } });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const client = new CompanionClient({ baseUrl: 'http://127.0.0.1:43123', fetch: fetcher as typeof fetch, pollIntervalMs: 0 });

    await expect(client.pair('pairing-secret')).resolves.toEqual(capabilities);
    const input = new File(['audio'], 'song.mp3', { type: 'audio/mpeg' });
    const result = await client.convert(input, { inputFormat: 'mp3', outputFormat: 'wav', preset: 'high' });

    expect(result.fileName).toBe('song.wav');
    expect(await result.blob.text()).toBe('converted');
    const upload = requests.find((request) => request.url.endsWith('/v1/jobs'))?.init;
    expect(upload?.body).toBe(input);
    const headers = new Headers(upload?.headers);
    expect(headers.get('authorization')).toBe('Bearer pairing-secret');
    expect(headers.get('x-input-format')).toBe('mp3');
    expect(headers.get('x-output-format')).toBe('wav');
    expect(headers.get('x-file-name')).toBe('song.mp3');
    expect(headers.get('x-quality-preset')).toBe('high');
  });

  it('requires a pairing token before creating authenticated jobs', async () => {
    const fetcher = vi.fn();
    const client = new CompanionClient({ baseUrl: 'http://127.0.0.1:43123', fetch: fetcher as typeof fetch });
    await expect(client.createJob(new File(['x'], 'x.mp3'), { inputFormat: 'mp3', outputFormat: 'wav' })).rejects.toThrow(/pair/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('turns a missing media tool response into an actionable message', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/capabilities')) return Response.json(capabilities);
      if (url.endsWith('/v1/jobs')) {
        return Response.json(
          {
            error: {
              code: 'tool_unavailable',
              message: 'Audio and video conversion is not ready. Open Format Forge for Mac and check the Audio and video tool, then retry.',
            },
          },
          { status: 409, statusText: 'Conflict' },
        );
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const client = new CompanionClient({
      baseUrl: 'http://127.0.0.1:43123',
      fetch: fetcher as typeof fetch,
    });
    await client.pair('pairing-secret');

    await expect(
      client.createJob(new File(['ID3audio'], 'song.mp3'), {
        inputFormat: 'mp3',
        outputFormat: 'wav',
      }),
    ).rejects.toThrow(/^Audio and video conversion is not ready\./);
  });

  it('rejects non-loopback companion URLs', async () => {
    const client = new CompanionClient();
    await expect(client.setBaseUrl('https://example.com')).rejects.toThrow(/localhost/i);
  });

  it('launches and pairs the installed Mac app automatically before checking capabilities', async () => {
    let appStarted = false;
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (!appStarted) throw new TypeError('connection refused');
      if (url.endsWith('/health')) {
        return Response.json({ service: 'format-forge-companion', version: 'test', status: 'ok' });
      }
      if (url.endsWith('/v1/capabilities')) return Response.json(capabilities);
      throw new Error(`Unexpected request ${url}`);
    });
    const nativeMessenger = vi.fn(async () => {
      appStarted = true;
      return {
        type: 'bootstrapResult',
        protocolVersion: 1,
        baseUrl: DEFAULT_COMPANION_URL,
        token: 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
        service: 'format-forge-companion',
        version: '0.1.0',
      };
    });
    const client = new CompanionClient({
      fetch: fetcher as typeof fetch,
      nativeMessenger,
    });

    await expect(client.connect()).resolves.toEqual(capabilities);
    expect(nativeMessenger).toHaveBeenCalledWith(COMPANION_NATIVE_HOST, {
      type: 'bootstrap',
      protocolVersion: 1,
    });
    const capabilitiesRequest = requests.find((request) => request.url.endsWith('/v1/capabilities'));
    expect(new Headers(capabilitiesRequest?.init?.headers).get('authorization'))
      .toBe('Bearer abcdefghijklmnopqrstuvwxyzABCDEFGH123456789');
  });

  it('keeps a running developer companion available when no native host is installed', async () => {
    const unpairedCapabilities = { ...capabilities, paired: false };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return Response.json({ service: 'format-forge-companion', version: 'test', status: 'ok' });
      }
      if (url.endsWith('/v1/capabilities')) return Response.json(unpairedCapabilities);
      throw new Error(`Unexpected request ${url}`);
    });
    const nativeMessenger = vi.fn(async () => {
      throw new Error('native host not found');
    });
    const client = new CompanionClient({
      baseUrl: DEFAULT_COMPANION_URL,
      fetch: fetcher as typeof fetch,
      nativeMessenger,
    });

    await expect(client.connect()).resolves.toEqual(unpairedCapabilities);
    expect(nativeMessenger).toHaveBeenCalledOnce();
  });

  it('rejects bootstrap credentials that point outside 127.0.0.1', async () => {
    const client = new CompanionClient({
      fetch: vi.fn(async () => { throw new TypeError('connection refused'); }) as unknown as typeof fetch,
      nativeMessenger: vi.fn(async () => ({
        type: 'bootstrapResult',
        protocolVersion: 1,
        baseUrl: 'https://converter.example.com',
        token: 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
        service: 'format-forge-companion',
        version: '0.1.0',
      })),
    });

    await expect(client.connect()).rejects.toThrow(/invalid setup response/i);
    await expect(client.getBaseUrl()).resolves.toBe(DEFAULT_COMPANION_URL);
    await expect(client.getToken()).resolves.toBeUndefined();
  });

  it('rejects an older running Mac engine instead of adopting stale capabilities', async () => {
    const olderCapabilities = { ...capabilities, version: '0.1.0' };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return Response.json({ service: 'format-forge-companion', version: '0.1.0', status: 'ok' });
      }
      if (url.endsWith('/v1/capabilities')) return Response.json(olderCapabilities);
      throw new Error(`Unexpected request ${url}`);
    });
    const client = new CompanionClient({
      fetch: fetcher as typeof fetch,
      minimumVersion: '0.1.1',
      nativeMessenger: vi.fn(async () => ({
        type: 'bootstrapResult',
        protocolVersion: 1,
        baseUrl: DEFAULT_COMPANION_URL,
        token: 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
        service: 'format-forge-companion',
        version: '0.1.0',
      })),
    });

    await expect(client.connect()).rejects.toThrow(/needs Format Forge for Mac 0\.1\.1 or newer.*0\.1\.0/i);
  });

  it('allows the extension and Mac app to update in either order when their API is compatible', async () => {
    const newerCapabilities = { ...capabilities, version: '0.1.3', apiVersion: 1 };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return Response.json({
          service: 'format-forge-companion',
          version: newerCapabilities.version,
          apiVersion: 1,
          status: 'ok',
        });
      }
      if (url.endsWith('/v1/capabilities')) return Response.json(newerCapabilities);
      throw new Error(`Unexpected request ${url}`);
    });
    const client = new CompanionClient({
      fetch: fetcher as typeof fetch,
      minimumVersion: '0.1.1',
      expectedApiVersion: 1,
      nativeMessenger: false,
    });
    await client.pair('pairing-secret');

    await expect(client.connect()).resolves.toEqual(newerCapabilities);
  });

  it('blocks a genuinely incompatible Local Engine API', async () => {
    const client = new CompanionClient({
      fetch: vi.fn(async () => {
        throw new TypeError('connection refused');
      }) as unknown as typeof fetch,
      minimumVersion: '0.1.1',
      expectedApiVersion: 1,
      nativeMessenger: vi.fn(async () => ({
        type: 'bootstrapResult',
        protocolVersion: 1,
        baseUrl: DEFAULT_COMPANION_URL,
        token: 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
        service: 'format-forge-companion',
        version: '0.2.0',
        apiVersion: 2,
      })),
    });

    await expect(client.connect()).rejects.toThrow(/uses Local Engine API 2.*needs API 1/i);
  });
});

describe('versionIsAtLeast', () => {
  it('compares stable and prerelease versions without exact patch lockstep', () => {
    expect(versionIsAtLeast('0.1.2', '0.1.1')).toBe(true);
    expect(versionIsAtLeast('0.2.0', '0.1.99')).toBe(true);
    expect(versionIsAtLeast('0.1.2-beta.1', '0.1.2')).toBe(false);
    expect(versionIsAtLeast('not-a-version', '0.1.1')).toBe(false);
  });
});
