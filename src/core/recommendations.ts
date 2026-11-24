import type { LibraryIndex } from './catalogMatch'
import { isRecord, lossyInt, lossyString } from './http'
import { catalogKey, tmdbID, type PlexItem, type PlexItemType } from './plexModels'
import { isWatchedInPlex, withUserState, type DiscoverItem, type DiscoverKind, type DiscoverUserState } from './plexDiscover'

// Port of SkipTVKit's Recommendations.swift.

/** A title TMDB recommends, from the detector's `/v1/recommendations`. */
export interface TMDBTitle {
  tmdbId: number
  /** `movie` or `tv`. */
  type: string
  title: string
  year?: number
}

export function parseTMDBTitle(raw: unknown): TMDBTitle | null {
  if (!isRecord(raw)) return null
  const tmdbId = lossyInt(raw.tmdbId)
  const type = lossyString(raw.type)
  if (tmdbId === undefined || !type) return null
  return { tmdbId, type, title: lossyString(raw.title) ?? '', year: lossyInt(raw.year) }
}

export function tmdbKind(title: TMDBTitle): DiscoverKind | undefined {
  return title.type === 'movie' ? 'movie' : title.type === 'tv' ? 'show' : undefined
}

/** `movie:603`: the key of TMDB → Plex matches. */
export function tmdbKey(title: TMDBTitle): string {
  return `${title.type}:${title.tmdbId}`
}

/** One play of `/status/sessions/history/all`. */
export interface PlexHistoryEntry {
  ratingKey?: string
  type: PlexItemType
  /** `/library/metadata/52323` of an episode's show; missing once the show left the server. */
  grandparentKey?: string
  viewedAt?: number
  accountID?: number
}

const itemTypes: PlexItemType[] = ['movie', 'show', 'season', 'episode', 'clip']

export function parseHistory(json: unknown): PlexHistoryEntry[] {
  const container = isRecord(json) && isRecord(json.MediaContainer) ? json.MediaContainer : {}
  if (!Array.isArray(container.Metadata)) return []
  return container.Metadata.filter(isRecord).map((raw) => {
    const type = lossyString(raw.type) ?? ''
    return {
      ratingKey: lossyString(raw.ratingKey),
      type: itemTypes.find((t) => t === type) ?? 'other',
      grandparentKey: lossyString(raw.grandparentKey),
      viewedAt: lossyInt(raw.viewedAt),
      accountID: lossyInt(raw.accountID),
    }
  })
}

/** Server key of the movie, or of the episode's show. */
export function historyTitleKey(entry: PlexHistoryEntry): string | undefined {
  switch (entry.type) {
    case 'movie':
      return entry.ratingKey
    case 'episode':
      return entry.grandparentKey?.split('/').pop() || undefined
    default:
      return undefined
  }
}

/** A watched library title the recommendations start from. */
export interface RecommendationSeed {
  item: PlexItem
  tmdbID: number
}

/** `movie:38142` / `tv:75219`. */
export function seedKey(seed: RecommendationSeed): string {
  return `${seed.item.type === 'movie' ? 'movie' : 'tv'}:${seed.tmdbID}`
}

export const RecommendationSeeds = {
  /** Titles of the newest plays still on the server, newest first, each once. */
  recentFromHistory(history: PlexHistoryEntry[], index: LibraryIndex, limit = 20): PlexItem[] {
    const seen = new Set<string>()
    const items: PlexItem[] = []
    for (const entry of history) {
      const key = historyTitleKey(entry)
      if (!key || seen.has(key)) continue
      seen.add(key)
      const item = index.itemByKey(key)
      if (!item) continue
      items.push(item)
      if (items.length === limit) break
    }
    return items
  },

  /**
   * Without the history (a user the server is shared with may not get it): the library's
   * movies and shows by their last play, newest first.
   */
  recentFromIndex(index: LibraryIndex, limit = 20): PlexItem[] {
    return index.items
      .filter((i) => (i.type === 'movie' || i.type === 'show') && i.lastViewedAt !== undefined)
      .sort((a, b) => (b.lastViewedAt ?? 0) - (a.lastViewedAt ?? 0))
      .slice(0, limit)
  },

  /** The first of `recent` with a TMDB id. */
  pick(recent: PlexItem[], limit = 3): RecommendationSeed[] {
    const seeds: RecommendationSeed[] = []
    for (const item of recent) {
      const id = tmdbID(item)
      if (id !== undefined) seeds.push({ item, tmdbID: id })
    }
    return seeds.slice(0, limit)
  },
}

