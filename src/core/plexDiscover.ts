import { fetchChecked, fetchJSON, HTTPError, isRecord, joinURL, lossyDouble, lossyInt, lossyString, type FetchFn } from './http'
import type { PlexClientInfo } from './plexAccount'
import type { CatalogTitles } from './catalogTitles'
import { catalogKey, parseGuids, parseMetadata, tmdbIDFromGuids, type PlexItem } from './plexModels'

export type DiscoverKind = 'movie' | 'show'

/**
 * Ready-made collections of Plex's catalog (`/hubs/sections/home/<id>`), the ones checked to
 * have content: the «Обзор» page.
 */
export type CatalogHub = 'trending-plex' | 'top_watchlisted' | 'coming-soon' | 'highly-anticipated-movies'

export const catalogHubs: { id: CatalogHub; title: string; detail: string; upcoming: boolean }[] = [
  { id: 'trending-plex', title: 'Популярное в Plex', detail: 'Что смотрят на Plex сейчас.', upcoming: false },
  { id: 'top_watchlisted', title: 'Чаще всего добавляют в список', detail: 'Что на этой неделе чаще всего добавляют в список Plex.', upcoming: false },
  // Not out yet, mostly: the release date says more than the year.
  { id: 'coming-soon', title: 'Скоро выйдет', detail: 'Фильмы и сериалы, которые скоро выходят.', upcoming: true },
  { id: 'highly-anticipated-movies', title: 'Самые ожидаемые фильмы', detail: 'Фильмы, которых ждут больше всего.', upcoming: true },
]

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
  /**
   * Plex's own name when `title` is a translation (`CatalogTitles`): «Soulm8te» for «СОУЛМ8ЙТ».
   * Matching library items by name uses it.
   */
  catalogTitle?: string
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
   * Plex's watch history of the account, wherever it was watched (`userStates`; the watchlist
   * itself carries none). Missing: the title counts as not watched.
   */
  viewCount?: number
  /** Episodes of a show watched. */
  viewedLeafCount?: number
  /** `complete` once a movie, or every episode of a show, is watched. */
  viewState?: string
  /** A new season of the show (collections like «Coming Soon» list seasons): its number. */
  season?: number
  /** Other ids of the title (`tmdb://…`, `imdb://…`): catalog details carry them. */
  guids?: string[]
}

/** TMDB id of a catalog title, from its `guids` (details only). */
export function discoverTmdbID(item: DiscoverItem): number | undefined {
  return tmdbIDFromGuids(item.guids)
}

/** Watch state of a catalog title for the account (`/library/metadata/<keys>/userState`). */
export interface DiscoverUserState {
  ratingKey: string
  viewCount?: number
  viewedLeafCount?: number
  viewState?: string
}

function parseUserState(raw: unknown): DiscoverUserState | null {
  if (!isRecord(raw)) return null
  return {
    ratingKey: lossyString(raw.ratingKey) ?? '',
    viewCount: lossyInt(raw.viewCount),
    viewedLeafCount: lossyInt(raw.viewedLeafCount),
    viewState: lossyString(raw.viewState),
  }
}

/** `UserState` of a `/userState` answer: a list (discover) or one object (metadata provider). */
export function parseUserStates(json: unknown): DiscoverUserState[] {
  const container = isRecord(json) && isRecord(json.MediaContainer) ? json.MediaContainer : {}
  const raw = Array.isArray(container.UserState) ? container.UserState : [container.UserState]
  return raw.map(parseUserState).filter((s): s is DiscoverUserState => s !== null && s.ratingKey !== '')
}

/**
 * A catalog movie or show; null for people, episodes, collections and entries without a key.
 * A season (collections list new seasons) stands for its show, with the season's number.
 */
export function parseDiscoverItem(raw: unknown): DiscoverItem | null {
  if (!isRecord(raw)) return null
  const isSeason = lossyString(raw.type) === 'season'
  const type = isSeason ? 'show' : lossyString(raw.type)
  const ratingKey = lossyString(isSeason ? raw.parentRatingKey : raw.ratingKey)
  if ((type !== 'movie' && type !== 'show') || !ratingKey) return null
  // Watch state as attributes, or as a `UserState` child (one object or a list of one).
  const state = parseUserState(Array.isArray(raw.UserState) ? raw.UserState[0] : raw.UserState)
  return {
    ratingKey,
    guid: isSeason ? `plex://show/${ratingKey}` : (lossyString(raw.guid) ?? `plex://${type}/${ratingKey}`),
    kind: type,
    title: (isSeason ? lossyString(raw.parentTitle) : undefined) ?? lossyString(raw.title) ?? '',
    season: isSeason ? lossyInt(raw.index) : undefined,
    guids: isSeason ? [] : parseGuids(raw.Guid),
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
    viewCount: lossyInt(raw.viewCount) ?? state?.viewCount,
    viewedLeafCount: lossyInt(raw.viewedLeafCount) ?? state?.viewedLeafCount,
    viewState: lossyString(raw.viewState) ?? state?.viewState,
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
    guids: item.guids,
  }
}

const kindName = (item: DiscoverItem) => (item.kind === 'movie' ? 'Фильм' : 'Сериал')

/** "Фильм · 2021" / "Сериал · 2000" / "Сезон 9 · 2027". */
export function discoverCaption(item: DiscoverItem): string {
  const kind = item.season !== undefined ? `Сезон ${item.season}` : kindName(item)
  return item.year !== undefined ? `${kind} · ${item.year}` : kind
}

/**
 * Watched according to Plex: a movie played at least once, a show with any episode watched
 * (started elsewhere is not "want to watch" either).
 */
