import { catalogHubs, type CatalogHub, type DiscoverItem, type PlexDiscoverAPI } from '../core/plexDiscover'

export interface ExploreCollection {
  hub: CatalogHub
  items: DiscoverItem[]
}

export interface ExploreSnapshot {
  /** In `catalogHubs` order, empty ones left out. */
  collections: ExploreCollection[]
  loaded: boolean
  /** No collection could be fetched: Plex's catalog is down or unreachable. */
  failed: boolean
}

export const ExploreText = {
  failed: 'Каталог Plex сейчас недоступен.',
  empty: 'В подборках пока ничего нет.',
}

/**
 * The «Обзор» page: Plex's ready-made collections (popular, most added to watchlists, coming
 * soon, most anticipated), asked with the account token like search. Not on Home: there it
 * would crowd out what is personal.
 */
export class Explore {
  private state: ExploreSnapshot = { collections: [], loaded: false, failed: false }
  private listeners = new Set<() => void>()
  private api?: PlexDiscoverAPI
  private loadedAt?: number
  private generation = 0

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.state

  private set(change: Partial<ExploreSnapshot>) {
    this.state = { ...this.state, ...change }
    this.listeners.forEach((l) => l())
  }

  configure(api: PlexDiscoverAPI | undefined) {
    this.generation += 1
    this.api = api
    this.loadedAt = undefined
    this.set({ collections: [], loaded: false, failed: false })
  }

  /** Asks again when the last answer is older than half an hour (or `force`). On failure what was shown stays. */
  async load(force = false) {
    const api = this.api
    if (!api) return
    if (!force && this.loadedAt !== undefined && Date.now() - this.loadedAt < 30 * 60_000) return
    const generation = this.generation
    const answers = await Promise.all(
      catalogHubs.map(async ({ id }) => {
        try {
          // Once each: a show can come twice (itself and a new season of it).
          const seen = new Set<string>()
          const items = (await api.hub(id)).filter((i) => !seen.has(i.ratingKey) && !!seen.add(i.ratingKey))
          return { hub: id, items }
        } catch (error) {
          console.warn('explore', id, error)
          return undefined
        }
      }),
    )
    if (generation !== this.generation) return
    const got = answers.filter((a): a is ExploreCollection => a !== undefined)
    if (got.length > 0) {
      this.loadedAt = Date.now()
      this.set({ collections: got.filter((c) => c.items.length > 0), loaded: true, failed: false })
    } else {
      this.set({ loaded: true, failed: true })
    }
  }
}
