import AdmZip from 'adm-zip'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface ModSecurityFinding {
  category: 'mod'
  title: string
  detail: string
}

// Only explicit, high-confidence mod identities are blocked. A normal mod is not
// rejected merely because its description, dependency list, compatibility code or
// class names mention one of these clients.
const BLOCKED_MOD_IDENTITIES = new Map<string, string>([
  ['meteorclient', 'Meteor Client'],
  ['liquidbounce', 'LiquidBounce'],
  ['wurstclient', 'Wurst Client'],
  ['aristois', 'Aristois'],
  ['impactclient', 'Impact Client'],
  ['bleachhack', 'BleachHack'],
  ['inertiaclient', 'Inertia Client'],
  ['sigmaclient', 'Sigma Client'],
  ['futureclient', 'Future Client'],
  ['rusherhack', 'RusherHack'],
  ['vapeclient', 'Vape Client'],
  ['horionclient', 'Horion Client'],
  ['nursultanclient', 'Nursultan Client'],
  ['ghostclient', 'Ghost Client'],
  ['doomsdayclient', 'Doomsday Client'],
  ['prestigeclient', 'Prestige Client']
])

const BLOCKED_MOD_FILE_ALIASES = new Map<string, string>([
  ['meteorclient', 'Meteor Client'],
  ['meteor-client', 'Meteor Client'],
  ['liquidbounce', 'LiquidBounce'],
  ['wurstclient', 'Wurst Client'],
  ['wurst-client', 'Wurst Client'],
  ['aristois', 'Aristois'],
  ['impactclient', 'Impact Client'],
  ['impact-client', 'Impact Client'],
  ['bleachhack', 'BleachHack'],
  ['bleach-hack', 'BleachHack'],
  ['inertiaclient', 'Inertia Client'],
  ['inertia-client', 'Inertia Client'],
  ['sigmaclient', 'Sigma Client'],
  ['sigma-client', 'Sigma Client'],
  ['futureclient', 'Future Client'],
  ['future-client', 'Future Client'],
  ['rusherhack', 'RusherHack'],
  ['rusher-hack', 'RusherHack'],
  ['vapeclient', 'Vape Client'],
  ['vape-client', 'Vape Client'],
  ['horionclient', 'Horion Client'],
  ['horion-client', 'Horion Client'],
  ['nursultanclient', 'Nursultan Client'],
  ['nursultan-client', 'Nursultan Client'],
  ['ghostclient', 'Ghost Client'],
  ['ghost-client', 'Ghost Client'],
  ['doomsdayclient', 'Doomsday Client'],
  ['doomsday-client', 'Doomsday Client'],
  ['prestigeclient', 'Prestige Client'],
  ['prestige-client', 'Prestige Client']
])

const jarScanCache = new Map<string, { stamp: string; finding: ModSecurityFinding | null }>()

function normaliseModIdentity(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function addIdentity(values: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return
  const identity = normaliseModIdentity(value)
  if (identity) values.add(identity)
}

function jsonEntry(zip: AdmZip, name: string): unknown {
  const entry = zip.getEntry(name)
  if (!entry || entry.isDirectory) return undefined
  try {
    return JSON.parse(entry.getData().toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

function collectJsonMetadataIdentities(zip: AdmZip): Set<string> {
  const identities = new Set<string>()

  const fabric = jsonEntry(zip, 'fabric.mod.json') as { id?: unknown; name?: unknown } | undefined
  addIdentity(identities, fabric?.id)
  addIdentity(identities, fabric?.name)

  const quilt = jsonEntry(zip, 'quilt.mod.json') as {
    quilt_loader?: { id?: unknown }
    metadata?: { name?: unknown }
  } | undefined
  addIdentity(identities, quilt?.quilt_loader?.id)
  addIdentity(identities, quilt?.metadata?.name)

  const legacy = jsonEntry(zip, 'mcmod.info')
  const legacyEntries = Array.isArray(legacy) ? legacy : legacy && typeof legacy === 'object' ? [legacy] : []
  for (const entry of legacyEntries) {
    if (!entry || typeof entry !== 'object') continue
    const metadata = entry as { modid?: unknown; modId?: unknown; name?: unknown }
    addIdentity(identities, metadata.modid ?? metadata.modId)
    addIdentity(identities, metadata.name)
  }

  return identities
}

function collectTomlMetadataIdentities(zip: AdmZip): Set<string> {
  const identities = new Set<string>()
  for (const name of ['META-INF/mods.toml', 'META-INF/neoforge.mods.toml']) {
    const entry = zip.getEntry(name)
    if (!entry || entry.isDirectory) continue
    const text = entry.getData().toString('utf8').slice(0, 500_000)
    for (const match of text.matchAll(/^\s*(?:modId|displayName)\s*=\s*["']([^"']+)["']/gim)) {
      addIdentity(identities, match[1])
    }
  }
  return identities
}

function collectManifestIdentities(zip: AdmZip): Set<string> {
  const identities = new Set<string>()
  const entry = zip.getEntry('META-INF/MANIFEST.MF')
  if (!entry || entry.isDirectory) return identities
  const text = entry.getData().toString('utf8').slice(0, 200_000)
  for (const match of text.matchAll(/^(?:Implementation-Title|Specification-Title|Automatic-Module-Name):\s*(.+)$/gim)) {
    addIdentity(identities, match[1]?.trim())
  }
  return identities
}

function declaredBlockedIdentity(zip: AdmZip): { label: string } | null {
  const identities = new Set<string>([
    ...collectJsonMetadataIdentities(zip),
    ...collectTomlMetadataIdentities(zip),
    ...collectManifestIdentities(zip)
  ])
  for (const identity of identities) {
    const label = BLOCKED_MOD_IDENTITIES.get(identity)
    if (label) return { label }
  }
  return null
}

function blockedFilename(file: string): { label: string } | null {
  const base = path.basename(file).toLowerCase().replace(/\.jar(?:\.disabled)?$/i, '')
  for (const [alias, label] of BLOCKED_MOD_FILE_ALIASES) {
    if (base === alias) return { label }
    if (!base.startsWith(`${alias}-`) && !base.startsWith(`${alias}_`) && !base.startsWith(`${alias}.`)) continue
    const remainder = base.slice(alias.length + 1)
    // Release filenames normally continue with a version or build number. Names
    // such as "meteor-client-addon" are deliberately not treated as the client.
    if (/^(?:v?\d|b\d|build[-_.]?\d|release[-_.]?\d)/i.test(remainder)) return { label }
  }
  return null
}

async function fileStamp(file: string): Promise<string> {
  const stat = await fs.stat(file)
  return `${stat.size}:${Math.floor(stat.mtimeMs)}`
}

export async function inspectModJar(file: string): Promise<ModSecurityFinding | null> {
  try {
    const stamp = await fileStamp(file)
    const cached = jarScanCache.get(file)
    if (cached?.stamp === stamp) return cached.finding

    const zip = new AdmZip(file)
    const declared = declaredBlockedIdentity(zip)
    const filename = blockedFilename(file)
    const evidence = declared
      ? `${declared.label} is declared as this mod's own ID or display name`
      : filename
        ? `${filename.label} matches this JAR's release filename`
        : null
    const finding = evidence ? {
      category: 'mod' as const,
      title: 'Blocked client modification detected',
      detail: `${path.basename(file)} was identified with high-confidence metadata: ${evidence}.`
    } : null
    jarScanCache.set(file, { stamp, finding })
    return finding
  } catch {
    return null
  }
}
