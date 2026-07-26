import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

/**
 * Bridge for Flank's own chrome UI (manager window and space window chrome
 * views). All channels are namespaced `flank:`.
 */
const api = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(`flank:${channel}`, ...args),
  send: (channel: string, ...args: unknown[]): void =>
    ipcRenderer.send(`flank:${channel}`, ...args),
  on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...args);
    ipcRenderer.on(`flank:${channel}`, wrapped);
    return () => ipcRenderer.removeListener(`flank:${channel}`, wrapped);
  }
};

export type FlankChromeApi = typeof api;

contextBridge.exposeInMainWorld('flank', api);