/**
 * «Ещё с актёрами «…»»: Plex's «More From This Cast & Crew» of a watched title, without the
 * title itself, what the server has and what the account watched anywhere.
 */
export interface CastShelf {
  seed: PlexItem
  items: DiscoverItem[]
}

/** `exclude`: catalog keys already on another shelf. Undefined when nothing is left. */
export function makeCastShelf(
  seed: PlexItem,
  items: DiscoverItem[],
  index: LibraryIndex,
  states: Map<string, DiscoverUserState>,
  exclude: Set<string> = new Set(),
  limit = 15,
): CastShelf | undefined {
  const seen = new Set(exclude)
  const seedKey = catalogKey(seed)
  const kept = items.filter((entry) => {
    if (entry.ratingKey === seedKey || index.item(entry)) return false
    if (isWatchedInPlex(withUserState(entry, states.get(entry.ratingKey)))) return false
    if (seen.has(entry.ratingKey)) return false
    seen.add(entry.ratingKey)
    return true
  })
  return kept.length === 0 ? undefined : { seed, items: kept.slice(0, limit) }
}

/** «Потому что вы смотрели «…»» shelves of one seed: titles the server doesn't have. */
export interface BecauseShelf {
  seed: RecommendationSeed
  items: DiscoverItem[]
}

/**
 * Recommendations ready for the home page: what the server has (one shelf for all seeds) apart
 * from the rest (a shelf per seed). Nothing watched, no seed itself.
 */
export interface RecommendationShelves {
  onServer: PlexItem[]
  because: BecauseShelf[]
  /** Plex's own list (no TMDB): works without the detector. */
  cast?: CastShelf
}

export const emptyRecommendations: RecommendationShelves = { onServer: [], because: [] }

export function recommendationsAreEmpty(shelves: RecommendationShelves): boolean {
  return shelves.onServer.length === 0 && shelves.because.every((b) => b.items.length === 0) && !shelves.cast
}

/** Watched or begun on the server: a movie played or in progress, a show with an episode seen. */
export function startedOnServer(item: PlexItem): boolean {
  if (item.type === 'show') return (item.viewedLeafCount ?? 0) > 0 || (item.viewCount ?? 0) > 0
  return (item.viewCount ?? 0) > 0 || (item.viewOffset ?? 0) > 0
}

/**
 * @param titles TMDB's answer by seed key.
 * @param catalog Plex catalog titles by TMDB key (`movie:603`); missing: Plex has none.
 * @param states watch state of catalog titles by catalog key.
 */
export function makeRecommendationShelves(
  seeds: RecommendationSeed[],
  titles: Record<string, TMDBTitle[]>,
  catalog: Record<string, DiscoverItem>,
  index: LibraryIndex,
  states: Map<string, DiscoverUserState>,
  perShelf = 15,
  onServerLimit = 20,
): RecommendationShelves {
  const seedKeys = new Set(seeds.map((s) => s.item.ratingKey))
  const shownLibrary = new Set<string>()
  const shownCatalog = new Set<string>()
  const onServer: PlexItem[] = []
  const because: BecauseShelf[] = []
  for (const seed of seeds) {
    const items: DiscoverItem[] = []
    for (const title of titles[seedKey(seed)] ?? []) {
      const entry = catalog[tmdbKey(title)]
      const library = index.itemByTMDB(title.type, title.tmdbId) ?? (entry ? index.item(entry) : undefined)
      if (library) {
        if (seedKeys.has(library.ratingKey) || startedOnServer(library) || shownLibrary.has(library.ratingKey)) continue
        shownLibrary.add(library.ratingKey)
        if (onServer.length < onServerLimit) onServer.push(library)
      } else if (entry && items.length < perShelf) {
        if (isWatchedInPlex(withUserState(entry, states.get(entry.ratingKey))) || shownCatalog.has(entry.ratingKey)) continue
        shownCatalog.add(entry.ratingKey)
        // `matches` answers in English whatever the language asked; TMDB's title comes in
        // the language the detector asked for (ru-RU).
        items.push(title.title ? { ...entry, title: title.title } : entry)
      }
    }
    if (items.length > 0) because.push({ seed, items })
  }
  return { onServer, because }
}

export const RecommendationText = {
  /** «Потому что вы смотрели «Теория большого взрыва»». */
  because: (title: string) => `Потому что вы смотрели «${title}»`,
  /** «Ещё с актёрами «Теория большого взрыва»». */
  cast: (title: string) => `Ещё с актёрами «${title}»`,
}
