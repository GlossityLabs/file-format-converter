import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanionCapabilities } from '../core/types';
import { CompanionClient } from './companion';

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

  it('rejects non-loopback companion URLs', async () => {
    const client = new CompanionClient();
    await expect(client.setBaseUrl('https://example.com')).rejects.toThrow(/localhost/i);
  });
});
