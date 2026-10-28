import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { LauncherInstance, LoaderType } from '../types'
import { store } from './store'
import { instanceDirectory, metadataDirectory, modsDirectory } from './paths'
import { getLoaderVersions } from './versions'
import { protectedClientFor } from './protectedClientVersions'

const pendingSlugs = new Set<string>()

function slugify(value: string): string {
  const base = value.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-')
  return base || `instance-${Date.now()}`
}

export async function createInstance(input: {
  name: string
  minecraftVersion: string
  loader: LoaderType
  loaderVersion?: string
  customClient?: boolean
  autoUpdateLoader?: boolean
}): Promise<LauncherInstance> {
  const name = input.name?.trim()
  const minecraftVersion = input.minecraftVersion?.trim() ?? ''
  if (input.customClient) protectedClientFor(minecraftVersion)
  const loader: LoaderType = input.customClient ? 'fabric' : input.loader
  if (!name || name.length > 48) throw new Error('Instance names must be 1–48 characters long.')
  if (!minecraftVersion) throw new Error('Choose a Minecraft version before creating an instance.')
  if (!['vanilla', 'fabric', 'forge', 'neoforge'].includes(loader)) throw new Error('Unsupported Minecraft loader.')
  // Resolve missing versions here as well as in the UI. Imports and future API
  // callers must never create an instance which cannot be launched.
  const loaderVersion = loader === 'vanilla' ? undefined : (input.loaderVersion?.trim() || (await getLoaderVersions(loader, minecraftVersion))[0])
  if (loader !== 'vanilla' && !loaderVersion) throw new Error(`No ${loader} loader is available for Minecraft ${minecraftVersion}.`)
  const data = store.getData()
  const base = slugify(name)
  let slug = base
  let suffix = 2
  while (data.instances.some((instance) => instance.slug === slug) || pendingSlugs.has(slug)) slug = `${base}-${suffix++}`
  pendingSlugs.add(slug)
  const now = new Date().toISOString()
  const instance: LauncherInstance = {
    id: randomUUID(),
    name,
    slug,
    minecraftVersion,
    loader,
    loaderVersion,
    autoUpdateLoader: loader !== 'vanilla' && (Boolean(input.customClient) || input.autoUpdateLoader === true),
    createdAt: now,
    updatedAt: now,
    customClient: Boolean(input.customClient)
  }
  try {
    await fs.mkdir(modsDirectory(slug), { recursive: true })
    await fs.mkdir(metadataDirectory(slug), { recursive: true })
    // Read the current snapshot after asynchronous disk work so simultaneous
    // creations cannot overwrite an instance created by the other request.
    await store.setInstances([...store.getData().instances, instance])
    await store.selectInstance(instance.id)
    return instance
  } finally {
    pendingSlugs.delete(slug)
  }
}

export async function updateInstance(id: string, patch: Partial<LauncherInstance>): Promise<LauncherInstance> {
  const data = store.getData()
  const current = data.instances.find((instance) => instance.id === id)
  if (!current) throw new Error('Instance not found.')
  const updated: LauncherInstance = { ...current, ...patch, id: current.id, slug: current.slug, updatedAt: new Date().toISOString() }
  if ((patch.loader && patch.loader !== current.loader) || (patch.minecraftVersion && patch.minecraftVersion !== current.minecraftVersion)) {
    if (patch.loaderVersion === undefined) updated.loaderVersion = undefined
  }
  if (updated.customClient) {
    protectedClientFor(updated.minecraftVersion)
    if (updated.loader !== 'fabric') throw new Error('MegaClient profiles require Fabric Loader.')
  }
  if (updated.loader === 'vanilla') { updated.loaderVersion = undefined; updated.autoUpdateLoader = false }
  await store.setInstances(data.instances.map((instance) => instance.id === id ? updated : instance))
  return updated
}

export async function deleteInstance(id: string): Promise<void> {
  const data = store.getData()
  const instance = data.instances.find((item) => item.id === id)
  if (!instance) return
  await fs.rm(instanceDirectory(instance.slug), { recursive: true, force: true })
  await store.setInstances(data.instances.filter((item) => item.id !== id))
}

export function getInstance(id: string): LauncherInstance {
  const instance = store.getData().instances.find((item) => item.id === id)
  if (!instance) throw new Error('Instance not found.')
  return instance
}

export async function openInstanceFolder(id: string): Promise<string> {
  const instance = getInstance(id)
  await fs.mkdir(instanceDirectory(instance.slug), { recursive: true })
  return instanceDirectory(instance.slug)
}

export async function copyLocalMod(id: string, source: string): Promise<void> {
  const instance = getInstance(id)
  const extension = path.extname(source).toLowerCase()
  if (extension !== '.jar') throw new Error('Only .jar mod files can be added.')
  await fs.mkdir(modsDirectory(instance.slug), { recursive: true })
  await fs.copyFile(source, path.join(modsDirectory(instance.slug), path.basename(source)))
}
