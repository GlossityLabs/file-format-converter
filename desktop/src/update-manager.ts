import electronUpdater, {
  type ProgressInfo,
  type UpdateInfo,
} from 'electron-updater';

const { autoUpdater } = electronUpdater;

export type UpdateLifecycle =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'current'
  | 'installing'
  | 'error';

export interface UpdateSnapshot {
  state: UpdateLifecycle;
  currentVersion: string;
  availableVersion?: string;
  progress?: number;
  message?: string;
  checkedAt?: string;
}

interface UpdateManagerOptions {
  currentVersion: string;
  enabled: boolean;
  disabledReason?: string;
  onState: (snapshot: UpdateSnapshot) => void;
}

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const INITIAL_UPDATE_CHECK_DELAY_MS = 10_000;

function safeUpdateError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  if (!message) return 'Format Forge could not check for updates.';
  return message.length <= 240
    ? `Format Forge could not check for updates: ${message}`
    : 'Format Forge could not check for updates.';
}

export class UpdateManager {
  readonly #options: UpdateManagerOptions;
  #snapshot: UpdateSnapshot;
  #initialTimer?: NodeJS.Timeout;
  #intervalTimer?: NodeJS.Timeout;
  #checking?: Promise<UpdateSnapshot>;

  constructor(options: UpdateManagerOptions) {
    this.#options = options;
    this.#snapshot = {
      state: options.enabled ? 'idle' : 'disabled',
      currentVersion: options.currentVersion,
      message: options.enabled
        ? 'Format Forge checks for signed updates automatically.'
        : options.disabledReason ?? 'Automatic updates are unavailable in this build.',
    };
    this.#installEventHandlers();
    this.#emit();

    if (options.enabled) {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.allowDowngrade = false;
      autoUpdater.allowPrerelease = false;
      this.#initialTimer = setTimeout(() => {
        void this.check(false);
      }, INITIAL_UPDATE_CHECK_DELAY_MS);
      this.#initialTimer.unref();
      this.#intervalTimer = setInterval(() => {
        void this.check(false);
      }, UPDATE_CHECK_INTERVAL_MS);
      this.#intervalTimer.unref();
    }
  }

  getSnapshot(): UpdateSnapshot {
    return structuredClone(this.#snapshot);
  }

  async check(manual = true): Promise<UpdateSnapshot> {
    if (!this.#options.enabled) return this.getSnapshot();
    if (this.#checking) return this.#checking;
    if (
      this.#snapshot.state === 'downloading'
      || this.#snapshot.state === 'ready'
      || this.#snapshot.state === 'installing'
    ) {
      return this.getSnapshot();
    }

    this.#set({
      state: 'checking',
      progress: undefined,
      message: manual ? 'Checking for a new version…' : 'Checking for updates…',
    });
    const checking = autoUpdater.checkForUpdates()
      .then(() => this.getSnapshot())
      .catch((error: unknown) => {
        this.#set({
          state: 'error',
          message: safeUpdateError(error),
          checkedAt: new Date().toISOString(),
        });
        return this.getSnapshot();
      })
      .finally(() => {
        if (this.#checking === checking) this.#checking = undefined;
      });
    this.#checking = checking;
    return checking;
  }

  async install(beforeInstall: () => Promise<void>): Promise<UpdateSnapshot> {
    if (this.#snapshot.state !== 'ready') {
      throw new Error('Download the update before restarting Format Forge.');
    }
    this.#set({
      state: 'installing',
      progress: 100,
      message: 'Closing the Local Engine and installing the update…',
    });
    try {
      await beforeInstall();
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      this.#set({ state: 'error', message: safeUpdateError(error) });
      throw error;
    }
    return this.getSnapshot();
  }

  dispose(): void {
    if (this.#initialTimer) clearTimeout(this.#initialTimer);
    if (this.#intervalTimer) clearInterval(this.#intervalTimer);
  }

  #installEventHandlers(): void {
    if (!this.#options.enabled) return;
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.#set({
        state: 'downloading',
        availableVersion: info.version,
        progress: 0,
        message: `Downloading Format Forge ${info.version}…`,
      });
    });
    autoUpdater.on('update-not-available', () => {
      this.#set({
        state: 'current',
        availableVersion: undefined,
        progress: undefined,
        message: `Format Forge ${this.#options.currentVersion} is up to date.`,
        checkedAt: new Date().toISOString(),
      });
    });
    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      const percentage = Math.max(0, Math.min(100, Math.round(progress.percent)));
      this.#set({
        state: 'downloading',
        progress: percentage,
        message: `Downloading the update… ${percentage}%`,
      });
    });
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.#set({
        state: 'ready',
        availableVersion: info.version,
        progress: 100,
        message: `Format Forge ${info.version} is ready. Restart to finish the update.`,
        checkedAt: new Date().toISOString(),
      });
    });
    autoUpdater.on('error', (error: Error) => {
      this.#set({
        state: 'error',
        message: safeUpdateError(error),
        checkedAt: new Date().toISOString(),
      });
    });
  }

  #set(next: Partial<UpdateSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...next };
    this.#emit();
  }

  #emit(): void {
    this.#options.onState(this.getSnapshot());
  }
}
