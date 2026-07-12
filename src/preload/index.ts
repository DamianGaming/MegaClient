import { contextBridge, ipcRenderer } from 'electron'

const api = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close')
  },
  consoleWindow: {
    minimize: () => ipcRenderer.invoke('console-window:minimize'),
    maximize: () => ipcRenderer.invoke('console-window:maximize'),
    close: () => ipcRenderer.invoke('console-window:close')
  },
  app: {
    bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
    rendererReady: () => ipcRenderer.invoke('app:renderer-ready'),
    getVersions: (includeSnapshots: boolean) => ipcRenderer.invoke('versions:minecraft', includeSnapshots),
    getLoaderVersions: (loader: string, version: string) => ipcRenderer.invoke('versions:loader', loader, version),
    checkUpdates: () => ipcRenderer.invoke('updates:check'),
    installUpdate: () => ipcRenderer.invoke('updates:install'),
    onUpdate: (callback: (event: unknown) => void) => {
      const listener = (_: unknown, payload: unknown) => callback(payload)
      ipcRenderer.on('updates:event', listener)
      return () => ipcRenderer.removeListener('updates:event', listener)
    },
    onSplashProgress: (callback: (event: { value: number; message: string }) => void) => {
      const listener = (_: unknown, payload: { value: number; message: string }) => callback(payload)
      ipcRenderer.on('splash:progress', listener)
      return () => ipcRenderer.removeListener('splash:progress', listener)
    }
  },
  account: {
    login: () => ipcRenderer.invoke('account:login'),
    logout: () => ipcRenderer.invoke('account:logout'),
    profile: (force = false) => ipcRenderer.invoke('account:profile', force),
    chooseSkin: () => ipcRenderer.invoke('account:choose-skin'),
    setSkin: (file: string, variant: 'classic' | 'slim') => ipcRenderer.invoke('account:set-skin', file, variant),
    setCape: (capeId?: string) => ipcRenderer.invoke('account:set-cape', capeId)
  },
  instances: {
    create: (input: unknown) => ipcRenderer.invoke('instances:create', input),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('instances:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('instances:delete', id),
    select: (id: string) => ipcRenderer.invoke('instances:select', id),
    openFolder: (id: string) => ipcRenderer.invoke('instances:open-folder', id),
    addLocalMod: (id: string) => ipcRenderer.invoke('instances:add-local-mod', id),
    launch: (id: string) => ipcRenderer.invoke('instances:launch', id),
    launchServer: (id: string, address: string) => ipcRenderer.invoke('instances:launch-server', id, address),
    openConsole: () => ipcRenderer.invoke('instances:open-console')
  },
  mods: {
    search: (input: unknown) => ipcRenderer.invoke('mods:search', input),
    install: (instanceId: string, projectId: string) => ipcRenderer.invoke('mods:install', instanceId, projectId),
    installModpack: (instanceId: string, projectId: string) => ipcRenderer.invoke('mods:install-modpack', instanceId, projectId),
    list: (instanceId: string) => ipcRenderer.invoke('mods:list', instanceId),
    setEnabled: (instanceId: string, fileName: string, enabled: boolean) => ipcRenderer.invoke('mods:set-enabled', instanceId, fileName, enabled),
    remove: (instanceId: string, fileName: string) => ipcRenderer.invoke('mods:remove', instanceId, fileName),
    update: (instanceId: string, projectId: string) => ipcRenderer.invoke('mods:update', instanceId, projectId),
    updateAll: (instanceId: string) => ipcRenderer.invoke('mods:update-all', instanceId),
    onProgress: (callback: (event: unknown) => void) => {
      const listener = (_: unknown, payload: unknown) => callback(payload)
      ipcRenderer.on('mods:progress', listener)
      return () => ipcRenderer.removeListener('mods:progress', listener)
    }
  },
  packs: {
    install: (instanceId: string, projectId: string, type: 'resourcepack' | 'shader') => ipcRenderer.invoke('packs:install', instanceId, projectId, type),
    list: (instanceId: string, type?: 'resourcepack' | 'shader') => ipcRenderer.invoke('packs:list', instanceId, type),
    setEnabled: (instanceId: string, fileName: string, type: 'resourcepack' | 'shader', enabled: boolean) => ipcRenderer.invoke('packs:set-enabled', instanceId, fileName, type, enabled),
    remove: (instanceId: string, fileName: string, type: 'resourcepack' | 'shader') => ipcRenderer.invoke('packs:remove', instanceId, fileName, type),
    openFolder: (instanceId: string, type: 'resourcepack' | 'shader') => ipcRenderer.invoke('packs:open-folder', instanceId, type)
  },
  worlds: {
    list: (instanceId: string) => ipcRenderer.invoke('worlds:list', instanceId),
    importZip: (instanceId: string) => ipcRenderer.invoke('worlds:import', instanceId),
    download: (instanceId: string, url: string) => ipcRenderer.invoke('worlds:download', instanceId, url),
    delete: (instanceId: string, worldId: string) => ipcRenderer.invoke('worlds:delete', instanceId, worldId),
    openFolder: (instanceId: string, worldId?: string) => ipcRenderer.invoke('worlds:open-folder', instanceId, worldId)
  },
  servers: {
    copyAddress: (address: string) => ipcRenderer.invoke('servers:copy-address', address),
    status: (address: string, force = false) => ipcRenderer.invoke('servers:status', address, force)
  },
  settings: {
    update: (patch: unknown) => ipcRenderer.invoke('settings:update', patch)
  },
  launchEvents: {
    onProgress: (callback: (event: unknown) => void) => {
      const listener = (_: unknown, payload: unknown) => callback(payload)
      ipcRenderer.on('launch:progress', listener)
      return () => ipcRenderer.removeListener('launch:progress', listener)
    },
    onError: (callback: (event: unknown) => void) => {
      const listener = (_: unknown, payload: unknown) => callback(payload)
      ipcRenderer.on('launch:error', listener)
      return () => ipcRenderer.removeListener('launch:error', listener)
    },
    onWarning: (callback: (event: unknown) => void) => {
      const listener = (_: unknown, payload: unknown) => callback(payload)
      ipcRenderer.on('launch:warning', listener)
      return () => ipcRenderer.removeListener('launch:warning', listener)
    },
    onClosed: (callback: (event: unknown) => void) => {
      const listener = (_: unknown, payload: unknown) => callback(payload)
      ipcRenderer.on('launch:closed', listener)
      return () => ipcRenderer.removeListener('launch:closed', listener)
    }
  }
}

contextBridge.exposeInMainWorld('mega', api)
export type MegaApi = typeof api
