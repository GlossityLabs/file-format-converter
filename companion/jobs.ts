import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type {
  DetectedTools,
  FormatId,
  InternalJob,
  PublicJob,
  QualityPreset,
  RuntimeOptions,
} from './contracts.js';
import { ffmpegOutputArguments, findRecipe, libreOfficeFilter } from './recipes.js';
import { makeOutputName } from './security.js';

class CanceledError extends Error {}
class ProcessTimeoutError extends Error {}

interface CreateJobInput {
  inputFormat: FormatId;
  outputFormat: FormatId;
  preset: QualityPreset;
  fileName: string;
}

interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

const TERMINAL_STATES = new Set<InternalJob['state']>([
  'complete',
  'failed',
  'canceled',
]);

function publicJob(job: InternalJob): PublicJob {
  const result: PublicJob = {
    id: job.id,
    state: job.state,
    progress: Math.max(0, Math.min(100, Math.round(job.progress))),
  };
  if (job.outputName) result.outputName = job.outputName;
  if (job.outputBytes !== undefined) result.sizeBytes = job.outputBytes;
  if (job.error) result.error = job.error;
  return result;
}

function updateJob(job: InternalJob, changes: Partial<InternalJob>): void {
  Object.assign(job, changes, { updatedAt: Date.now() });
}

export class JobManager {
  readonly #jobs = new Map<string, InternalJob>();
  readonly #queue: string[] = [];
  readonly #tools: DetectedTools;
  readonly #options: RuntimeOptions;
  readonly #cleanupTimer: NodeJS.Timeout;
  #running = 0;
  #closed = false;

