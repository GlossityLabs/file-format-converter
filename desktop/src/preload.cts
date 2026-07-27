import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const api = {
  getState: () => ipcRenderer.invoke('engine:get-state'),
  startEngine: () => ipcRenderer.invoke('engine:start'),
  stopEngine: () => ipcRenderer.invoke('engine:stop'),
  refreshTools: () => ipcRenderer.invoke('engine:refresh-tools'),
  getPairingToken: () => ipcRenderer.invoke('pairing:get-token'),
  copyPairingToken: () => ipcRenderer.invoke('pairing:copy-token'),
  getLoginItem: () => ipcRenderer.invoke('settings:get-login-item'),
  setLoginItem: (enabled: boolean) => ipcRenderer.invoke('settings:set-login-item', enabled),
  getNativeHostStatus: () => ipcRenderer.invoke('native-host:get-status'),
  registerNativeHost: (extensionId?: string) =>
    ipcRenderer.invoke('native-host:register', extensionId),
  getUpdateState: () => ipcRenderer.invoke('update:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openHelpUrl: (url: string) => ipcRenderer.invoke('help:open-url', url),
  onState: (listener: (state: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, state: unknown): void => listener(state);
    ipcRenderer.on('engine:state', handler);
    return () => ipcRenderer.removeListener('engine:state', handler);
  },
  onUpdateState: (listener: (state: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, state: unknown): void => listener(state);
    ipcRenderer.on('update:state', handler);
    return () => ipcRenderer.removeListener('update:state', handler);
  },
};

contextBridge.exposeInMainWorld('formatForgeDesktop', api);
