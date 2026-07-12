import { safeStorage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AccountEnvelope, AuthenticatedAccount, LauncherInstance, LauncherSettings, StoredData } from '../types'
import { dataDirectory } from './paths'

const defaultSettings: LauncherSettings = {
  memoryMin: 1024,
  memoryMax: 4096,
  width: 1280,
  height: 720,
  fullscreen: false,
  showConsole: true,
  minimizeToTrayOnLaunch: true,
  showSnapshots: false,
  javaMode: 'auto',
  javaPath: '',
  checkUpdates: true,
  reducedMotion: false
}

const defaultData: StoredData = { settings: defaultSettings, instances: [] }
const allowedSettingKeys = new Set<keyof LauncherSettings>(Object.keys(defaultSettings) as Array<keyof LauncherSettings>)

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function atomicWrite(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(temp, file)
}

function normaliseSettings(input: unknown): LauncherSettings {
  const candidate = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const settings = { ...defaultSettings }
  for (const key of allowedSettingKeys) {
    if (candidate[key] !== undefined) (settings as Record<string, unknown>)[key] = candidate[key]
  }

  settings.memoryMin = Math.max(512, Math.min(8192, Number(settings.memoryMin) || defaultSettings.memoryMin))
  settings.memoryMax = Math.max(settings.memoryMin + 512, Math.min(32768, Number(settings.memoryMax) || defaultSettings.memoryMax))
  settings.width = Math.max(640, Math.min(7680, Number(settings.width) || defaultSettings.width))
  settings.height = Math.max(360, Math.min(4320, Number(settings.height) || defaultSettings.height))
  settings.javaPath = typeof settings.javaPath === 'string' ? settings.javaPath.trim() : ''
  if (settings.javaMode !== 'manual') settings.javaMode = 'auto'
  return settings
}

class Store {
  private data: StoredData = structuredClone(defaultData)
  private saveQueue: Promise<void> = Promise.resolve()

  private get dataFile(): string {
    return path.join(dataDirectory(), 'launcher.json')
  }

  private get accountFile(): string {
    return path.join(dataDirectory(), 'account.json')
  }

  async initialize(): Promise<void> {
    const loaded = await readJson<Partial<StoredData>>(this.dataFile, {})
    this.data = {
      settings: normaliseSettings(loaded.settings),
      instances: Array.isArray(loaded.instances) ? loaded.instances : [],
      selectedInstanceId: loaded.selectedInstanceId
    }
    await this.save()
  }

  getData(): StoredData {
    return structuredClone(this.data)
  }

  async updateSettings(patch: Partial<LauncherSettings>): Promise<LauncherSettings> {
    const safePatch: Partial<LauncherSettings> = {}
    for (const [rawKey, value] of Object.entries(patch ?? {})) {
      const key = rawKey as keyof LauncherSettings
      if (allowedSettingKeys.has(key)) (safePatch as Record<string, unknown>)[key] = value
    }
    this.data.settings = normaliseSettings({ ...this.data.settings, ...safePatch })
    await this.save()
    return structuredClone(this.data.settings)
  }

  async setInstances(instances: LauncherInstance[]): Promise<void> {
    this.data.instances = instances
    if (this.data.selectedInstanceId && !instances.some((instance) => instance.id === this.data.selectedInstanceId)) {
      this.data.selectedInstanceId = instances[0]?.id
    }
    await this.save()
  }

  async selectInstance(id: string): Promise<void> {
    this.data.selectedInstanceId = id
    await this.save()
  }

  async save(): Promise<void> {
    const snapshot = structuredClone(this.data)
    this.saveQueue = this.saveQueue.catch(() => undefined).then(() => atomicWrite(this.dataFile, snapshot))
    await this.saveQueue
  }

  async saveAccount(account: AuthenticatedAccount): Promise<void> {
    const raw = Buffer.from(JSON.stringify(account), 'utf8')
    let envelope: AccountEnvelope
    if (safeStorage.isEncryptionAvailable()) {
      envelope = { encrypted: true, value: safeStorage.encryptString(raw.toString('utf8')).toString('base64') }
    } else {
      envelope = { encrypted: false, value: raw.toString('base64') }
    }
    await atomicWrite(this.accountFile, envelope)
  }

  async loadAccount(): Promise<AuthenticatedAccount | null> {
    const envelope = await readJson<AccountEnvelope | null>(this.accountFile, null)
    if (!envelope) return null
    try {
      const bytes = Buffer.from(envelope.value, 'base64')
      const json = envelope.encrypted && safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(bytes)
        : bytes.toString('utf8')
      return JSON.parse(json) as AuthenticatedAccount
    } catch {
      return null
    }
  }

  async clearAccount(): Promise<void> {
    await fs.rm(this.accountFile, { force: true })
  }
}

export const store = new Store()
