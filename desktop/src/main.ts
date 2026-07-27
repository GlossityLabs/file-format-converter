import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import {
  isInstalledApplicationExecutable,
  isValidExtensionId,
  readNativeHostRegistration,
  registerNativeHost,
  type NativeHostRegistration,
} from './native-registration.js';
import { UpdateManager, type UpdateSnapshot } from './update-manager.js';
import { isNewerRelease } from './version-policy.js';

type EngineLifecycle = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

interface ToolCapability {
  available: boolean;
  version?: string;
  detail?: string;
}

interface PublicRecipe {
  input: string;
  output: string;
  requires: string;
  available: boolean;
}

interface CapabilitiesResponse {
  service: string;
  version: string;
  paired: boolean;
  tools: Record<string, ToolCapability>;
  recipes: PublicRecipe[];
}

interface CompanionOptions {
  host: string;
  port: number;
  tokenFile: string;
  pairingToken?: string;
}

interface CompanionService {
  options: CompanionOptions;
  tokenFile: string;
  port: number;
  start(): Promise<void>;
  close(): Promise<void>;
}

interface CompanionServerModule {
  createCompanionService(): Promise<CompanionService>;
}

interface CompanionTokenModule {
  readPairingToken(): Promise<string>;
}

interface CompanionConfigModule {
  loadRuntimeOptions(): CompanionOptions;
}

interface EngineSnapshot {
  state: EngineLifecycle;
  managedByApp: boolean;
  previewBuild: boolean;
  port?: number;
  baseUrl?: string;
  tokenAvailable: boolean;
  capabilities?: CapabilitiesResponse;
  error?: string;
  startedAt?: string;
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(moduleDirectory, '..');
const ALLOWED_HELP_URLS = new Set([
  'https://www.libreoffice.org/download/download-libreoffice/',
  'https://ffmpeg.org/download.html#build-mac',
]);
const TOOL_REFRESH_INTERVAL_MS = 15_000;

let mainWindow: BrowserWindow | undefined;
let service: CompanionService | undefined;
let pairingToken: string | undefined;
let operationQueue: Promise<void> = Promise.resolve();
let updateManager: UpdateManager | undefined;
let nativeRegistrationError: string | undefined;
let replacementRelaunchStarted = false;
let toolRefreshTimer: NodeJS.Timeout | undefined;
let snapshot: EngineSnapshot = {
  state: 'stopped',
  managedByApp: false,
  previewBuild: false,
  tokenAvailable: false,
};

function companionDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'companion')
    : resolve(desktopDirectory, '..', 'dist-companion');
}

async function importCompanionFile<T>(fileName: string): Promise<T> {
  const fileUrl = pathToFileURL(join(companionDirectory(), fileName)).href;
  return (await import(fileUrl)) as T;
}

function publicSnapshot(): EngineSnapshot {
  return structuredClone(snapshot);
}

function broadcastSnapshot(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('engine:state', publicSnapshot());
  }
}

function broadcastUpdateSnapshot(update: UpdateSnapshot): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:state', structuredClone(update));
  }
}

function updateSnapshot(next: Partial<EngineSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  broadcastSnapshot();
}

function friendlyEngineError(error: unknown): string {
  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError.code === 'EADDRINUSE') {
    return 'Another copy of the local engine is already using its connection port.';
  }
  if (nodeError.code === 'ENOENT') {
    return 'A required engine file could not be found. Reinstall Format Forge and try again.';
  }
  return error instanceof Error && error.message.length <= 240
    ? error.message
    : 'The local engine could not start.';
}

async function readToken(): Promise<string> {
  const tokenModule = await importCompanionFile<CompanionTokenModule>('token.js');
  return await tokenModule.readPairingToken();
}

async function fetchCapabilities(baseUrl: string, token: string): Promise<CapabilitiesResponse> {
  const response = await fetch(`${baseUrl}/v1/capabilities`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error('The engine started but its capabilities could not be read.');
  return (await response.json()) as CapabilitiesResponse;
}

async function healthIsReady(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(750) });
    return response.ok;
  } catch {
    return false;
  }
}

async function adoptExistingEngine(): Promise<boolean> {
  const configModule = await importCompanionFile<CompanionConfigModule>('config.js');
  const options = configModule.loadRuntimeOptions();
  const baseUrl = `http://${options.host}:${options.port}`;
  if (!(await healthIsReady(baseUrl))) return false;

  const token = await readToken();
  const capabilities = await fetchCapabilities(baseUrl, token);
  if (app.isPackaged && capabilities.version !== app.getVersion()) {
    throw new Error(
      `Format Forge ${capabilities.version} is still running. Quit it completely, then reopen Format Forge ${app.getVersion()}.`,
    );
  }
  pairingToken = token;
  updateSnapshot({
    state: 'running',
    managedByApp: false,
    port: options.port,
    baseUrl,
    tokenAvailable: true,
    capabilities,
    error: undefined,
    startedAt: new Date().toISOString(),
  });
  return true;
}

