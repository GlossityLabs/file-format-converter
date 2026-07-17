import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { zipSync } from 'fflate';
import type {
  CompanionCapabilities,
  ConversionJob,
  ConversionProgress,
  FormatId,
  QualityPreset,
} from '../core/types';
import { detectFileFormat } from '../core/detection';
import { ensureUniqueFileName } from '../core/filenames';
import { getFormat } from '../core/formats';
import {
  MAX_BROWSER_FILE_BYTES,
  MAX_COMPANION_MEDIA_BYTES,
  MAX_QUEUE_BYTES,
  MAX_QUEUE_FILES,
} from '../core/limits';
import { findRecipe, getAvailableRecipes, getKnownRecipesForInput } from '../core/recipes';
import { convertInBrowser } from '../converters/browser';
import { CompanionClient, companionClient } from '../converters/companion';

export type CompanionConnectionStatus = 'checking' | 'unavailable' | 'unpaired' | 'paired';
const MAX_DOWNLOAD_BUNDLE_BYTES = 250 * 1024 * 1024;

export interface RejectedFile {
  file: File;
  error: string;
}

export class BatchAddError extends Error {
  readonly rejected: readonly RejectedFile[];

  constructor(rejected: readonly RejectedFile[]) {
    super(rejected.length === 1 ? rejected[0].error : `${rejected.length} files could not be added to the queue.`);
    this.name = 'BatchAddError';
    this.rejected = rejected;
  }
}

export interface UseConversionQueueOptions {
  client?: CompanionClient;
  autoRefreshCompanion?: boolean;
}

export interface CompanionQueueController {
  status: CompanionConnectionStatus;
  capabilities: CompanionCapabilities | null;
  refresh: () => Promise<CompanionCapabilities | null>;
  pair: (token: string) => Promise<CompanionCapabilities>;
  disconnect: () => Promise<void>;
}

export interface ConversionQueue {
  jobs: ConversionJob[];
  addFiles: (files: File[] | FileList) => Promise<void>;
  updateOutput: (id: string, outputFormat: FormatId) => void;
  updatePreset: (id: string, preset: QualityPreset) => void;
  updateJob: (id: string, patch: Partial<Pick<ConversionJob, 'outputFormat' | 'preset'>>) => void;
  removeJob: (id: string) => void;
  convertAll: () => Promise<void>;
  startAll: () => Promise<void>;
  startJob: (id: string) => Promise<void>;
  cancelJob: (id: string) => void;
  retryJob: (id: string) => Promise<void>;
  clearCompleted: () => void;
  downloadJob: (id: string) => void;
  downloadAll: () => Promise<void>;
  isConverting: boolean;
  overallProgress: number;
  companion: CompanionQueueController;
  queueError: string | null;
  clearQueueError: () => void;
  availableRecipesFor: (input: FormatId) => ReturnType<typeof getAvailableRecipes>;
}

function jobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === 'AbortError' : error instanceof Error && error.name === 'AbortError';
}

function createOutputUrl(blob: Blob): string | undefined {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : undefined;
}

function revokeOutputUrl(url?: string): void {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
}

