import { isReleased, isWatchedInPlex, releaseDay, type DiscoverItem } from './plexDiscover'
import { catalogKey, tmdbID, type PlexItem } from './plexModels'

/** Case and diacritics folded, like Swift's `.caseInsensitive, .diacriticInsensitive` (ё = е, й = и). */
export function foldTitle(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Kind, folded title and year: how an old-agent item is recognised without a catalog key. */
function titleKey(kind: string, title: string, year: number): string {
  return `${kind}|${foldTitle(title.trim())}|${year}`
}

/**
 * Movies and shows of the server's libraries by catalog key, to tell which catalog titles
 * (search results, watchlist) are already on the server. Only items matched by the modern
 * Plex agents have a catalog key; the rest (old agents) are matched by kind, title and year.
 */
export class LibraryIndex {
  static readonly empty = new LibraryIndex([])

  private readonly byCatalogKey: Map<string, PlexItem>
  private readonly byTitle: Map<string, PlexItem>
  private readonly byTMDB: Map<string, PlexItem>
  private readonly byRatingKey: Map<string, PlexItem>
  private readonly folded: string[]

  constructor(readonly items: PlexItem[]) {
    this.byCatalogKey = new Map()
    this.byTitle = new Map()
    this.byTMDB = new Map()
    this.byRatingKey = new Map()
    for (const item of items) {
      this.byRatingKey.set(item.ratingKey, item)
      const tmdb = tmdbID(item)
      if (tmdb !== undefined && (item.type === 'movie' || item.type === 'show')) {
        const k = `${item.type === 'movie' ? 'movie' : 'tv'}:${tmdb}`
        if (!this.byTMDB.has(k)) this.byTMDB.set(k, item)
      }
      const key = catalogKey(item)
      if (key) {
        if (!this.byCatalogKey.has(key)) this.byCatalogKey.set(key, item)
      } else if ((item.type === 'movie' || item.type === 'show') && item.year !== undefined) {
        // Only keyless items: a modern-agent item with the same title and year is another title
        // (the catalog key tells them apart), e.g. a remake.
        const title = titleKey(item.type, item.title, item.year)
        if (!this.byTitle.has(title)) this.byTitle.set(title, item)
      }
    }
    this.folded = items.map((item) => foldTitle(item.title))
  }

  get isEmpty(): boolean {
    return this.items.length === 0
  }

  /** The library item of a catalog title, if the server has it. */
  item(entry: DiscoverItem): PlexItem | undefined {
    const exact = this.byCatalogKey.get(entry.ratingKey)
    if (exact || entry.year === undefined) return exact
    // Plex's own name first: `title` may be a Russian translation of it (`CatalogTitles`).
    const own = this.byTitle.get(titleKey(entry.kind, entry.catalogTitle ?? entry.title, entry.year))
    return own ?? (entry.catalogTitle ? this.byTitle.get(titleKey(entry.kind, entry.title, entry.year)) : undefined)
  }

  /** The library movie or show with this TMDB id (`movie` or `tv`). */
  itemByTMDB(kind: string, id: number): PlexItem | undefined {
    return this.byTMDB.get(`${kind}:${id}`)
  }

  /** The library movie or show with this server key. */
  itemByKey(ratingKey: string): PlexItem | undefined {
    return this.byRatingKey.get(ratingKey)
  }

  /** The index without these titles (deleted from the server). */
  without(ratingKeys: Set<string>): LibraryIndex {
    return new LibraryIndex(this.items.filter((i) => !ratingKeys.has(i.ratingKey)))
  }

  /** Library movies and shows whose title contains `query` (case and diacritics ignored). */
  search(query: string, limit = 40): PlexItem[] {
    const needle = foldTitle(query.trim())
    if (!needle) return []
    const result: PlexItem[] = []
    for (let i = 0; i < this.items.length && result.length < limit; i++) {
      if (this.folded[i].includes(needle)) result.push(this.items[i])
    }
    return result
  }
}

/** Results of one search: what can be watched now and what is only in the catalog. */
export interface CatalogSearchResult {
  /** Library items: the catalog's best matches that the server has, then title matches. */
  inLibrary: PlexItem[]
  /** Catalog titles the server doesn't have. */
  elsewhere: DiscoverItem[]
}

export function isEmptySearchResult(result: CatalogSearchResult): boolean {
  return result.inLibrary.length === 0 && result.elsewhere.length === 0
}

/** Splits catalog results by whether the server has them; a library title is never also a catalog result. */
export function mergeCatalogSearch(query: string, index: LibraryIndex, catalog: DiscoverItem[]): CatalogSearchResult {
  const seen = new Set<string>()
  const inLibrary: PlexItem[] = []
  const elsewhere: DiscoverItem[] = []
  for (const entry of catalog) {
    const item = index.item(entry)
    if (!item) {
      elsewhere.push(entry)
    } else if (!seen.has(item.ratingKey)) {
      seen.add(item.ratingKey)
      inLibrary.push(item)
    }
  }
  for (const item of index.search(query)) {
    if (seen.has(item.ratingKey)) continue
    seen.add(item.ratingKey)
    inLibrary.push(item)
  }
  return { inLibrary, elsewhere }
}

/**
 * The watchlist as Home and the empty search show it: only what the server doesn't have yet.
 * What it has is in «Недавно добавлено» anyway and drops off these shelves.
 */
export interface WatchlistShelves {
  /** «Хочу посмотреть»: out, not on the server, not watched. Last added first. */
  wanted: DiscoverItem[]
  /** «Ещё не вышло»: soonest first, titles without a date last. */
  upcoming: DiscoverItem[]
}

export const emptyShelves: WatchlistShelves = { wanted: [], upcoming: [] }

export function shelvesAreEmpty(shelves: WatchlistShelves): boolean {
  return shelves.wanted.length === 0 && shelves.upcoming.length === 0
}

/** `today` is `yyyy-MM-dd` (`dayOf`). */
export function makeWatchlistShelves(watchlist: DiscoverItem[], index: LibraryIndex, today: string): WatchlistShelves {
  const wanted: DiscoverItem[] = []
  const upcoming: { order: number; sortKey: string; item: DiscoverItem }[] = []
  watchlist.forEach((item, order) => {
    if (index.item(item)) return
    if (!isReleased(item, today)) {
      // A day sorts before the rest of its year ("2027-03-12" < "2027-~").
      const sortKey = releaseDay(item) ?? (item.year !== undefined ? `${item.year}-~` : '~')
      upcoming.push({ order, sortKey, item })
    } else if (!isWatchedInPlex(item)) {
      wanted.push(item)
    }
  })
  upcoming.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.order - b.order))
  return { wanted, upcoming: upcoming.map((u) => u.item) }
}

/** Texts of catalog pages (same as the Apple apps). */
export const CatalogText = {
  /** "1 сезон", "3 сезона", "5 сезонов". */
  seasons(count: number): string {
    const mod10 = count % 10
    const mod100 = count % 100
    let word = 'сезонов'
    if (mod10 === 1 && mod100 !== 11) word = 'сезон'
    else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = 'сезона'
    return `${count} ${word}`
  },

  /** Under «Найдите фильм или сериал» in the empty search. */
  searchHint:
    'Ищу на сервере и во всём каталоге Plex. Чего нет на сервере, можно добавить в список Plex (он общий с приложениями Plex): оно появится здесь, в «Хочу посмотреть» или «Ещё не вышло».',

  notOnServer(server?: string): string {
    const place = server ? `На сервере «${server}» этого нет.` : 'На сервере этого нет.'
    return `${place} Список общий с приложениями Plex.`
  },
}
