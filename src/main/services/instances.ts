import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { LauncherInstance, LoaderType } from '../types'
import { store } from './store'
import { instanceDirectory, metadataDirectory, modsDirectory } from './paths'

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
}): Promise<LauncherInstance> {
  const data = store.getData()
  let slug = slugify(input.name)
  let suffix = 2
  while (data.instances.some((instance) => instance.slug === slug)) slug = `${slugify(input.name)}-${suffix++}`
  const now = new Date().toISOString()
  const instance: LauncherInstance = {
    id: randomUUID(),
    name: input.name.trim(),
    slug,
    minecraftVersion: input.customClient ? '26.2' : input.minecraftVersion,
    loader: input.customClient ? 'fabric' : input.loader,
    loaderVersion: input.loaderVersion,
    createdAt: now,
    updatedAt: now,
    customClient: Boolean(input.customClient)
  }
  await fs.mkdir(modsDirectory(slug), { recursive: true })
  await fs.mkdir(metadataDirectory(slug), { recursive: true })
  await store.setInstances([...data.instances, instance])
  await store.selectInstance(instance.id)
  return instance
}

export async function updateInstance(id: string, patch: Partial<LauncherInstance>): Promise<LauncherInstance> {
  const data = store.getData()
  const current = data.instances.find((instance) => instance.id === id)
  if (!current) throw new Error('Instance not found.')
  const updated: LauncherInstance = { ...current, ...patch, id: current.id, slug: current.slug, updatedAt: new Date().toISOString() }
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
