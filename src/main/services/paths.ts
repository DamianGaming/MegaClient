import { app } from 'electron'
import path from 'node:path'

export const launcherRootName = 'megaclient'

export function dataDirectory(): string {
  return app.getPath('userData')
}

export function emlRootDirectory(): string {
  if (process.platform === 'darwin') {
    return path.join(app.getPath('appData'), launcherRootName)
  }
  if (process.platform === 'win32') {
    return path.join(app.getPath('appData'), `.${launcherRootName}`)
  }
  return path.join(app.getPath('home'), `.${launcherRootName}`)
}

export function instanceDirectory(slug: string): string {
  return path.join(emlRootDirectory(), slug)
}

export function modsDirectory(slug: string): string {
  return path.join(instanceDirectory(slug), 'mods')
}

export function metadataDirectory(slug: string): string {
  return path.join(instanceDirectory(slug), '.megaclient')
}

export function resourcePacksDirectory(slug: string): string {
  return path.join(instanceDirectory(slug), 'resourcepacks')
}

export function shaderPacksDirectory(slug: string): string {
  return path.join(instanceDirectory(slug), 'shaderpacks')
}

export function savesDirectory(slug: string): string {
  return path.join(instanceDirectory(slug), 'saves')
}
