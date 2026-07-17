import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { LauncherInstance } from '../types'
import { emlRootDirectory, modsDirectory } from './paths'
import { inspectModJar } from './modSecurity'

const execFileAsync = promisify(execFile)

const BLOCKED_PROCESS_MARKERS = [
  'cheatengine', 'cheat engine', 'extreme injector', 'xenos injector', 'xenos64', 'xenos.exe',
  'dll injector', 'process injector', 'vape launcher', 'vape.exe', 'entropy injector',
  'doomsday client', 'horion injector', 'java injector', 'ghost client injector'
]

// Loaded native modules are blocked only when their own filename is a clear,
// explicit injector/client identity. Legitimate mods such as Simple Voice Chat
// and C2ME may load OpenAL, Opus, RNNoise or other native libraries from
// user-writable cache/temp folders, so location and Windows signing alone are
// never treated as proof of cheating.
const BLOCKED_NATIVE_MODULES = new Map<string, string>([
  ['vape', 'Vape'],
  ['vapeclient', 'Vape Client'],
  ['entropy', 'Entropy'],
  ['xenos', 'Xenos Injector'],
  ['xenos64', 'Xenos Injector'],
  ['xenos32', 'Xenos Injector'],
  ['cheatengine', 'Cheat Engine'],
  ['cheatenginei386', 'Cheat Engine'],
  ['cheatenginex8664', 'Cheat Engine'],
  ['horion', 'Horion'],
  ['doomsday', 'Doomsday Client'],
  ['ghostclient', 'Ghost Client']
])

const FORBIDDEN_JVM_ARGUMENTS = [
  '-javaagent:', '-agentpath:', '-agentlib:jdwp', '-xrunjdwp:', '-xbootclasspath/a:', '-xbootclasspath/p:'
]

interface ProcessInfo {
  Name?: string
  ProcessId?: number
  ExecutablePath?: string
  CommandLine?: string
}

interface ModuleInfo {
  ProcessId?: number
  ModuleName?: string
  FileName?: string
}

export interface SecurityFinding {
  category: 'mod' | 'process' | 'module' | 'jvm'
  title: string
  detail: string
  processId?: number
}

let processCache: { expiresAt: number; values: ProcessInfo[] } | null = null

function normalise(value: unknown): string {
  return String(value ?? '').toLowerCase().replaceAll('\\', '/')
}

function firstMarker(value: string, markers: string[]): string | undefined {
  return markers.find((marker) => value.includes(marker))
}

function nativeModuleIdentity(module: ModuleInfo): { label: string; name: string } | null {
  const rawName = module.ModuleName || path.basename(module.FileName || '')
  if (!rawName) return null
  const withoutExtension = rawName.toLowerCase().replace(/\.(?:dll|exe)$/i, '')
  const identity = withoutExtension.replace(/[^a-z0-9]+/g, '')
  const direct = BLOCKED_NATIVE_MODULES.get(identity)
  if (direct) return { label: direct, name: rawName }

  // Versioned injector DLL names are common; ordinary names merely containing a
  // word such as "voice", "openal" or "client" are deliberately ignored.
  for (const [blocked, label] of BLOCKED_NATIVE_MODULES) {
    if (!identity.startsWith(blocked)) continue
    const suffix = identity.slice(blocked.length)
    if (/^(?:v?\d|build\d|release\d)$/.test(suffix)) return { label, name: rawName }
  }
  return null
}

async function listProcesses(force = false): Promise<ProcessInfo[]> {
  if (process.platform !== 'win32') return []
  if (!force && processCache && processCache.expiresAt > Date.now()) return processCache.values

  const command = [
    "$ErrorActionPreference='SilentlyContinue'",
    'Get-CimInstance Win32_Process | Select-Object Name,ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress'
  ].join(';')
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 12_000
  })
  if (!stdout.trim()) return []
  const parsed = JSON.parse(stdout) as ProcessInfo | ProcessInfo[]
  const values = Array.isArray(parsed) ? parsed : [parsed]
  processCache = { values, expiresAt: Date.now() + 5_000 }
  return values
}

