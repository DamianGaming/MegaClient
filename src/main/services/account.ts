import type { BrowserWindow } from 'electron'
import { MicrosoftAuth, type Account } from 'eml-lib'
import type { PublicAccount } from '../types'
import { store } from './store'

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
    if (await auth.validate(account)) return account
  } catch {
    // Refresh below when validation cannot complete with the stored token.
  }

  try {
    const refreshed = await auth.refresh(account)
    await store.saveAccount(refreshed)
    return refreshed
  } catch {
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
  try {
    return publicAccount(await getValidAccount(mainWindow))
  } catch {
    return null
  }
}

export async function logout(): Promise<void> {
  await store.clearAccount()
}
