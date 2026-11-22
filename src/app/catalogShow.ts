import type { DiscoverUserState, PlexDiscoverAPI } from '../core/plexDiscover'
import type { PlexItem } from '../core/plexModels'

// Port of SkipTVKit's CatalogShow.swift.

export interface CatalogShowSnapshot {
  seasons: PlexItem[]
  /** Episodes by catalog season key, fetched when the season is opened. */
  episodes: Record<string, PlexItem[]>
  states: Map<string, DiscoverUserState>
  /** A mark Plex refused (shown once, then cleared). */
  failure?: string
}

export const CatalogShowText = {
  failedTitle: 'Не удалось отметить',
  failed: (title: string) => `Plex не принял отметку «${title}». Проверьте подключение к интернету.`,
}

/**
 * A show in Plex's catalog: its seasons, the episodes of the seasons looked at, and the account's
 * watch marks. Catalog marks change at once and go back if Plex refuses.
 */
export class CatalogShow {
  private state: CatalogShowSnapshot = { seasons: [], episodes: {}, states: new Map() }
  private listeners = new Set<() => void>()
  private loadedKey?: string
  private asked = new Set<string>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.state

  private set(change: Partial<CatalogShowSnapshot>) {
    this.state = { ...this.state, ...change }
    this.listeners.forEach((l) => l())
  }

  async load(showKey: string, discover: PlexDiscoverAPI | undefined) {
    if (!discover || this.loadedKey === showKey) return
    this.loadedKey = showKey
    let seasons: PlexItem[]
    try {
      seasons = (await discover.children(showKey)).filter((i) => i.type === 'season')
    } catch (error) {
      console.warn('catalog seasons', error)
      this.loadedKey = undefined
      return
    }
    this.set({ seasons })
    await this.loadStates(seasons.map((s) => s.ratingKey), discover)
  }

  async loadEpisodes(seasonKey: string, discover: PlexDiscoverAPI | undefined) {
    if (!discover || this.asked.has(seasonKey)) return
    this.asked.add(seasonKey)
    let list: PlexItem[]
    try {
      list = await discover.children(seasonKey)
    } catch (error) {
      console.warn('catalog episodes', error)
      this.asked.delete(seasonKey)
      return
    }
    this.set({ episodes: { ...this.state.episodes, [seasonKey]: list.filter((i) => i.type === 'episode') } })
    await this.loadStates(
      list.map((i) => i.ratingKey),
      discover,
    )
  }

  private async loadStates(keys: string[], discover: PlexDiscoverAPI) {
    if (keys.length === 0) return
    try {
      const fresh = await discover.userStates(keys)
      const states = new Map(this.state.states)
      for (const [key, state] of fresh) states.set(key, state)
      this.set({ states })
    } catch (error) {
      console.warn('catalog watch state', error)
    }
  }

  /**
   * Marks a catalog season or episode watched for the account. A season takes its episodes
   * along; the seasons' marks are asked again after an episode.
   */
  async setWatched(item: PlexItem, watched: boolean, discover: PlexDiscoverAPI | undefined) {
    if (!discover) return
    const affected = [item, ...(item.type === 'season' ? (this.state.episodes[item.ratingKey] ?? []) : [])]
    const before = new Map(this.state.states)
    const states = new Map(this.state.states)
    for (const one of affected) {
      states.set(one.ratingKey, {
        ratingKey: one.ratingKey,
        viewCount: watched ? 1 : 0,
        viewedLeafCount: watched ? one.leafCount : 0,
        viewState: watched ? 'complete' : undefined,
      })
    }
    this.set({ states })
    try {
      await discover.setWatched(item.ratingKey, watched)
    } catch (error) {
      console.warn('catalog watched', error)
      this.set({ states: before, failure: CatalogShowText.failed(item.title) })
      return
    }
    if (item.type === 'episode') await this.loadStates(this.state.seasons.map((s) => s.ratingKey), discover)
  }

  dismissFailure() {
    this.set({ failure: undefined })
  }
}
