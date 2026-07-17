import type { BrowserWindow } from 'electron'
import { MicrosoftAuth, type Account } from 'eml-lib'
import type { PublicAccount } from '../types'
import { store } from './store'

function isLikelyTransientAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /network|fetch|timed? out|timeout|econn|enotfound|temporar|service unavailable|bad gateway|too many requests|\b429\b|\b50[234]\b/i.test(message)
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

export async function getValidAccount(mainWindow: BrowserWindow): Promise<Account> {
  const account = await store.loadAccount()
  if (!account) throw new Error('Sign in with Microsoft before using this feature.')

  const auth = new MicrosoftAuth(mainWindow)
  try {
    if (await withTimeout(auth.validate(account), 12_000, 'Microsoft account validation timed out.')) return account
  } catch {
    // Refresh below when validation cannot complete with the stored token.
  }

  try {
    const refreshed = await withTimeout(auth.refresh(account), 18_000, 'Microsoft account refresh timed out.')
    await store.saveAccount(refreshed)
    return refreshed
  } catch (error) {
    if (isLikelyTransientAuthError(error)) {
      throw new Error('Microsoft services could not be reached. MegaClient kept your saved account and will try again when you launch.')
    }
    await store.clearAccount()
    throw new Error('Your Microsoft session expired. Sign in again to continue.')
  }
}

export async function login(mainWindow: BrowserWindow): Promise<PublicAccount> {
  const auth = new MicrosoftAuth(mainWindow)
  const account = await auth.auth()
  await store.saveAccount(account)
  return publicAccount(account)!
}

export async function restore(mainWindow: BrowserWindow): Promise<PublicAccount | null> {
  const stored = await store.loadAccount()
  if (!stored) return null
  try {
    return publicAccount(await getValidAccount(mainWindow))
  } catch (error) {
    return isLikelyTransientAuthError(error) || (error instanceof Error && error.message.includes('kept your saved account'))
      ? publicAccount(stored)
      : null
  }
}

export async function logout(): Promise<void> {
  await store.clearAccount()
}
