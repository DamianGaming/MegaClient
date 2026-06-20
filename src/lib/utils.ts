export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

export function formatRelativeDate(value?: string): string {
  if (!value) return 'Never played'
  const date = new Date(value)
  const delta = date.getTime() - Date.now()
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const minutes = Math.round(delta / 60_000)
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(delta / 3_600_000)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  return formatter.format(Math.round(delta / 86_400_000), 'day')
}

export function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function formatLoaderName(value: string): string {
  const normalized = value.toLowerCase()
  if (normalized === 'neoforge') return 'NeoForge'
  if (normalized === 'fabric') return 'Fabric'
  if (normalized === 'quilt') return 'Quilt'
  if (normalized === 'forge') return 'Forge'
  if (normalized === 'vanilla') return 'Vanilla'
  return value
}
