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

const BLOCKED_PROCESS_IDENTITIES = new Map<string, string>([
  ['cheatengine', 'Cheat Engine'],
  ['cheatenginei386', 'Cheat Engine'],
  ['cheatenginex8664', 'Cheat Engine'],
  ['extremeinjector', 'Extreme Injector'],
  ['xenos', 'Xenos Injector'],
  ['xenos64', 'Xenos Injector'],
  ['xenos32', 'Xenos Injector'],
  ['vape', 'Vape'],
  ['vapelauncher', 'Vape'],
  ['entropy', 'Entropy'],
  ['horioninjector', 'Horion Injector'],
  ['javainjector', 'Java Injector'],
  ['ghostclientinjector', 'Ghost Client Injector']
])

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

export interface ProcessInfo {
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

let fullProcessCache: { expiresAt: number; values: ProcessInfo[] } | null = null
let runtimeProcessCache: { expiresAt: number; values: ProcessInfo[] } | null = null
let javaProcessCache: { expiresAt: number; values: ProcessInfo[] } | null = null

function normalise(value: unknown): string {
  return String(value ?? '').toLowerCase().replaceAll('\\', '/')
}

function identity(value: unknown): string {
  return path.basename(String(value ?? '')).toLowerCase().replace(/\.exe$/i, '').replace(/[^a-z0-9]+/g, '')
}

function firstMarker(value: string, markers: string[]): string | undefined {
  return markers.find((marker) => value.includes(marker))
}

function nativeModuleIdentity(module: ModuleInfo): { label: string; name: string } | null {
  const rawName = module.ModuleName || path.basename(module.FileName || '')
  if (!rawName) return null
  const withoutExtension = rawName.toLowerCase().replace(/\.(?:dll|exe)$/i, '')
  const moduleIdentity = withoutExtension.replace(/[^a-z0-9]+/g, '')
  const direct = BLOCKED_NATIVE_MODULES.get(moduleIdentity)
  if (direct) return { label: direct, name: rawName }

  for (const [blocked, label] of BLOCKED_NATIVE_MODULES) {
    if (!moduleIdentity.startsWith(blocked)) continue
    const suffix = moduleIdentity.slice(blocked.length)
    if (/^(?:v?\d|build\d|release\d)$/.test(suffix)) return { label, name: rawName }
  }
  return null
}

async function powershellJson<T>(script: string, timeout: number, maxBuffer: number): Promise<T[]> {
  if (process.platform !== 'win32') return []
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
  ], {
    windowsHide: true,
    maxBuffer,
    timeout
  })
  if (!stdout.trim()) return []
  const parsed = JSON.parse(stdout) as T | T[]
  return Array.isArray(parsed) ? parsed : [parsed]
}

async function listProcesses(force = false): Promise<ProcessInfo[]> {
  if (process.platform !== 'win32') return []
  if (!force && fullProcessCache && fullProcessCache.expiresAt > Date.now()) return fullProcessCache.values

  const command = [
    "$ErrorActionPreference='SilentlyContinue'",
    'Get-CimInstance Win32_Process | Select-Object Name,ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress'
  ].join(';')
  const values = await powershellJson<ProcessInfo>(command, 12_000, 8 * 1024 * 1024)
  fullProcessCache = { values, expiresAt: Date.now() + 10_000 }
  return values
}

async function listRuntimeProcesses(force = false): Promise<ProcessInfo[]> {
  if (process.platform !== 'win32') return []
  if (!force && runtimeProcessCache && runtimeProcessCache.expiresAt > Date.now()) return runtimeProcessCache.values

  // Runtime monitoring deliberately avoids Win32_Process/CommandLine enumeration.
  // Get-Process is materially lighter and is enough for exact injector identities.
  const command = [
    "$ErrorActionPreference='SilentlyContinue'",
    '$rows=Get-Process | ForEach-Object {$p=$null;try{$p=$_.Path}catch{};[PSCustomObject]@{Name=$_.ProcessName;ProcessId=$_.Id;ExecutablePath=$p;CommandLine=$null}}',
    '$rows | ConvertTo-Json -Compress'
  ].join(';')
  const values = await powershellJson<ProcessInfo>(command, 8_000, 5 * 1024 * 1024)
  runtimeProcessCache = { values, expiresAt: Date.now() + 60_000 }
  return values
}

async function listGameJavaProcesses(force = false): Promise<ProcessInfo[]> {
  if (process.platform !== 'win32') return []
  if (!force && javaProcessCache && javaProcessCache.expiresAt > Date.now()) return javaProcessCache.values

  const command = [
    "$ErrorActionPreference='SilentlyContinue'",
    `Get-CimInstance Win32_Process -Filter \"Name='java.exe' OR Name='javaw.exe'\" | Select-Object Name,ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`
  ].join(';')
  const values = await powershellJson<ProcessInfo>(command, 8_000, 2 * 1024 * 1024)
  javaProcessCache = { values, expiresAt: Date.now() + 3_000 }
  return values
}

export async function scanInstanceMods(instance: LauncherInstance): Promise<SecurityFinding[]> {
  const directory = modsDirectory(instance.slug)
  const names = await fs.readdir(directory).catch(() => [] as string[])
  const candidates = names.filter((name) => name.toLowerCase().endsWith('.jar'))
  const findings: SecurityFinding[] = []

  // Small batches keep ZIP work off Electron's main thread without letting a
  // large Fabric profile saturate all CPU cores before the game starts.
  for (let index = 0; index < candidates.length; index += 6) {
    const batch = await Promise.all(candidates.slice(index, index + 6).map((name) => inspectModJar(path.join(directory, name))))
    for (const finding of batch) if (finding) findings.push(finding)
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  return findings
}

function findingsFromProcesses(processes: ProcessInfo[]): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  for (const item of processes) {
    const searchable = normalise(`${item.Name ?? ''}\n${item.ExecutablePath ?? ''}\n${item.CommandLine ?? ''}`)
    const marker = firstMarker(searchable, BLOCKED_PROCESS_MARKERS)
    const exactIdentity = BLOCKED_PROCESS_IDENTITIES.get(identity(item.Name))
      ?? BLOCKED_PROCESS_IDENTITIES.get(identity(item.ExecutablePath))
    if (!marker && !exactIdentity) continue
    findings.push({
      category: 'process',
      title: 'Injection or cheat tool detected',
      detail: `${item.Name ?? 'Unknown process'} matched ${exactIdentity ?? marker}. Close it before launching.`,
      processId: item.ProcessId
    })
  }
  return findings
}

export async function scanRunningTools(mode: 'preflight' | 'runtime' = 'preflight'): Promise<SecurityFinding[]> {
  const processes = await (mode === 'runtime' ? listRuntimeProcesses() : listProcesses()).catch(() => [])
  return findingsFromProcesses(processes)
}

export async function findGameJavaProcesses(instance: LauncherInstance): Promise<ProcessInfo[]> {
  const processes = await listGameJavaProcesses(true).catch(() => [])
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
  return powershellJson<ModuleInfo>(command, 15_000, 10 * 1024 * 1024).catch(() => [])
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
  const [mods, processes] = await Promise.all([scanInstanceMods(instance), scanRunningTools('preflight')])
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
