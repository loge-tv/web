import { fetchChecked, fetchJSON, isRecord, joinURL, lossyDouble, lossyInt, lossyString, type FetchFn } from './http'
import type { PlexClientInfo } from './plexAccount'
import { catalogKey, type PlexItem } from './plexModels'

export type DiscoverKind = 'movie' | 'show'

/**
 * A movie or show from Plex's online catalog (Discover), whether or not it is on the server.
 * `ratingKey` is the catalog key, not a key of the media server.
 */
export interface DiscoverItem {
  ratingKey: string
  /** `plex://movie/<ratingKey>` or `plex://show/<ratingKey>`: what library items carry in `guid`. */
  guid: string
  kind: DiscoverKind
  title: string
  year?: number
  summary?: string
  /** Absolute picture URLs (TMDB, Plex's own CDN). */
  thumb?: string
  art?: string
  /** Milliseconds (a movie, or an episode of a show). */
  duration?: number
  contentRating?: string
  audienceRating?: number
  /** Seasons of a show. */
  childCount?: number
  originallyAvailableAt?: string
  genres: string[]
  /**
   * Plex's watch history of the account (`includeUserState`), wherever it was watched.
   * Missing when Plex gives none: such a title counts as not watched.
   */
  viewCount?: number
  /** `complete` once a movie, or every episode of a show, is watched. */
  viewState?: string
}

/** A catalog movie or show; null for people, episodes, collections and entries without a key. */
export function parseDiscoverItem(raw: unknown): DiscoverItem | null {
  if (!isRecord(raw)) return null
  const type = lossyString(raw.type)
  const ratingKey = lossyString(raw.ratingKey)
  if ((type !== 'movie' && type !== 'show') || !ratingKey) return null
  // Watch state as attributes, or as a `UserState` child (one object or a list of one).
  const userState = Array.isArray(raw.UserState) ? raw.UserState[0] : raw.UserState
  const state = isRecord(userState) ? userState : {}
  return {
    ratingKey,
    guid: lossyString(raw.guid) ?? `plex://${type}/${ratingKey}`,
    kind: type,
    title: lossyString(raw.title) ?? '',
    year: lossyInt(raw.year),
    summary: lossyString(raw.summary),
    thumb: lossyString(raw.thumb),
    art: lossyString(raw.art),
    duration: lossyInt(raw.duration),
    contentRating: lossyString(raw.contentRating),
    audienceRating: lossyDouble(raw.audienceRating),
    childCount: lossyInt(raw.childCount),
    originallyAvailableAt: lossyString(raw.originallyAvailableAt),
    genres: Array.isArray(raw.Genre)
      ? raw.Genre.filter(isRecord)
          .map((g) => lossyString(g.tag))
          .filter((g): g is string => !!g)
      : [],
    viewCount: lossyInt(raw.viewCount) ?? lossyInt(state.viewCount),
    viewState: lossyString(raw.viewState) ?? lossyString(state.viewState),
  }
}

/** A minimal catalog entry for tests. */
export function makeDiscoverItem(fields: Partial<DiscoverItem> & { ratingKey: string; kind: DiscoverKind; title: string }): DiscoverItem {
  return { guid: `plex://${fields.kind}/${fields.ratingKey}`, genres: [], ...fields }
}

/**
 * The catalog entry of a library movie or show matched by the modern Plex agents, so it can be
 * put on the watchlist. Pictures stay on the server: none here.
 */
export function discoverItemFromLibrary(item: PlexItem): DiscoverItem | undefined {
  const key = catalogKey(item)
  if (!key || (item.type !== 'movie' && item.type !== 'show')) return undefined
  return {
    ratingKey: key,
    guid: item.guid ?? `plex://${item.type}/${key}`,
    kind: item.type,
    title: item.title,
    year: item.year,
    summary: item.summary,
    duration: item.duration,
    contentRating: item.contentRating,
    audienceRating: item.audienceRating,
    childCount: item.childCount,
    originallyAvailableAt: item.originallyAvailableAt,
    genres: [],
  }
}

