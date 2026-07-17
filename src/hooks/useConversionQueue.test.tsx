import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversionResult } from '../core/types';
import type { CompanionClient } from '../converters/companion';
import { convertInBrowser } from '../converters/browser';
import { BatchAddError, useConversionQueue } from './useConversionQueue';

vi.mock('../converters/browser', () => ({
  convertInBrowser: vi.fn(),
}));

const mockedConvert = vi.mocked(convertInBrowser);

function inertClient(): CompanionClient {
  return {
    health: vi.fn(),
    getCapabilities: vi.fn(),
    pair: vi.fn(),
    disconnect: vi.fn(),
    convert: vi.fn(),
  } as unknown as CompanionClient;
}

describe('useConversionQueue', () => {
  beforeEach(() => {
    mockedConvert.mockReset();
    mockedConvert.mockImplementation(async (file, input, output): Promise<ConversionResult> => ({
      blob: new Blob([file.name]),
      fileName: `${file.name.replace(/\.[^.]+$/, '')}.${output}`,
    }));
  });

  it('detects a mixed batch, keeps valid files, and exposes rejected files', async () => {
    const { result } = renderHook(() => useConversionQueue({ client: inertClient(), autoRefreshCompanion: false }));
    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.addFiles([
          new File(['name,age\nAda,36'], 'people.csv', { type: 'text/csv' }),
          new File([new Uint8Array([0, 1, 2])], 'unknown.bin'),
        ]);
      } catch (error) {
        rejection = error;
      }
    });

    expect(rejection).toBeInstanceOf(BatchAddError);
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0]).toMatchObject({ inputFormat: 'csv', outputFormat: 'json', status: 'ready' });
  });

  it('converts a mixed queue sequentially and supports retry/remove cleanup', async () => {
    let active = 0;
    let maximumActive = 0;
    mockedConvert.mockImplementation(async (file, _input, output) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return { blob: new Blob([file.name]), fileName: `${file.name}.${output}` };
    });
    const { result } = renderHook(() => useConversionQueue({ client: inertClient(), autoRefreshCompanion: false }));
    await act(async () => {
      await result.current.addFiles([
        new File(['a,b\n1,2'], 'one.csv', { type: 'text/csv' }),
        new File(['[{"a":1}]'], 'two.json', { type: 'application/json' }),
      ]);
    });
    await act(async () => result.current.startAll());

    expect(maximumActive).toBe(1);
    expect(result.current.jobs.map((job) => job.status)).toEqual(['complete', 'complete']);
    expect(result.current.overallProgress).toBe(100);

    const firstId = result.current.jobs[0].id;
    await act(async () => result.current.retryJob(firstId));
    expect(result.current.jobs[0].status).toBe('complete');
    act(() => result.current.removeJob(firstId));
    expect(result.current.jobs).toHaveLength(1);
  });
});
