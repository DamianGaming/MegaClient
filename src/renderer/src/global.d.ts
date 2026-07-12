export {}

declare global {
  interface Window {
    mega: {
      window: { minimize(): Promise<void>; maximize(): Promise<void>; close(): Promise<void> }
      consoleWindow: { minimize(): Promise<void>; maximize(): Promise<void>; close(): Promise<void> }
      app: {
        bootstrap(): Promise<any>
        rendererReady(): Promise<void>
        getVersions(includeSnapshots: boolean): Promise<Array<{ id: string; type: string }>>
        getLoaderVersions(loader: string, version: string): Promise<string[]>
        checkUpdates(): Promise<any>
        installUpdate(): Promise<void>
        onUpdate(callback: (event: any) => void): () => void
        onSplashProgress(callback: (event: { value: number; message: string }) => void): () => void
      }
      account: {
        login(): Promise<any>
        logout(): Promise<void>
        profile(force?: boolean): Promise<any>
        chooseSkin(): Promise<string | null>
        setSkin(file: string, variant: 'classic' | 'slim'): Promise<any>
        setCape(capeId?: string): Promise<any>
      }
      instances: {
        create(input: any): Promise<any>
        update(id: string, patch: any): Promise<any>
        delete(id: string): Promise<void>
        select(id: string): Promise<void>
        openFolder(id: string): Promise<void>
        addLocalMod(id: string): Promise<number>
        launch(id: string): Promise<boolean>
        launchServer(id: string, address: string): Promise<boolean>
        openConsole(): Promise<void>
      }
      mods: {
        search(input: any): Promise<any>
        install(instanceId: string, projectId: string): Promise<any>
        installModpack(instanceId: string, projectId: string): Promise<any>
        list(instanceId: string): Promise<any[]>
        setEnabled(instanceId: string, fileName: string, enabled: boolean): Promise<void>
        remove(instanceId: string, fileName: string): Promise<void>
        update(instanceId: string, projectId: string): Promise<any>
        updateAll(instanceId: string): Promise<number>
        onProgress(callback: (event: any) => void): () => void
      }
      packs: {
        install(instanceId: string, projectId: string, type: 'resourcepack' | 'shader'): Promise<any>
        list(instanceId: string, type?: 'resourcepack' | 'shader'): Promise<any[]>
        setEnabled(instanceId: string, fileName: string, type: 'resourcepack' | 'shader', enabled: boolean): Promise<void>
        remove(instanceId: string, fileName: string, type: 'resourcepack' | 'shader'): Promise<void>
        openFolder(instanceId: string, type: 'resourcepack' | 'shader'): Promise<void>
      }
      worlds: {
        list(instanceId: string): Promise<any[]>
        importZip(instanceId: string): Promise<any | null>
        download(instanceId: string, url: string): Promise<any>
        delete(instanceId: string, worldId: string): Promise<void>
        openFolder(instanceId: string, worldId?: string): Promise<void>
      }
      servers: { copyAddress(address: string): Promise<void>; status(address: string, force?: boolean): Promise<any> }
      settings: { update(patch: any): Promise<any> }
      launchEvents: {
        onProgress(callback: (event: any) => void): () => void
        onError(callback: (event: any) => void): () => void
        onWarning(callback: (event: any) => void): () => void
        onClosed(callback: (event: any) => void): () => void
      }
    }
  }
}

declare module '*.css'