const kindName = (item: DiscoverItem) => (item.kind === 'movie' ? 'Фильм' : 'Сериал')

/** "Фильм · 2021" / "Сериал · 2000". */
export function discoverCaption(item: DiscoverItem): string {
  return item.year !== undefined ? `${kindName(item)} · ${item.year}` : kindName(item)
}

/** Watched according to Plex: a movie played at least once, a show to the end. */
export function isWatchedInPlex(item: DiscoverItem): boolean {
  return item.viewState === 'complete' || (item.kind === 'movie' && (item.viewCount ?? 0) > 0)
}

/** Release (a show's premiere) as `yyyy-MM-dd`, when Plex gives the day. */
export function releaseDay(item: DiscoverItem): string | undefined {
  const day = item.originallyAvailableAt?.slice(0, 10)
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined
}

/** Out by `today` (`yyyy-MM-dd`). Without a day the year decides; a title with neither is only announced. */
export function isReleased(item: DiscoverItem, today: string): boolean {
  const day = releaseDay(item)
  if (day) return day <= today
  const thisYear = Number(today.slice(0, 4))
  if (item.year !== undefined && Number.isInteger(thisYear)) return item.year <= thisYear
  return false
}

const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

/** "2027-03-12" → "12 марта 2027". */
export function russianDate(day: string): string | undefined {
  const parts = day.split('-').map(Number)
  if (parts.length !== 3 || !parts.every(Number.isInteger)) return undefined
  const [year, month, date] = parts
  if (month < 1 || month > 12 || date < 1 || date > 31) return undefined
  return `${date} ${months[month - 1]} ${year}`
}

/**
 * Under a poster of what is not out yet: "12 марта 2027", "2027", "Дата не объявлена". The
 * date alone: with the kind it doesn't fit under a phone poster.
 */
export function upcomingCaption(item: DiscoverItem): string {
  const day = releaseDay(item)
  const date = day ? russianDate(day) : undefined
  if (date) return date
  if (item.year !== undefined) return String(item.year)
  return 'Дата не объявлена'
}