export async function scanInstanceMods(instance: LauncherInstance): Promise<SecurityFinding[]> {
  const directory = modsDirectory(instance.slug)
  const names = await fs.readdir(directory).catch(() => [] as string[])
  const candidates = names.filter((name) => name.toLowerCase().endsWith('.jar'))
  const findings: SecurityFinding[] = []

  // inspectModJar uses a small worker pool, keeping ZIP decompression away from
  // Electron's main thread while bounding CPU and memory use.
  for (let index = 0; index < candidates.length; index += 8) {
    const batch = await Promise.all(candidates.slice(index, index + 8).map((name) => inspectModJar(path.join(directory, name))))
    for (const finding of batch) if (finding) findings.push(finding)
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  return findings
}

export async function scanRunningTools(): Promise<SecurityFinding[]> {
  const processes = await listProcesses().catch(() => [])
  const findings: SecurityFinding[] = []
  for (const item of processes) {
    const searchable = normalise(`${item.Name ?? ''}\n${item.ExecutablePath ?? ''}\n${item.CommandLine ?? ''}`)
    const marker = firstMarker(searchable, BLOCKED_PROCESS_MARKERS)
    if (!marker) continue
    findings.push({
      category: 'process',
      title: 'Injection or cheat tool detected',
      detail: `${item.Name ?? 'Unknown process'} matched ${marker}. Close it before launching.`,
      processId: item.ProcessId
    })
  }
  return findings
}

export async function findGameJavaProcesses(instance: LauncherInstance): Promise<ProcessInfo[]> {
  const processes = await listProcesses(true).catch(() => [])
  const root = normalise(emlRootDirectory())
  const slug = normalise(instance.slug)
  return processes.filter((item) => {
    const name = normalise(item.Name)
    const command = normalise(item.CommandLine)
    return (name === 'java.exe' || name === 'javaw.exe') && command.includes(root) && command.includes(slug)
  })
}

export function scanGameJvmArguments(processes: ProcessInfo[]): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  for (const item of processes) {
    const command = normalise(item.CommandLine)
    const marker = firstMarker(command, FORBIDDEN_JVM_ARGUMENTS)
    if (!marker) continue
    findings.push({
      category: 'jvm',
      title: 'Unexpected JVM injection argument detected',
      detail: `${item.Name ?? 'Minecraft Java'} was started with ${marker}.`,
      processId: item.ProcessId
    })
  }
  return findings
}

async function listModules(processIds: number[]): Promise<ModuleInfo[]> {
  if (process.platform !== 'win32' || !processIds.length) return []
  const ids = processIds.filter((id) => Number.isInteger(id) && id > 0).join(',')
  if (!ids) return []
  const command = [
    "$ErrorActionPreference='SilentlyContinue'",
    `$ids=@(${ids})`,
    '$rows=foreach($id in $ids){Get-Process -Id $id -ErrorAction SilentlyContinue | ForEach-Object {$pidValue=$_.Id; $_.Modules | ForEach-Object {[PSCustomObject]@{ProcessId=$pidValue;ModuleName=$_.ModuleName;FileName=$_.FileName}}}}',
    '$rows | ConvertTo-Json -Compress'
  ].join(';')
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 15_000
  }).catch(() => ({ stdout: '' }))
  if (!stdout.trim()) return []
  const parsed = JSON.parse(stdout) as ModuleInfo | ModuleInfo[]
  return Array.isArray(parsed) ? parsed : [parsed]
}

export async function scanLoadedModules(processIds: number[]): Promise<SecurityFinding[]> {
  const modules = await listModules(processIds)
  const findings: SecurityFinding[] = []
  for (const module of modules) {
    const blocked = nativeModuleIdentity(module)
    if (!blocked) continue
    findings.push({
      category: 'module',
      title: 'Injected module detected',
      detail: `${blocked.name} matches the explicit ${blocked.label} native-module identity.`,
      processId: module.ProcessId
    })
  }
  return findings
}

export async function terminateProcesses(processIds: number[]): Promise<void> {
  if (process.platform !== 'win32') return
  for (const processId of [...new Set(processIds.filter((id) => Number.isInteger(id) && id > 0))]) {
    await execFileAsync('taskkill.exe', ['/PID', String(processId), '/T', '/F'], { windowsHide: true }).catch(() => undefined)
  }
}

export async function runPreflightSecurity(instance: LauncherInstance): Promise<void> {
  const [mods, processes] = await Promise.all([scanInstanceMods(instance), scanRunningTools()])
  const finding = [...mods, ...processes][0]
  if (finding) throw new Error(`${finding.title}: ${finding.detail}`)
}

export function secureChildEnvironment(): () => void {
  const names = ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS'] as const
  const previous = new Map<string, string | undefined>()
  for (const name of names) {
    previous.set(name, process.env[name])
    delete process.env[name]
  }
  return () => {
    for (const name of names) {
      const value = previous.get(name)
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}
