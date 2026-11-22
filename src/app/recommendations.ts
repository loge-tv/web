import type { DetectorClient } from '../core/detectorClient'
import { catalogKey, type PlexItem } from '../core/plexModels'
import type { DiscoverItem, DiscoverUserState, PlexDiscoverAPI } from '../core/plexDiscover'
import type { PlexServerAPI } from '../core/plexServerAPI'
import {
  emptyRecommendations,
  makeCastShelf,
  makeRecommendationShelves,
  RecommendationSeeds,
  seedKey,
  tmdbKey,
  tmdbKind,
  type RecommendationShelves,
  type TMDBTitle,
} from '../core/recommendations'
import { readJSON, writeJSON } from '../storage'
import type { Watchlist } from './watchlist'

export interface RecommendationsSnapshot {
  shelves: RecommendationShelves
  /** The detector answered that it has no TMDB key (settings say so). */
  unavailable: boolean
}

/**
 * «Потому что вы смотрели…»: TMDB's recommendations (asked through the detector, which keeps the
 * TMDB key) for the titles last watched on the server, shown as Plex catalog titles; what the
 * server already has goes to a shelf of its own. Without a detector with a TMDB key there are
 * none, and Home simply has no such shelves. Plus Plex's own «Ещё с актёрами «…»», which needs
 * only the Plex account.
 */
export class Recommendations {
  private state: RecommendationsSnapshot = { shelves: emptyRecommendations, unavailable: false }
  private listeners = new Set<() => void>()
  private discover?: PlexDiscoverAPI
  private server?: PlexServerAPI
  private detector: () => DetectorClient | null = () => null
  /** The server's owner sees everyone's history: only account 1 (the owner) is asked then. */
  private owner = true
  private loadedAt?: number
  private running?: Promise<void>
  private generation = 0
  private readonly matches = new CatalogMatchCache()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.state

  private set(change: Partial<RecommendationsSnapshot>) {
    this.state = { ...this.state, ...change }
    this.listeners.forEach((l) => l())
  }

  configure(discover: PlexDiscoverAPI | undefined, server: PlexServerAPI | undefined, owner: boolean, detector: () => DetectorClient | null) {
    this.generation += 1
    this.discover = discover
    this.server = server
    this.owner = owner
    this.detector = detector
    this.loadedAt = undefined
    this.running = undefined
    this.set({ shelves: emptyRecommendations, unavailable: false })
  }

  /** The library changed (something was deleted): the next look asks again. */
  expire() {
    this.loadedAt = undefined
  }

  /** Titles deleted from the server leave «Похожее на сервере» at once. */
  forget(ratingKeys: Set<string>) {
    const shelves = this.state.shelves
    if (!shelves.onServer.some((i) => ratingKeys.has(i.ratingKey))) return
    this.set({ shelves: { ...shelves, onServer: shelves.onServer.filter((i) => !ratingKeys.has(i.ratingKey)) } })
  }