function perFileLimit(input: FormatId): number {
  const category = getFormat(input).category;
  return category === 'audio' || category === 'video' ? MAX_COMPANION_MEDIA_BYTES : MAX_BROWSER_FILE_BYTES;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${Math.round((bytes / 1024 ** 3) * 10) / 10} GiB`;
  return `${Math.round(bytes / 1024 ** 2)} MiB`;
}

function defaultRecipe(input: FormatId) {
  return getKnownRecipesForInput(input)[0];
}

function triggerDownload(job: ConversionJob): void {
  if (!job.outputBlob || !job.outputName) return;
  const temporary = !job.outputUrl;
  const url = job.outputUrl ?? createOutputUrl(job.outputBlob);
  if (!url) return;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = job.outputName;
  anchor.rel = 'noopener';
  anchor.click();
  if (temporary) setTimeout(() => revokeOutputUrl(url), 0);
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = createOutputUrl(blob);
  if (!url) return;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.click();
  setTimeout(() => revokeOutputUrl(url), 0);
}

export function useConversionQueue(options: UseConversionQueueOptions = {}): ConversionQueue {
  const client = options.client ?? companionClient;
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const jobsRef = useRef<ConversionJob[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [companionStatus, setCompanionStatus] = useState<CompanionConnectionStatus>('checking');
  const [capabilities, setCapabilities] = useState<CompanionCapabilities | null>(null);
  const abortControllers = useRef(new Map<string, AbortController>());
  const pendingIds = useRef<string[]>([]);
  const drainPromise = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);

  const replaceJobs = useCallback((updater: (current: ConversionJob[]) => ConversionJob[]) => {
    const next = updater(jobsRef.current);
    jobsRef.current = next;
    if (mounted.current) setJobs(next);
  }, []);

  const patchJob = useCallback(
    (id: string, patch: Partial<ConversionJob>) => {
      replaceJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)));
    },
    [replaceJobs],
  );

  const refreshCompanion = useCallback(async (): Promise<CompanionCapabilities | null> => {
    if (mounted.current) setCompanionStatus('checking');
    try {
      await client.health();
      const nextCapabilities = await client.getCapabilities();
      if (mounted.current) {
        setCapabilities(nextCapabilities);
        setCompanionStatus(nextCapabilities.paired ? 'paired' : 'unpaired');
      }
      return nextCapabilities;
    } catch {
      if (mounted.current) {
        setCapabilities(null);
        setCompanionStatus('unavailable');
      }
      return null;
    }
  }, [client]);

  const pairCompanion = useCallback(
    async (token: string): Promise<CompanionCapabilities> => {
      const nextCapabilities = await client.pair(token);
      if (mounted.current) {
        setCapabilities(nextCapabilities);
        setCompanionStatus('paired');
      }
      return nextCapabilities;
    },
    [client],
  );

  const disconnectCompanion = useCallback(async (): Promise<void> => {
    await client.disconnect();
    if (mounted.current) {
      setCapabilities((current) => (current ? { ...current, paired: false } : current));
      setCompanionStatus('unpaired');
    }
  }, [client]);

  const addFiles = useCallback(
    async (filesToAdd: File[] | FileList): Promise<void> => {
      setQueueError(null);
      const incoming = Array.from(filesToAdd);
      const accepted: ConversionJob[] = [];
      const rejected: RejectedFile[] = [];
      let projectedCount = jobsRef.current.length;
      let projectedBytes = jobsRef.current.reduce((total, job) => total + job.file.size, 0);

      for (const file of incoming) {
        if (projectedCount >= MAX_QUEUE_FILES) {
          rejected.push({ file, error: `The queue can contain at most ${MAX_QUEUE_FILES} files.` });
          continue;
        }
        if (projectedBytes + file.size > MAX_QUEUE_BYTES) {
          rejected.push({ file, error: `The queue can contain at most ${formatBytes(MAX_QUEUE_BYTES)} in total.` });
          continue;
        }
        try {
          const inputFormat = await detectFileFormat(file);
          const recipe = defaultRecipe(inputFormat);
          if (!recipe) throw new Error(`${getFormat(inputFormat).label} is recognized, but no conversion from it is implemented.`);
          const fileLimit = perFileLimit(inputFormat);
          if (file.size > fileLimit) {
            throw new Error(`“${file.name}” is ${formatBytes(file.size)}; the limit for this format is ${formatBytes(fileLimit)}.`);
          }
          accepted.push({
            id: jobId(),
            file,
            inputFormat,
            outputFormat: recipe.output,
            engine: recipe.engine,
            preset: 'balanced',
            status: 'ready',
            progress: 0,
          });
          projectedCount += 1;
          projectedBytes += file.size;
        } catch (error) {
          rejected.push({ file, error: errorMessage(error) });
        }
      }

      if (accepted.length > 0) replaceJobs((current) => [...current, ...accepted]);
      if (rejected.length > 0) {
        const batchError = new BatchAddError(rejected);
        if (mounted.current) setQueueError(batchError.message);
        throw batchError;
      }
    },
    [replaceJobs],
  );

  const resetOutput = useCallback((job: ConversionJob): Partial<ConversionJob> => {
    revokeOutputUrl(job.outputUrl);
    return {
      status: 'ready',
      progress: 0,
      outputName: undefined,
      outputUrl: undefined,
      outputBlob: undefined,
      error: undefined,
    };
  }, []);

  const updateOutput = useCallback(
    (id: string, outputFormat: FormatId): void => {
      const job = jobsRef.current.find((candidate) => candidate.id === id);
      if (!job) return;
      const recipe = findRecipe(job.inputFormat, outputFormat);
      if (!recipe) {
        setQueueError(`Conversion from ${job.inputFormat.toUpperCase()} to ${outputFormat.toUpperCase()} is not supported.`);
        return;
      }
      pendingIds.current = pendingIds.current.filter((pendingId) => pendingId !== id);
      abortControllers.current.get(id)?.abort();
      replaceJobs((current) =>
        current.map((candidate) =>
          candidate.id === id
            ? { ...candidate, ...resetOutput(candidate), outputFormat, engine: recipe.engine }
            : candidate,
        ),
      );
    },
    [replaceJobs, resetOutput],
  );

  const updatePreset = useCallback(
    (id: string, preset: QualityPreset): void => {
      pendingIds.current = pendingIds.current.filter((pendingId) => pendingId !== id);
      abortControllers.current.get(id)?.abort();
      replaceJobs((current) =>
        current.map((candidate) =>
          candidate.id === id ? { ...candidate, ...resetOutput(candidate), preset } : candidate,
        ),
      );
    },
    [replaceJobs, resetOutput],
  );

  const updateJob = useCallback(
    (id: string, patch: Partial<Pick<ConversionJob, 'outputFormat' | 'preset'>>): void => {
      if (patch.outputFormat !== undefined) updateOutput(id, patch.outputFormat);
      if (patch.preset !== undefined) updatePreset(id, patch.preset);
    },
    [updateOutput, updatePreset],
  );

  const convertOne = useCallback(
    async (id: string): Promise<void> => {
      const job = jobsRef.current.find((candidate) => candidate.id === id);
      if (!job || job.status !== 'ready') return;
      const recipe = findRecipe(job.inputFormat, job.outputFormat);
      if (!recipe) {
        patchJob(id, { status: 'failed', error: 'This conversion recipe is no longer available.' });
        return;
      }

      const controller = new AbortController();
      abortControllers.current.set(id, controller);
      patchJob(id, { status: recipe.engine === 'companion' ? 'uploading' : 'converting', progress: 1, error: undefined });

      const onProgress = (progress: ConversionProgress) => {
        const status = progress.phase === 'finalizing'
          ? 'finalizing'
          : recipe.engine === 'companion' && progress.phase === 'loading'
            ? 'uploading'
            : 'converting';
        patchJob(id, { status, progress: Math.max(0, Math.min(99, progress.value)) });
      };

      try {
        const result = recipe.engine === 'browser'
          ? await convertInBrowser(job.file, job.inputFormat, job.outputFormat, {
              preset: job.preset,
              signal: controller.signal,
              onProgress,
            })
          : await client.convert(job.file, {
              inputFormat: job.inputFormat,
              outputFormat: job.outputFormat,
              preset: job.preset,
              signal: controller.signal,
              onProgress,
            });

        if (controller.signal.aborted) throw new DOMException('Conversion canceled.', 'AbortError');
        const existingNames = jobsRef.current
          .filter((candidate) => candidate.id !== id && candidate.outputName)
          .map((candidate) => candidate.outputName as string);
        const outputName = ensureUniqueFileName(result.fileName, existingNames);
        const previous = jobsRef.current.find((candidate) => candidate.id === id);
        revokeOutputUrl(previous?.outputUrl);
        patchJob(id, {
          status: 'complete',
          progress: 100,
          outputBlob: result.blob,
          outputName,
          outputUrl: createOutputUrl(result.blob),
          error: undefined,
        });
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          patchJob(id, { status: 'canceled', progress: 0, error: undefined });
        } else {
          patchJob(id, { status: 'failed', progress: 0, error: errorMessage(error) });
        }
      } finally {
        abortControllers.current.delete(id);
      }
    },
    [client, patchJob],
  );

  const drain = useCallback((): Promise<void> => {
    if (drainPromise.current) return drainPromise.current;
    const running = (async () => {
      while (pendingIds.current.length > 0) {
        const id = pendingIds.current.shift();
        if (id) await convertOne(id);
      }
    })();
    drainPromise.current = running;
    void running.finally(() => {
      if (drainPromise.current === running) {
        drainPromise.current = null;
        if (pendingIds.current.length > 0) void drain();
      }
    });
    return running;
  }, [convertOne]);

  const enqueue = useCallback(
    (ids: readonly string[]): Promise<void> => {
      for (const id of ids) {
        if (!pendingIds.current.includes(id) && !abortControllers.current.has(id)) pendingIds.current.push(id);
      }
      return drain();
    },
    [drain],
  );

  const startJob = useCallback(
    async (id: string): Promise<void> => {
      const job = jobsRef.current.find((candidate) => candidate.id === id);
      if (!job) return;
      if (job.status === 'failed' || job.status === 'canceled') patchJob(id, { status: 'ready', progress: 0, error: undefined });
      await enqueue([id]);
    },
    [enqueue, patchJob],
  );

  const convertAll = useCallback(async (): Promise<void> => {
    const ids = jobsRef.current.filter((job) => job.status === 'ready').map((job) => job.id);
    await enqueue(ids);
  }, [enqueue]);

  const cancelJob = useCallback(
    (id: string): void => {
      pendingIds.current = pendingIds.current.filter((pendingId) => pendingId !== id);
      abortControllers.current.get(id)?.abort();
      const job = jobsRef.current.find((candidate) => candidate.id === id);
      if (job && ['ready', 'uploading', 'converting', 'finalizing'].includes(job.status)) {
        patchJob(id, { status: 'canceled', progress: 0, error: undefined });
      }
    },
    [patchJob],
  );

  const retryJob = useCallback(
    async (id: string): Promise<void> => {
      const job = jobsRef.current.find((candidate) => candidate.id === id);
      if (!job) return;
      revokeOutputUrl(job.outputUrl);
      patchJob(id, {
        status: 'ready',
        progress: 0,
        error: undefined,
        outputBlob: undefined,
        outputName: undefined,
        outputUrl: undefined,
      });
      await enqueue([id]);
    },
    [enqueue, patchJob],
  );

  const removeJob = useCallback(
    (id: string): void => {
      pendingIds.current = pendingIds.current.filter((pendingId) => pendingId !== id);
      abortControllers.current.get(id)?.abort();
      replaceJobs((current) => {
        const removed = current.find((job) => job.id === id);
        revokeOutputUrl(removed?.outputUrl);
        return current.filter((job) => job.id !== id);
      });
    },
    [replaceJobs],
  );

  const clearCompleted = useCallback((): void => {
    replaceJobs((current) => {
      for (const job of current) if (job.status === 'complete') revokeOutputUrl(job.outputUrl);
      return current.filter((job) => job.status !== 'complete');
    });
  }, [replaceJobs]);

  const downloadJob = useCallback((id: string): void => {
    const job = jobsRef.current.find((candidate) => candidate.id === id);
    if (job?.status === 'complete') triggerDownload(job);
  }, []);

  const downloadAll = useCallback(async (): Promise<void> => {
    const completed = jobsRef.current.filter(
      (job): job is ConversionJob & { outputBlob: Blob; outputName: string } =>
        job.status === 'complete' && Boolean(job.outputBlob && job.outputName),
    );
    if (completed.length === 0) return;
    if (completed.length === 1) {
      triggerDownload(completed[0]);
      return;
    }
    const totalBytes = completed.reduce((total, job) => total + job.outputBlob.size, 0);
    if (totalBytes > MAX_DOWNLOAD_BUNDLE_BYTES) {
      setQueueError('These completed files are too large to bundle safely in this tab. Download them individually.');
      return;
    }

    const entries: Record<string, Uint8Array> = {};
    const names: string[] = [];
    for (const job of completed) {
      const name = ensureUniqueFileName(job.outputName, names);
      names.push(name);
      entries[name] = new Uint8Array(await job.outputBlob.arrayBuffer());
    }
    const archive = zipSync(entries, { level: 6 });
    triggerBlobDownload(new Blob([archive as BlobPart], { type: 'application/zip' }), 'format-forge-conversions.zip');
  }, []);

  const availableRecipesFor = useCallback(
    (input: FormatId) => getAvailableRecipes(capabilities).filter((recipe) => recipe.input === input),
    [capabilities],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const controller of abortControllers.current.values()) controller.abort();
      for (const job of jobsRef.current) revokeOutputUrl(job.outputUrl);
    };
  }, []);

  useEffect(() => {
    if (options.autoRefreshCompanion !== false) void refreshCompanion();
  }, [options.autoRefreshCompanion, refreshCompanion]);

  const isConverting = jobs.some((job) => ['uploading', 'converting', 'finalizing'].includes(job.status));
  const overallProgress = jobs.length === 0
    ? 0
    : Math.round(jobs.reduce((total, job) => total + (job.status === 'complete' ? 100 : job.progress), 0) / jobs.length);

  const companion = useMemo<CompanionQueueController>(
    () => ({
      status: companionStatus,
      capabilities,
      refresh: refreshCompanion,
      pair: pairCompanion,
      disconnect: disconnectCompanion,
    }),
    [capabilities, companionStatus, disconnectCompanion, pairCompanion, refreshCompanion],
  );

  return {
    jobs,
    addFiles,
    updateOutput,
    updatePreset,
    updateJob,
    removeJob,
    convertAll,
    startAll: convertAll,
    startJob,
    cancelJob,
    retryJob,
    clearCompleted,
    downloadJob,
    downloadAll,
    isConverting,
    overallProgress,
    companion,
    queueError,
    clearQueueError: () => setQueueError(null),
    availableRecipesFor,
  };
}

export default useConversionQueue;