/** `yyyy-MM-dd` of a date in the browser's time zone (or `timeZone`), for `isReleased`. */
export function dayOf(date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function container(json: unknown): Record<string, unknown> {
  if (isRecord(json) && isRecord(json.MediaContainer)) return json.MediaContainer
  throw new Error('Неожиданный ответ каталога Plex')
}

function items(list: unknown): DiscoverItem[] {
  return Array.isArray(list) ? list.map(parseDiscoverItem).filter((i): i is DiscoverItem => i !== null) : []
}

/** `GET /library/search`: results in groups; movies and shows of every group, in order, each once. */
export function parseDiscoverSearch(json: unknown): DiscoverItem[] {
  const groups = container(json).SearchResults
  if (!Array.isArray(groups)) return []
  const seen = new Set<string>()
  const result: DiscoverItem[] = []
  for (const group of groups.filter(isRecord)) {
    const results = Array.isArray(group.SearchResult) ? group.SearchResult.filter(isRecord) : []
    for (const item of items(results.map((r) => r.Metadata))) {
      if (seen.has(item.ratingKey)) continue
      seen.add(item.ratingKey)
      result.push(item)
    }
  }
  return result
}

/** Watchlist page and item details: `Metadata` (sometimes `Video`) plus `totalSize`. */
export function parseDiscoverItems(json: unknown): { items: DiscoverItem[]; totalSize?: number } {
  const c = container(json)
  return { items: items(Array.isArray(c.Metadata) ? c.Metadata : c.Video), totalSize: lossyInt(c.totalSize) }
}

/**
 * Plex's online catalog for the signed-in account: search over all movies and shows, and the
 * account's Watchlist (the same list as in the Plex apps). Uses the plex.tv account token,
 * not a server token.
 */
export class PlexDiscoverAPI {
  static readonly defaultBase = 'https://discover.provider.plex.tv'
  /**
   * Plex's image resizer. Catalog pictures are on image.tmdb.org, which some ISPs block;
   * through it they come from a Plex host.
   */
  static readonly defaultImageBase = 'https://images.plex.tv'

  constructor(
    readonly token: string,
    readonly client: PlexClientInfo,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
    readonly base = PlexDiscoverAPI.defaultBase,
    readonly imageBase = PlexDiscoverAPI.defaultImageBase,
    /** `X-Plex-Language`: titles and descriptions come in this language when Plex has them. */
    readonly language = 'ru',
  ) {}

  /**
   * Auth in headers (as the Apple app does), unlike the server and plex.tv clients: this is
   * what was checked against the real Discover, whose CORS allows these headers and PUT, and
   * the account token stays out of URLs. Costs one preflight per URL.
   */
  private init(method = 'GET', signal?: AbortSignal): RequestInit {
    return {
      method,
      signal,
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': this.token,
        'X-Plex-Client-Identifier': this.client.clientIdentifier,
        'X-Plex-Product': this.client.product,
        'X-Plex-Language': this.language,
      },
    }
  }

  /** Movies and shows whose title matches `query`, best first. */
  async search(query: string, limit = 30, signal?: AbortSignal): Promise<DiscoverItem[]> {
    const url = joinURL(this.base, '/library/search', {
      query,
      limit,
      searchTypes: 'movies,tv',
      searchProviders: 'discover',
      includeMetadata: '1',
    })
    return parseDiscoverSearch(await fetchJSON(this.fetchFn, url, this.init('GET', signal)))
  }

  /** The account's watchlist, as Plex orders it (last added first), up to `limit` items. */
  async watchlist(pageSize = 100, limit = 500): Promise<DiscoverItem[]> {
    const result: DiscoverItem[] = []
    const seen = new Set<string>()
    let start = 0
    while (result.length < limit) {
      const url = joinURL(this.base, '/library/sections/watchlist/all', {
        'X-Plex-Container-Start': start,
        'X-Plex-Container-Size': pageSize,
        // Watch state, so watched titles leave «Хочу посмотреть».
        includeUserState: '1',
      })
      const page = parseDiscoverItems(await fetchJSON(this.fetchFn, url, this.init()))
      for (const item of page.items) {
        if (seen.has(item.ratingKey)) continue
        seen.add(item.ratingKey)
        result.push(item)
      }
      start += pageSize
      if (page.items.length === 0 || start >= (page.totalSize ?? 0)) break
    }
    return result.slice(0, limit)
  }

  /** Full catalog entry: description, genres, rating. */
  async details(ratingKey: string, signal?: AbortSignal): Promise<DiscoverItem | undefined> {
    const url = joinURL(this.base, `/library/metadata/${encodeURIComponent(ratingKey)}`)
    return parseDiscoverItems(await fetchJSON(this.fetchFn, url, this.init('GET', signal))).items[0]
  }

  async addToWatchlist(ratingKey: string) {
    await fetchChecked(this.fetchFn, joinURL(this.base, '/actions/addToWatchlist', { ratingKey }), this.init('PUT'))
  }

  async removeFromWatchlist(ratingKey: string) {
    await fetchChecked(this.fetchFn, joinURL(this.base, '/actions/removeFromWatchlist', { ratingKey }), this.init('PUT'))
  }

  /** A catalog picture resized by Plex (no token needed). Undefined for a missing or relative path. */
  imageURL(path: string | undefined, width: number, height: number): string | undefined {
    if (!path || !path.startsWith('http')) return undefined
    return joinURL(this.imageBase, '/photo', { width, height, minSize: 1, upscale: 1, url: path })
  }
}