  /**
   * Asks again when the last answer is older than `maxAgeMs` (cheap: the detector keeps TMDB's
   * answers for a day, catalog matches are in storage). While the detector is down TMDB's
   * shelves stay as they were.
   */
  async refresh(watchlist: Watchlist, maxAgeMs = 15 * 60_000) {
    if (this.loadedAt !== undefined && Date.now() - this.loadedAt < maxAgeMs) return
    if (this.running) return this.running
    const discover = this.discover
    const server = this.server
    if (!discover || !server) return
    const detector = this.detector()
    const generation = this.generation
    const task = (async () => {
      await watchlist.refreshIndex()
      const index = watchlist.getSnapshot().index
      // The server's history; a user it is shared with may not get it: then the library's last plays.
      let recent: PlexItem[]
      try {
        recent = RecommendationSeeds.recentFromHistory(await server.history(this.owner ? 1 : undefined), index)
      } catch (error) {
        console.warn('recommendations: history', error)
        recent = []
      }
      // A history without a usable row (or an empty one) too.
      if (recent.length === 0) recent = RecommendationSeeds.recentFromIndex(index)
      const seeds = RecommendationSeeds.pick(recent)
      // TMDB through the detector. Null: it has no TMDB key. A failure costs only these
      // shelves, Plex's list below doesn't need the detector.
      let titles: Record<string, TMDBTitle[]> = {}
      let configured = true
      let detectorFailed = false
      if (detector && seeds.length > 0) {
        try {
          const answer = await detector.recommendations(seeds.map(seedKey))
          if (answer) titles = answer
          else configured = false
        } catch (error) {
          console.warn('recommendations: detector', error)
          detectorFailed = true
        }
      }
      // Plex's «More From This Cast & Crew» of the last watched title the catalog knows that
      // has one (some have an empty list): up to three asked.
      let castSeed: PlexItem | undefined
      let credits: DiscoverItem[] = []
      for (const item of recent.filter((i) => catalogKey(i)).slice(0, 3)) {
        const list = await discover.moreFromCredits(catalogKey(item)!).catch(() => [] as DiscoverItem[])
        if (makeCastShelf(item, list, index, new Map())) {
          castSeed = item
          credits = list
          break
        }
      }
      // Catalog entries of what the server lacks: from storage, the rest asked.
      const wanted = seeds.flatMap((s) => titles[seedKey(s)] ?? []).filter((t) => !index.itemByTMDB(t.type, t.tmdbId))
      const catalog = await this.matches.entries(wanted, discover)
      const keys = [...new Set([...Object.values(catalog).map((c) => c.ratingKey), ...credits.map((c) => c.ratingKey)])]
      const states = await discover.userStates(keys).catch(() => new Map<string, DiscoverUserState>())
      const shelves = makeRecommendationShelves(seeds, titles, catalog, index, states)
      if (castSeed) {
        const shown = new Set(shelves.because.flatMap((b) => b.items.map((i) => i.ratingKey)))
        shelves.cast = makeCastShelf(castSeed, credits, index, states, shown)
      }
      if (generation !== this.generation) return
      if (detectorFailed) {
        // Down for a moment: TMDB's shelves stay as they were, asked again next time.
        shelves.onServer = this.state.shelves.onServer
        shelves.because = this.state.shelves.because
      } else {
        this.loadedAt = Date.now()
      }
      this.set({ shelves, unavailable: !configured })
    })()
    this.running = task
    try {
      await task
    } finally {
      if (generation === this.generation) this.running = undefined
    }
  }
}

interface MatchEntry {
  item?: DiscoverItem
  /** Unix ms. */
  at: number
}

const MATCHES_KEY = 'tmdbPlexMatches'
const DAY = 86_400_000

/**
 * TMDB id → Plex catalog title, kept in storage: the mapping rarely changes, and Plex is asked
 * once per title (a few at a time). Kept a month; "Plex has none" a week.
 */
export class CatalogMatchCache {
  private entriesByKey?: Record<string, MatchEntry>
  /** New titles asked per refresh; the rest wait for the next one. */
  private readonly askLimit = 45

  constructor(private readonly key = MATCHES_KEY) {}

  async entries(titles: TMDBTitle[], discover: PlexDiscoverAPI): Promise<Record<string, DiscoverItem>> {
    const cache = this.load()
    const now = Date.now()
    const missing: TMDBTitle[] = []
    const seen = new Set<string>()
    for (const title of titles) {
      const key = tmdbKey(title)
      if (seen.has(key) || !tmdbKind(title)) continue
      seen.add(key)
      const entry = cache[key]
      if (entry && now - entry.at < (entry.item ? 30 : 7) * DAY) continue
      missing.push(title)
    }
    const batch = missing.slice(0, this.askLimit)
    for (let start = 0; start < batch.length; start += 4) {
      const answers = await Promise.all(
        batch.slice(start, start + 4).map(async (title) => {
          try {
            return { key: tmdbKey(title), item: await discover.match(title.tmdbId, tmdbKind(title)!), answered: true }
          } catch {
            return { key: tmdbKey(title), item: undefined, answered: false }
          }
        }),
      )
      for (const a of answers) if (a.answered) cache[a.key] = { item: a.item, at: now }
    }
    this.entriesByKey = cache
    if (batch.length > 0) writeJSON(this.key, cache)
    const result: Record<string, DiscoverItem> = {}
    for (const title of titles) {
      const item = cache[tmdbKey(title)]?.item
      if (item) result[tmdbKey(title)] = item
    }
    return result
  }

  private load(): Record<string, MatchEntry> {
    if (this.entriesByKey) return this.entriesByKey
    const stored = readJSON<Record<string, MatchEntry>>(this.key)
    this.entriesByKey = stored && typeof stored === 'object' ? stored : {}
    return this.entriesByKey
  }
}
