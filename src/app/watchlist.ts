import { emptyShelves, LibraryIndex, makeWatchlistShelves, type WatchlistShelves } from '../core/catalogMatch'
import { dayOf, withUserState, type DiscoverItem, type DiscoverUserState, type PlexDiscoverAPI } from '../core/plexDiscover'
import type { PlexLibrarySection } from '../core/plexModels'
import type { PlexServerAPI } from '../core/plexServerAPI'

export interface WatchlistSnapshot {
  /** Last added first, as Plex orders it. */
  items: DiscoverItem[]
  /** Fetched at least once: the shelves stay hidden until then and when Plex is down. */
  loaded: boolean
  index: LibraryIndex
  /** The index was built at least once: before that every title would look missing. */
  indexed: boolean
  /** A toggle Plex refused, for the error dialog. */
  failure?: string
  /** Undefined while signed out. Read by views for picture URLs. */
  api?: PlexDiscoverAPI
}

export function isListed(items: DiscoverItem[], entry: DiscoverItem): boolean {
  return items.some((i) => i.ratingKey === entry.ratingKey)
}

/** «Хочу посмотреть» and «Ещё не вышло»: empty until both the list and the index are in. */
export function watchlistShelves(snapshot: WatchlistSnapshot, today: string): WatchlistShelves {
  if (!snapshot.loaded || !snapshot.indexed) return emptyShelves
  return makeWatchlistShelves(snapshot.items, snapshot.index, today)
}

/** Today in the browser's time zone, or the day pinned for the fakes. */
export function today(pinned?: string): string {
  return pinned || dayOf(new Date())
}

/**
 * The account's Plex Watchlist and an index of the server's movies and shows that tells which
 * catalog titles are already there. Home and the empty search show it as «Хочу посмотреть» and
 * «Ещё не вышло» (`watchlistShelves`).
 *
 * The list is Plex's own, shared with the Plex apps, and works on its own. Where the server
 * owner runs Overseerr / Seerr with watchlist requests, titles added here may get downloaded;
 * nothing in the app depends on that.
 */
export class Watchlist {
  private state: WatchlistSnapshot = { items: [], loaded: false, index: LibraryIndex.empty, indexed: false }
  private listeners = new Set<() => void>()
  private server?: PlexServerAPI
  private sections: PlexLibrarySection[] = []
  private indexLoadedAt?: number
  private indexTask?: Promise<void>
  /** Watch state by catalog key, from the last answers. */
  private knownStates = new Map<string, DiscoverUserState>()
  /** Titles with a toggle on its way: another click waits for its answer. */
  private pending = new Set<string>()
  /** Bumped by `configure`: answers for an old account or server are dropped. */
  private generation = 0

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.state

  private set(change: Partial<WatchlistSnapshot>) {
    this.state = { ...this.state, ...change }
    this.listeners.forEach((l) => l())
  }

  configure(api: PlexDiscoverAPI | undefined, server: PlexServerAPI | undefined, sections: PlexLibrarySection[]) {
    this.generation += 1
    this.server = server
    this.sections = sections
    this.indexLoadedAt = undefined
    this.indexTask = undefined
    this.knownStates = new Map()
    this.pending = new Set()
    this.set({ api, items: [], loaded: false, index: LibraryIndex.empty, indexed: false, failure: undefined })
  }

  contains(entry: DiscoverItem): boolean {
    return isListed(this.state.items, entry)
  }

  /**
   * Fetches the list and what of it was watched. On failure (offline, Plex down) what was shown
   * stays; without the watch state the last known one is used.
   */
  async load() {
    const { api } = this.state
    if (!api) return
    const generation = this.generation
    try {
      const fresh = await api.watchlist()
      const states = await api.userStates(fresh.map((i) => i.ratingKey)).catch((error: unknown) => {
        console.warn('watchlist states', error)
        return new Map<string, DiscoverUserState>()
      })
      if (generation !== this.generation) return
      states.forEach((state, key) => this.knownStates.set(key, state))
      this.set({ items: fresh.map((i) => withUserState(i, this.knownStates.get(i.ratingKey))), loaded: true })
    } catch (error) {
      console.warn('watchlist', error)
    }
  }

  /** Loads the server's movies and shows when the index is missing or older than `maxAgeMs`. */
  async refreshIndex(maxAgeMs = 600_000) {
    if (this.indexLoadedAt !== undefined && Date.now() - this.indexLoadedAt < maxAgeMs) return
    if (this.indexTask) return this.indexTask
    const server = this.server
    if (!server) return
    const sections = this.sections
    const generation = this.generation
    const task = (async () => {
      let failed = false
      const lists = await Promise.all(
        sections.map((section) =>
          server.items(section).catch(() => {
            failed = true
            return []
          }),
        ),
      )
      if (generation !== this.generation) return
      this.set({ index: new LibraryIndex(lists.flat()), indexed: true })
      // A partial index is used but loaded again next time.
      this.indexLoadedAt = failed ? undefined : Date.now()
    })()
    this.indexTask = task
    try {
      await task
    } finally {
      if (generation === this.generation) this.indexTask = undefined
    }
  }

  /** Adds or removes at once; puts it back and explains if Plex refuses. */
  async toggle(entry: DiscoverItem) {
    const { api } = this.state
    const key = entry.ratingKey
    if (!api || this.pending.has(key)) return
    const generation = this.generation
    const adding = !this.contains(entry)
    const position = this.state.items.findIndex((i) => i.ratingKey === key)
    this.set({ items: adding ? [entry, ...this.state.items] : this.state.items.filter((i) => i.ratingKey !== key) })
    const pending = this.pending
    pending.add(key)
    try {
      if (adding) await api.addToWatchlist(key)
      else await api.removeFromWatchlist(key)
    } catch (error) {
      console.warn('watchlist toggle', error)
      if (generation !== this.generation) return
      let items = this.state.items
      if (adding) {
        items = items.filter((i) => i.ratingKey !== key)
      } else if (!isListed(items, entry)) {
        items = [...items]
        items.splice(Math.min(Math.max(position, 0), items.length), 0, entry)
      }
      this.set({
        items,
        failure: adding
          ? `Не удалось добавить «${entry.title}» в список. Проверьте подключение к интернету.`
          : `Не удалось убрать «${entry.title}» из списка. Проверьте подключение к интернету.`,
      })
    } finally {
      pending.delete(key)
    }
  }

  dismissFailure() {
    if (this.state.failure !== undefined) this.set({ failure: undefined })
  }
}