export function isWatchedInPlex(item: DiscoverItem): boolean {
  if (item.viewState === 'complete') return true
  return item.kind === 'movie' ? (item.viewCount ?? 0) > 0 : (item.viewedLeafCount ?? 0) > 0
}

/** The item with the watch state Plex gave for it (unchanged without one). */
export function withUserState(item: DiscoverItem, state: DiscoverUserState | undefined): DiscoverItem {
  if (!state) return item
  return { ...item, viewCount: state.viewCount, viewedLeafCount: state.viewedLeafCount, viewState: state.viewState }
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
 * Under a poster of what is not out yet: "12 марта 2027", "2027", "Дата не объявлена"; a new
 * season: "Сезон 9 · 12 марта 2027". The date alone: with the kind it doesn't fit under a phone
 * poster.
 */
export function upcomingCaption(item: DiscoverItem): string {
  const day = releaseDay(item)
  const date = (day ? russianDate(day) : undefined) ?? (item.year !== undefined ? String(item.year) : undefined)
  if (item.season === undefined) return date ?? 'Дата не объявлена'
  return `Сезон ${item.season} · ${date ?? 'дата не объявлена'}`
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
    /** Russian names of titles Plex has only in English (`/v1/titles`); Russian only, like Apple's. */
    readonly titles?: CatalogTitles,
  ) {}

  /**
   * `items` with Russian names where Plex has only English ones. `waitMs` 0: names already known
   * now, the rest next time (search as you type, long filmographies).
   */
  async named(items: DiscoverItem[], waitMs?: number): Promise<DiscoverItem[]> {
    if (!this.titles || !this.language.startsWith('ru') || items.length === 0) return items
    return this.titles.localize(items, waitMs)
  }

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
    return this.named(parseDiscoverSearch(await fetchJSON(this.fetchFn, url, this.init('GET', signal))), 0)
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
        // No watch state here, `includeUserState` or not (items say `userState: false`, checked
        // on a real account): `userStates` asks for it.
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
    return this.named(result.slice(0, limit))
  }

  /** Watch state of many titles: `chunk` keys per request (50 checked on a real account). */
  async userStates(ratingKeys: string[], chunk = 50): Promise<Map<string, DiscoverUserState>> {
    const result = new Map<string, DiscoverUserState>()
    for (let start = 0; start < ratingKeys.length; start += chunk) {
      const keys = ratingKeys.slice(start, start + chunk).map(encodeURIComponent).join(',')
      const url = joinURL(this.base, `/library/metadata/${keys}/userState`)
      for (const state of parseUserStates(await fetchJSON(this.fetchFn, url, this.init()))) result.set(state.ratingKey, state)
    }
    return result
  }

  /**
   * The catalog title with this TMDB id (`/library/metadata/matches`), undefined when Plex has
   * none. One request per title: callers cache the answers, so it comes with Plex's name; `named`
   * gives it the Russian one when shown.
   */
  async match(tmdbID: number, kind: DiscoverKind): Promise<DiscoverItem | undefined> {
    const url = joinURL(this.base, '/library/metadata/matches', { type: kind === 'movie' ? '1' : '2', guid: `tmdb://${tmdbID}` })
    try {
      return parseDiscoverItems(await fetchJSON(this.fetchFn, url, this.init())).items[0]
    } catch (error) {
      if (error instanceof HTTPError && error.status === 404) return undefined
      throw error
    }
  }

  /** «More From This Cast & Crew»: other titles of the cast and crew of a catalog title. */
  async moreFromCredits(ratingKey: string): Promise<DiscoverItem[]> {
    const url = joinURL(this.base, `/library/metadata/${encodeURIComponent(ratingKey)}/more-from-credits`)
    return this.named(parseDiscoverItems(await fetchJSON(this.fetchFn, url, this.init())).items, 0)
  }

  /** One of the catalog's ready-made collections (`/hubs/sections/home/<id>`). */
  async hub(hub: CatalogHub): Promise<DiscoverItem[]> {
    const url = joinURL(this.base, `/hubs/sections/home/${encodeURIComponent(hub)}`)
    return this.named(parseDiscoverItems(await fetchJSON(this.fetchFn, url, this.init())).items)
  }

  /** Seasons of a catalog show or episodes of a catalog season, in the server's format. */
  async children(ratingKey: string, signal?: AbortSignal): Promise<PlexItem[]> {
    const url = joinURL(this.base, `/library/metadata/${encodeURIComponent(ratingKey)}/children`)
    return parseMetadata(await fetchJSON(this.fetchFn, url, this.init('GET', signal)))
  }

  /**
   * Marks a catalog title, season or episode watched (or not) for the account, the way Plex
   * apps do for titles not on a server.
   */
  async setWatched(ratingKey: string, watched: boolean) {
    const url = joinURL(this.metadataBase, watched ? '/actions/scrobble' : '/actions/unscrobble', {
      key: ratingKey,
      identifier: 'com.plexapp.plugins.library',
    })
    await fetchChecked(this.fetchFn, url, this.init())
  }

  /** metadata.provider.plex.tv next to discover.provider.plex.tv; another base (the fakes) serves both. */
  get metadataBase(): string {
    try {
      const url = new URL(this.base)
      if (url.hostname !== 'discover.provider.plex.tv') return this.base
      url.hostname = 'metadata.provider.plex.tv'
      return url.toString().replace(/\/$/, '')
    } catch {
      return this.base
    }
  }

  /** Full catalog entry: description, genres, rating. */
  async details(ratingKey: string, signal?: AbortSignal): Promise<DiscoverItem | undefined> {
    const url = joinURL(this.base, `/library/metadata/${encodeURIComponent(ratingKey)}`)
    const items = parseDiscoverItems(await fetchJSON(this.fetchFn, url, this.init('GET', signal))).items.slice(0, 1)
    return (await this.named(items))[0]
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
