import type { BrowserWindow } from 'electron'
import { MicrosoftAuth, type Account } from 'eml-lib'
import type { PublicAccount } from '../types'
import { store } from './store'

let refreshInFlight: Promise<Account> | null = null

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = 'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined
    return `${error.name} ${error.message}${cause ? ` ${errorText(cause)}` : ''}`
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return [record.name, record.message, record.code, record.status, record.statusCode]
      .filter((value) => value !== undefined && value !== null)
      .map(String)
      .join(' ')
  }
  return String(error)
}

export function isLikelyTransientMicrosoftError(error: unknown): boolean {
  return /network|fetch|timed? out|timeout|abort|econn|enotfound|eai_again|socket|temporar|service unavailable|could not be reached|unreachable|retry|bad gateway|gateway timeout|too many requests|offline|internet|\b408\b|\b425\b|\b429\b|\b50[234]\b/i.test(errorText(error))
}

function withTimeout<T>(operation: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds)
  })
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export function publicAccount(account: Account | null): PublicAccount | null {
  if (!account) return null
  return {
    name: account.name,
    uuid: account.uuid,
    avatarUrl: `https://mc-heads.net/avatar/${account.uuid}/96`,
    xboxGamertag: account.xbox?.gamertag
  }
}

export async function getSavedAccount(): Promise<Account> {
  const account = await store.loadAccount()
  if (!account) throw new Error('Sign in with Microsoft before using this feature.')
  return account
}

export async function refreshAccount(mainWindow: BrowserWindow): Promise<Account> {
  if (refreshInFlight) return refreshInFlight

  const task = (async () => {
    const account = await getSavedAccount()
    const auth = new MicrosoftAuth(mainWindow)
    try {
      const refreshed = await withTimeout(auth.refresh(account), 22_000, 'Microsoft account refresh timed out.')
      await store.saveAccount(refreshed)
      return refreshed
    } catch (error) {
      if (isLikelyTransientMicrosoftError(error)) {
        throw new Error('Microsoft services could not be reached. MegaClient kept your saved account and will retry when it is needed.')
      }
      await store.clearAccount()
      throw new Error('Your Microsoft session expired. Sign in again to continue.')
    }
  })()

  refreshInFlight = task
  try {
    return await task
  } finally {
    if (refreshInFlight === task) refreshInFlight = null
  }
}

export async function getValidAccount(mainWindow: BrowserWindow): Promise<Account> {
  const account = await getSavedAccount()
  const auth = new MicrosoftAuth(mainWindow)
  try {
    if (await withTimeout(auth.validate(account), 12_000, 'Microsoft account validation timed out.')) return account
  } catch (error) {
    if (!isLikelyTransientMicrosoftError(error)) {
      // A failed validation can also be caused by an expired access token. The
      // refresh below is the authoritative check and handles both cases.
    }
  }

  return refreshAccount(mainWindow)
}

export async function login(mainWindow: BrowserWindow): Promise<PublicAccount> {
  const auth = new MicrosoftAuth(mainWindow)
  const account = await auth.auth()
  await store.saveAccount(account)
  return publicAccount(account)!
}

export async function restore(_mainWindow: BrowserWindow): Promise<PublicAccount | null> {
  // Restoring the launcher should not depend on Microsoft being reachable.
  // Minecraft/profile requests validate or refresh the token only when they
  // actually need it, so startup remains reliable while offline or during a
  // temporary Microsoft outage.
  return publicAccount(await store.loadAccount())
}

export async function logout(): Promise<void> {
  await store.clearAccount()
}
