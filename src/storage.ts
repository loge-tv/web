import type { KeyValueStorage } from './core/showPreferences'
import { MemoryStorage } from './core/showPreferences'

/** localStorage, or memory when it is unavailable (private mode, blocked site data). */
function pickStorage(): KeyValueStorage {
  try {
    const probe = '__skiptv_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    return new MemoryStorage()
  }
}

export const storage: KeyValueStorage = pickStorage()

export const StorageKey = {
  clientIdentifier: 'plexClientIdentifier',
  userToken: 'plexUserToken',
  server: 'plexServer',
  pendingPin: 'plexPendingPin',
  settings: 'settings',
  volume: 'playerVolume',
  /**
   * Sepia Server of each Plex server: its `clientIdentifier` → the address, "" when the user
   * skipped it. Kept across sign-outs, like a device setting.
   */
  sepiaServers: 'sepiaServers',
  /** Russian names of catalog titles (`CatalogTitles`): not the account's, kept across sign-outs. */
  catalogTitles: 'catalogTitles',
} as const

export function readJSON<T>(key: string): T | undefined {
  try {
    const raw = storage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}

export function writeJSON(key: string, value: unknown) {
  try {
    if (value === undefined || value === null) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota or blocked storage: the app keeps working for this session.
  }
}

export function readString(key: string): string | undefined {
  try {
    return storage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

export function writeString(key: string, value: string | undefined) {
  try {
    if (value === undefined) storage.removeItem(key)
    else storage.setItem(key, value)
  } catch {
    // ignore
  }
}