async function startEngineNow(): Promise<EngineSnapshot> {
  if (snapshot.state === 'running') return publicSnapshot();
  updateSnapshot({ state: 'starting', error: undefined });

  try {
    const extensionId = await bundledExtensionId();
    if (extensionId) {
      process.env.FORMAT_FORGE_ALLOWED_ORIGINS = `chrome-extension://${extensionId}`;
    } else if (app.isPackaged) {
      throw new Error('This app build is missing its trusted Chrome extension ID.');
    }
    if (await adoptExistingEngine()) return publicSnapshot();

    const serverModule = await importCompanionFile<CompanionServerModule>('server.js');
    const candidate = await serverModule.createCompanionService();
    await candidate.start();
    service = candidate;
    pairingToken = candidate.options.pairingToken ?? (await readToken());
    const baseUrl = `http://${candidate.options.host}:${candidate.port}`;
    const capabilities = await fetchCapabilities(baseUrl, pairingToken);
    updateSnapshot({
      state: 'running',
      managedByApp: true,
      port: candidate.port,
      baseUrl,
      tokenAvailable: true,
      capabilities,
      error: undefined,
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Format Forge Local Engine failed to start:', error);
    await service?.close().catch(() => undefined);
    service = undefined;
    pairingToken = undefined;
    updateSnapshot({
      state: 'error',
      managedByApp: false,
      tokenAvailable: false,
      capabilities: undefined,
      error: friendlyEngineError(error),
    });
  }
  return publicSnapshot();
}

async function refreshEngineToolsNow(): Promise<EngineSnapshot> {
  if (
    snapshot.state !== 'running'
    || !snapshot.baseUrl
    || (!pairingToken && !snapshot.tokenAvailable)
  ) {
    return publicSnapshot();
  }

  try {
    pairingToken ??= await readToken();
    const capabilities = await fetchCapabilities(snapshot.baseUrl, pairingToken);
    updateSnapshot({ capabilities, error: undefined });
  } catch (error) {
    updateSnapshot({
      error: `Installed tools could not be checked: ${friendlyEngineError(error)}`,
    });
  }
  return publicSnapshot();
}

async function stopEngineNow(): Promise<EngineSnapshot> {
  if (snapshot.state === 'stopped') return publicSnapshot();
  if (!service) {
    updateSnapshot({
      error: 'This engine was started outside the app, so it must be stopped from the app that started it.',
    });
    return publicSnapshot();
  }

  updateSnapshot({ state: 'stopping', error: undefined });
  try {
    await service.close();
    service = undefined;
    pairingToken = undefined;
    snapshot = {
      state: 'stopped',
      managedByApp: false,
      previewBuild: isPreviewBuild(),
      tokenAvailable: false,
    };
    broadcastSnapshot();
  } catch (error) {
    updateSnapshot({ state: 'error', error: friendlyEngineError(error) });
  }
  return publicSnapshot();
}

function enqueueEngineOperation(
  operation: () => Promise<EngineSnapshot>,
): Promise<EngineSnapshot> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function createWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 900,
    height: 760,
    minWidth: 720,
    minHeight: 620,
    title: 'Format Forge',
    backgroundColor: '#090b10',
    show: false,
    webPreferences: {
      preload: join(moduleDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void mainWindow.loadFile(join(desktopDirectory, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    broadcastSnapshot();
    if (updateManager) broadcastUpdateSnapshot(updateManager.getSnapshot());
  });
  mainWindow.on('focus', () => {
    void enqueueEngineOperation(refreshEngineToolsNow);
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
  return mainWindow;
}

function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Format Forge',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Show Format Forge', click: () => createWindow() },
        {
          label: 'Start Local Engine',
          click: () => void enqueueEngineOperation(startEngineNow),
        },
        {
          label: 'Stop Local Engine',
          click: () => void enqueueEngineOperation(stopEngineNow),
        },
        {
          label: 'Check for Updates…',
          click: () => {
            createWindow();
            void updateManager?.check();
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function bundledExtensionId(): Promise<string | undefined> {
  const environmentId = process.env.FORMAT_FORGE_EXTENSION_ID?.trim();
  if (environmentId && isValidExtensionId(environmentId)) return environmentId;

  const path = app.isPackaged
    ? join(process.resourcesPath, 'extension-id.txt')
    : join(desktopDirectory, 'assets', 'extension-id.txt');
  try {
    const lines = (await readFile(path, 'utf8'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    return lines.find(isValidExtensionId);
  } catch {
    return undefined;
  }
}

function nativeHostExecutablePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'native-host', 'format-forge-native-host')
    : join(desktopDirectory, 'assets', 'format-forge-native-host');
}

function isInstalledInApplications(): boolean {
  return app.isPackaged && isInstalledApplicationExecutable(app.getPath('exe'), app.getPath('home'));
}

function isPreviewBuild(): boolean {
  return app.isPackaged
    && app.getPath('exe').endsWith(
      join('Format Forge Preview.app', 'Contents', 'MacOS', 'Format Forge Preview'),
    );
}

function configurePreviewIsolation(): void {
  if (!isPreviewBuild()) return;
  app.setName('Format Forge Preview');
  const previewUserData = join(app.getPath('appData'), 'Format Forge Preview');
  mkdirSync(previewUserData, { recursive: true, mode: 0o700 });
  app.setPath('userData', previewUserData);
  process.env.FORMAT_FORGE_PORT ??= '43124';
  process.env.FORMAT_FORGE_CONFIG_DIR ??= join(app.getPath('userData'), 'engine');
  process.env.FORMAT_FORGE_TEMP_DIR ??= join(app.getPath('temp'), 'format-forge-preview-companion');
}

function friendlyRegistrationError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  return message && message.length <= 200
    ? `Chrome setup could not be repaired: ${message}`
    : 'Chrome setup could not be repaired. Reopen Format Forge or use Register with Chrome.';
}

async function nativeHostStatus(): Promise<NativeHostRegistration> {
  const status = await readNativeHostRegistration(nativeHostExecutablePath());
  if (isPreviewBuild()) {
    return {
      ...status,
      registered: false,
      executableMatches: false,
      canRegister: false,
      reason: 'Preview is isolated and cannot replace the production Chrome connection.',
    };
  }
  if (!app.isPackaged && !status.registered) {
    return {
      ...status,
      reason: 'Native Chrome registration becomes available in the packaged Mac app.',
    };
  }
  if (app.isPackaged && !isInstalledInApplications()) {
    return {
      ...status,
      registered: false,
      executableMatches: false,
      reason: 'Move Format Forge to Applications, then open it again to finish Chrome setup.',
    };
  }
  if (nativeRegistrationError && !(status.registered && status.executableMatches)) {
    return {
      ...status,
      reason: nativeRegistrationError,
    };
  }
  return status;
}

async function registerBrowserConnection(requestedId?: string): Promise<unknown> {
  if (isPreviewBuild()) {
    throw new Error('Format Forge Preview cannot replace the production Chrome connection.');
  }
  if (!app.isPackaged) {
    throw new Error('Build the packaged Mac app before registering its Chrome connection.');
  }
  if (!isInstalledInApplications()) {
    throw new Error('Move Format Forge to Applications, then open it again before connecting Chrome.');
  }
  const extensionId = requestedId?.trim() || (await bundledExtensionId());
  if (!extensionId) {
    throw new Error('This build does not contain a Chrome extension ID. Add the release extension ID first.');
  }
  try {
    const registration = await registerNativeHost(nativeHostExecutablePath(), extensionId);
    nativeRegistrationError = undefined;
    return registration;
  } catch (error) {
    nativeRegistrationError = friendlyRegistrationError(error);
    throw error;
  }
}

async function closeEngineForUpdate(): Promise<void> {
  await service?.close();
  service = undefined;
  pairingToken = undefined;
}

async function relaunchFromNewerInstalledApplication(
  incomingVersion: string,
  incomingExecutable: string,
): Promise<void> {
  if (replacementRelaunchStarted) return;
  if (!isInstalledApplicationExecutable(incomingExecutable, app.getPath('home'))) return;
  if (!isNewerRelease(incomingVersion, app.getVersion())) return;
  replacementRelaunchStarted = true;
  updateSnapshot({
    state: 'stopping',
    error: undefined,
  });
  await closeEngineForUpdate().catch(() => undefined);
  app.relaunch({ execPath: incomingExecutable });
  app.quit();
}

function installIpcHandlers(): void {
  ipcMain.handle('engine:get-state', () => publicSnapshot());
  ipcMain.handle('engine:start', () => enqueueEngineOperation(startEngineNow));
  ipcMain.handle('engine:stop', () => enqueueEngineOperation(stopEngineNow));
  ipcMain.handle('engine:refresh-tools', () => enqueueEngineOperation(refreshEngineToolsNow));
  ipcMain.handle('pairing:get-token', async () => {
    if (!pairingToken && snapshot.state === 'running') pairingToken = await readToken();
    if (!pairingToken) throw new Error('Start the local engine before revealing its pairing code.');
    return pairingToken;
  });
  ipcMain.handle('pairing:copy-token', async () => {
    if (!pairingToken && snapshot.state === 'running') pairingToken = await readToken();
    if (!pairingToken) throw new Error('Start the local engine before copying its pairing code.');
    clipboard.writeText(pairingToken);
    return true;
  });
  ipcMain.handle('settings:get-login-item', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('settings:set-login-item', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Start-at-login must be on or off.');
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('native-host:get-status', () => nativeHostStatus());
  ipcMain.handle('native-host:register', (_event, extensionId: unknown) => {
    if (extensionId !== undefined && typeof extensionId !== 'string') {
      throw new Error('The Chrome extension ID must be text.');
    }
    return registerBrowserConnection(extensionId);
  });
  ipcMain.handle('update:get-state', () => updateManager?.getSnapshot() ?? {
    state: 'disabled',
    currentVersion: app.getVersion(),
    message: 'The update service has not started yet.',
  });
  ipcMain.handle('update:check', () => updateManager?.check() ?? Promise.resolve({
    state: 'disabled',
    currentVersion: app.getVersion(),
    message: 'Automatic updates are unavailable in this build.',
  }));
  ipcMain.handle('update:install', () => {
    if (!updateManager) throw new Error('The update service is unavailable.');
    return updateManager.install(closeEngineForUpdate);
  });
  ipcMain.handle('help:open-url', async (_event, value: unknown) => {
    if (typeof value !== 'string' || !ALLOWED_HELP_URLS.has(value)) {
      throw new Error('That help link is not allowed.');
    }
    await shell.openExternal(value);
    return true;
  });
}

async function startDesktopApplication(): Promise<void> {
  configurePreviewIsolation();
  snapshot.previewBuild = isPreviewBuild();
  const hasLock = app.requestSingleInstanceLock({
    version: app.getVersion(),
    executablePath: app.getPath('exe'),
  });
  if (!hasLock) {
    app.exit(0);
    return;
  }

  app.on('second-instance', (_event, _argv, _workingDirectory, additionalData) => {
    const incoming =
      typeof additionalData === 'object' && additionalData !== null
        ? additionalData as Record<string, unknown>
        : {};
    const incomingVersion =
      typeof incoming.version === 'string' ? incoming.version : undefined;
    const incomingExecutable =
      typeof incoming.executablePath === 'string'
        ? incoming.executablePath
        : undefined;
    if (incomingVersion && incomingExecutable && isNewerRelease(incomingVersion, app.getVersion())) {
      void relaunchFromNewerInstalledApplication(incomingVersion, incomingExecutable);
      return;
    }
    void app.whenReady().then(() => createWindow());
  });
  await app.whenReady();
  installApplicationMenu();
  installIpcHandlers();

  const configuredId = await bundledExtensionId();
  if (app.isPackaged && configuredId && isInstalledInApplications()) {
    await registerBrowserConnection(configuredId).catch((error) => {
      console.error(nativeRegistrationError ?? friendlyRegistrationError(error));
    });
  }

  updateManager = new UpdateManager({
    currentVersion: app.getVersion(),
    enabled: isInstalledInApplications(),
    disabledReason: isPreviewBuild()
      ? 'Preview builds are isolated from production and do not update automatically.'
      : app.isPackaged
        ? 'Move Format Forge to Applications to enable automatic updates.'
        : 'Automatic updates are available only in the signed production app.',
    onState: broadcastUpdateSnapshot,
  });

  const engineOnly = process.argv.includes('--engine-only');
  const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;
  if (!engineOnly && !openedAtLogin) createWindow();
  void enqueueEngineOperation(startEngineNow);
  toolRefreshTimer = setInterval(() => {
    const primaryTools = snapshot.capabilities?.tools;
    const needsRefresh =
      primaryTools?.libreoffice?.available !== true
      || primaryTools?.ffmpeg?.available !== true;
    if (
      snapshot.state === 'running'
      && needsRefresh
      && mainWindow
      && !mainWindow.isDestroyed()
      && mainWindow.isVisible()
    ) {
      void enqueueEngineOperation(refreshEngineToolsNow);
    }
  }, TOOL_REFRESH_INTERVAL_MS);
  toolRefreshTimer.unref();

  app.on('activate', () => createWindow());
  app.on('before-quit', () => {
    if (toolRefreshTimer) clearInterval(toolRefreshTimer);
    toolRefreshTimer = undefined;
    updateManager?.dispose();
    void service?.close();
  });
}

void startDesktopApplication().catch((error: unknown) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error('Format Forge failed during startup:', detail);
  try {
    const logDirectory = join(app.getPath('userData'), 'logs');
    mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(logDirectory, 'startup-error.log'),
      `${new Date().toISOString()}\n${detail}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  } catch {
    // The visible alert below remains the fallback when the log cannot be written.
  }
  dialog.showErrorBox(
    'Format Forge could not start',
    'Quit any older Format Forge process and reopen the app. If the problem continues, reinstall the latest signed release.',
  );
  app.exit(1);
});