  constructor(tools: DetectedTools, options: RuntimeOptions) {
    this.#tools = tools;
    this.#options = options;
    this.#cleanupTimer = setInterval(
      () => void this.cleanupExpired(),
      Math.min(60_000, Math.max(5_000, Math.floor(options.limits.jobTtlMs / 2))),
    );
    this.#cleanupTimer.unref();
  }

  get size(): number {
    return this.#jobs.size;
  }

  canAccept(): boolean {
    return !this.#closed && this.#jobs.size < this.#options.limits.maxRetainedJobs;
  }

  async create(input: CreateJobInput): Promise<InternalJob> {
    if (!this.canAccept()) throw new Error('The companion job queue is full.');
    const recipe = findRecipe(input.inputFormat, input.outputFormat);
    if (!recipe) throw new Error('The requested conversion is not allowlisted.');

    const id = randomUUID();
    const directory = join(this.#options.tempDirectory, id);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    const now = Date.now();
    const job: InternalJob = {
      id,
      state: 'queued',
      progress: 0,
      inputFormat: input.inputFormat,
      outputFormat: input.outputFormat,
      preset: input.preset,
      inputPath: join(directory, `source.${input.inputFormat}`),
      outputPath: join(directory, `source.${input.outputFormat}`),
      outputName: makeOutputName(input.fileName, input.outputFormat),
      directory,
      inputBytes: 0,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      cancelRequested: false,
    };
    this.#jobs.set(id, job);
    return job;
  }

  commitUpload(job: InternalJob, inputBytes: number): PublicJob {
    if (this.#jobs.get(job.id) !== job || job.cancelRequested) {
      throw new Error('The job is no longer available.');
    }
    updateJob(job, { inputBytes, progress: 2 });
    this.#queue.push(job.id);
    this.#drainQueue();
    return publicJob(job);
  }

  async discardUpload(job: InternalJob): Promise<void> {
    this.#jobs.delete(job.id);
    await rm(job.directory, { recursive: true, force: true });
  }

  get(id: string): PublicJob | undefined {
    const job = this.#jobs.get(id);
    if (!job) return undefined;
    job.lastAccessedAt = Date.now();
    return publicJob(job);
  }

  getInternal(id: string): InternalJob | undefined {
    const job = this.#jobs.get(id);
    if (job) job.lastAccessedAt = Date.now();
    return job;
  }

  async cancel(id: string): Promise<PublicJob | undefined> {
    const job = this.#jobs.get(id);
    if (!job) return undefined;
    job.lastAccessedAt = Date.now();
    if (TERMINAL_STATES.has(job.state)) return publicJob(job);

    job.cancelRequested = true;
    updateJob(job, {
      state: 'canceled',
      progress: 0,
      finishedAt: Date.now(),
      error: undefined,
    });
    const queueIndex = this.#queue.indexOf(id);
    if (queueIndex >= 0) {
      this.#queue.splice(queueIndex, 1);
      await this.#removeArtifacts(job);
    }

    await this.#terminateChild(job);
    return publicJob(job);
  }

  async cleanupExpired(now = Date.now()): Promise<void> {
    const expired: InternalJob[] = [];
    for (const job of this.#jobs.values()) {
      if (
        TERMINAL_STATES.has(job.state) &&
        now - Math.max(job.finishedAt ?? job.updatedAt, job.lastAccessedAt) >=
          this.#options.limits.jobTtlMs
      ) {
        this.#jobs.delete(job.id);
        expired.push(job);
      }
    }
    await Promise.all(expired.map(async (job) => this.#removeArtifacts(job)));
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#cleanupTimer);
    await Promise.all([...this.#jobs.keys()].map(async (id) => this.cancel(id)));
    await Promise.all([...this.#jobs.values()].map(async (job) => this.#removeArtifacts(job)));
    this.#jobs.clear();
    this.#queue.length = 0;
  }

  #drainQueue(): void {
    if (this.#closed) return;
    while (
      this.#running < this.#options.limits.maxConcurrentJobs &&
      this.#queue.length > 0
    ) {
      const id = this.#queue.shift();
      if (!id) break;
      const job = this.#jobs.get(id);
      if (!job || job.cancelRequested) continue;
      this.#running += 1;
      void this.#execute(job).finally(() => {
        this.#running -= 1;
        this.#drainQueue();
      });
    }
  }

  async #execute(job: InternalJob): Promise<void> {
    try {
      const recipe = findRecipe(job.inputFormat, job.outputFormat);
      if (!recipe) throw new Error('Recipe unavailable.');
      const capability =
        recipe.requires === 'libreoffice' ? this.#tools.libreoffice : this.#tools.ffmpeg;
      if (!capability.available || !capability.command) {
        throw new Error('Required conversion tool unavailable.');
      }

      updateJob(job, { state: 'converting', progress: 5 });
      if (recipe.requires === 'libreoffice') await this.#runLibreOffice(job, capability.command);
      else await this.#runFfmpeg(job, capability.command);
      if (job.cancelRequested) throw new CanceledError();

      updateJob(job, { state: 'finalizing', progress: 96 });
      const output = await stat(job.outputPath);
      if (!output.isFile() || output.size <= 0) throw new Error('Conversion did not produce output.');
      updateJob(job, {
        state: 'complete',
        progress: 100,
        outputBytes: output.size,
        finishedAt: Date.now(),
      });
    } catch (error) {
      if (job.cancelRequested || error instanceof CanceledError) {
        updateJob(job, { state: 'canceled', progress: 0, finishedAt: Date.now() });
      } else {
        updateJob(job, {
          state: 'failed',
          progress: 0,
          error:
            error instanceof ProcessTimeoutError
              ? 'Conversion exceeded the local time limit.'
              : 'The local conversion tool could not convert this file.',
          finishedAt: Date.now(),
        });
      }
      await this.#removeArtifacts(job);
    } finally {
      job.child = undefined;
    }
  }

  async #runLibreOffice(job: InternalJob, command: string): Promise<void> {
    const profileDirectory = join(job.directory, 'libreoffice-profile');
    await mkdir(profileDirectory, { mode: 0o700 });
    const result = await this.#runProcess(
      job,
      command,
      [
        '--headless',
        '--nologo',
        '--nodefault',
        '--nofirststartwizard',
        `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
        '--convert-to',
        libreOfficeFilter(job.outputFormat),
        '--outdir',
        job.directory,
        job.inputPath,
      ],
      () => {
        if (job.progress < 85) updateJob(job, { progress: job.progress + 5 });
      },
    );
    if (result.code !== 0) throw new Error('LibreOffice failed.');

    // LibreOffice occasionally normalizes extension case; accept only the expected
    // extension inside this job's isolated directory.
    try {
      await stat(job.outputPath);
    } catch {
      const entries = await readdir(job.directory);
      const matching = entries.find(
        (entry) => entry.toLowerCase() === `source.${job.outputFormat}`.toLowerCase(),
      );
      if (!matching) throw new Error('LibreOffice did not produce output.');
      job.outputPath = join(job.directory, matching);
    }
  }

  async #runFfmpeg(job: InternalJob, command: string): Promise<void> {
    const duration = await this.#probeDuration(job);
    if (job.cancelRequested) throw new CanceledError();
    let pending = '';
    const progress = (chunk?: Buffer): void => {
      if (!chunk) {
        if (job.progress < 90) updateJob(job, { progress: job.progress + 1 });
        return;
      }
      pending += chunk.toString('utf8');
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const [key, rawValue] = line.split('=', 2);
        if ((key === 'out_time_us' || key === 'out_time_ms') && duration && duration > 0) {
          const elapsedSeconds = Number(rawValue) / 1_000_000;
          if (Number.isFinite(elapsedSeconds)) {
            updateJob(job, {
              progress: Math.max(job.progress, Math.min(94, 5 + (elapsedSeconds / duration) * 89)),
            });
          }
        } else if (key === 'progress' && rawValue === 'continue' && !duration) {
          if (job.progress < 90) updateJob(job, { progress: job.progress + 2 });
        }
      }
    };

    const args = [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-i',
      job.inputPath,
      ...ffmpegOutputArguments(job.outputFormat, job.preset),
      '-progress',
      'pipe:1',
      '-nostats',
      job.outputPath,
    ];
    const result = await this.#runProcess(job, command, args, progress);
    if (result.code !== 0) throw new Error('ffmpeg failed.');
  }

  async #probeDuration(job: InternalJob): Promise<number | undefined> {
    const command = this.#tools.ffprobe.command;
    if (!this.#tools.ffprobe.available || !command) return undefined;
    return await new Promise((resolve) => {
      if (job.cancelRequested) {
        resolve(undefined);
        return;
      }
      const child = spawn(
        command,
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          job.inputPath,
        ],
        { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      job.child = child;
      let value = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        if (value.length < 128) value += chunk.toString('utf8', 0, 128 - value.length);
      });
      const timeout = setTimeout(() => void this.#terminateChild(job, child), 5_000);
      timeout.unref();
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (job.child === child) job.child = undefined;
        const duration = Number(value.trim());
        resolve(Number.isFinite(duration) && duration > 0 ? duration : undefined);
      };
      child.once('error', finish);
      child.once('close', finish);
    });
  }

  async #runProcess(
    job: InternalJob,
    command: string,
    args: string[],
    onProgress: (chunk?: Buffer) => void,
  ): Promise<ProcessResult> {
    if (job.cancelRequested) throw new CanceledError();
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      job.child = child;
      child.stdout?.on('data', (chunk: Buffer) => onProgress(chunk));
      // Drain diagnostics so the process cannot block. They are deliberately not
      // logged or returned because native tools include local filenames in them.
      child.stderr?.on('data', () => undefined);

      const heartbeat = setInterval(() => onProgress(), 2_000);
      heartbeat.unref();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        void this.#terminateChild(job, child);
      }, this.#options.limits.processTimeoutMs);
      timeout.unref();

      let settled = false;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearInterval(heartbeat);
        clearTimeout(timeout);
        if (job.child === child) job.child = undefined;
        callback();
      };
      child.once('error', () => finish(() => reject(new Error('Native tool failed to start.'))));
      child.once('close', (code, signal) =>
        finish(() => {
          if (job.cancelRequested) reject(new CanceledError());
          else if (timedOut) reject(new ProcessTimeoutError());
          else resolve({ code, signal });
        }),
      );
    });
  }

  async #terminateChild(job: InternalJob, expectedChild?: ChildProcess): Promise<void> {
    const child = expectedChild ?? job.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    let closed = false;
    const closedPromise = new Promise<void>((resolveClose) => {
      child.once('close', () => {
        closed = true;
        resolveClose();
      });
    });
    child.kill('SIGTERM');
    let graceTimer: NodeJS.Timeout | undefined;
    await Promise.race([
      closedPromise,
      new Promise<void>((resolveGrace) => {
        graceTimer = setTimeout(resolveGrace, 3_000);
        graceTimer.unref();
      }),
    ]);
    if (graceTimer) clearTimeout(graceTimer);

    if (!closed && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    // Do not clear the job's child reference or remove its working directory until
    // all stdio handles have closed. This also prevents server shutdown from
    // leaving an encoder or LibreOffice process behind.
    await closedPromise;
  }

  async #removeArtifacts(job: InternalJob): Promise<void> {
    await rm(job.directory, { recursive: true, force: true });
  }
}
