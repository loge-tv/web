import { fetchWithTimeout, HTTPError, isRecord, joinURL, lossyInt, lossyString, type FetchFn } from './http'
import { parseTMDBTitle, type TMDBTitle } from './recommendations'

/**
 * Client of the TMDB proxy (sepiatv/tmdb-proxy): titles in Russian, trailers and
 * recommendations, from TMDB on the app author's key. It answers Sepia Server's `/v1/titles`,
 * `/v1/videos` and `/v1/recommendations` with the same JSON. Everyone uses it, Sepia Server or not
 * (trailer streams for TVs stay with Sepia Server; the web embeds YouTube's player).
 *
 * Requests carry only `Accept` and the builds' `X-Client-Token`, which is all the proxy's CORS
 * allows. No Plex token: the proxy refuses one (400). Every refusal is temporary, so it throws:
 * 404 doesn't mean "no TMDB key" here, and 401 (a wrong builds' token) is fixed by a new build.
 * 429 holds every route until its `Retry-After`.
 */
export class TMDBClient {
  /** Unix ms: until then nothing is asked (the proxy's 429). */
  private pausedUntil = 0

  constructor(
    readonly baseURL: string,
    private readonly clientToken: string,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
    /** TMDB may take a while on a cold cache, and a trailer search up to 8 s more. */
    readonly timeoutMs = 20_000,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * TMDB's recommendations for `seeds` (`movie:603`, `tv:1396`; at most 5), by seed. Seeds TMDB
   * didn't answer are missing.
   */
  async recommendations(seeds: string[], language = 'ru-RU'): Promise<Record<string, TMDBTitle[]>> {
    if (seeds.length === 0) return {}
    const json = await this.get('/v1/recommendations', { seeds: seeds.join(','), language })
    const result: Record<string, TMDBTitle[]> = {}
    const items = isRecord(json) && Array.isArray(json.items) ? json.items : []
    for (const item of items.filter(isRecord)) {
      const seed = lossyString(item.seed)
      if (!seed || item.failed === true) continue
      result[seed] = Array.isArray(item.titles) ? item.titles.map(parseTMDBTitle).filter((t): t is TMDBTitle => t !== null) : []
    }
    return result
  }

  /** TMDB's YouTube trailers of a movie or show (`movie:603`, `tv:1396`), in `language` first, best first. */
  async videos(item: string, language = 'ru'): Promise<TrailerVideo[]> {
    const json = await this.get('/v1/videos', { item, language })
    const list = isRecord(json) && Array.isArray(json.videos) ? json.videos : []
    return list.map(parseTrailerVideo).filter((v): v is TrailerVideo => v !== null)
  }

  /**
   * Names in `language` of catalog titles Plex has only in English, in the order asked
   * (at most `TMDBClient.titlesPerRequest`).
   */
  async titles(queries: TitleQuery[], language = 'ru-RU'): Promise<TitleName[]> {
    if (queries.length === 0) return []
    const pairs: [string, string][] = [['language', language], ...queries.map((q): [string, string] => ['item', titleParameter(q)])]
    const json = await this.get('/v1/titles', pairs)
    const items = isRecord(json) && Array.isArray(json.items) ? json.items : []
    return queries.map((_, i) => parseTitleName(items[i]))
  }

  static readonly titlesPerRequest = 60

  private async get(path: string, query: Record<string, string> | [string, string][]): Promise<unknown> {
    const url = joinURL(this.baseURL, path, query)
    if (this.now() < this.pausedUntil) throw new HTTPError(429, url)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (this.clientToken) headers['X-Client-Token'] = this.clientToken
    const response = await fetchWithTimeout(this.fetchFn, url, { headers }, this.timeoutMs)
    if (response.status === 429) {
      this.pausedUntil = this.now() + retryAfterMs(response.headers.get('Retry-After'))
      throw new HTTPError(429, url)
    }
    if (!response.ok) throw new HTTPError(response.status, url)
    return JSON.parse(await response.text())
  }
}

/** `Retry-After` in seconds or as a date; a minute when it says nothing usable. */
function retryAfterMs(value: string | null, now = Date.now()): number {
  const seconds = Number(value)
  if (value && Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 3600) * 1000
  const date = value ? Date.parse(value) : NaN
  if (Number.isFinite(date)) return Math.min(Math.max(date - now, 0), 3_600_000)
  return 60_000
}

/** A catalog title to name in another language (`/v1/titles`). */
export interface TitleQuery {
  kind: 'movie' | 'tv'
  year?: number
  tmdbId?: number
  /** As Plex has it (English). */
  title: string
}

/** `movie:2026:0:Soulm8te`: year and id 0 when unknown; the title may hold `:`. */
export function titleParameter(q: TitleQuery): string {
  return `${q.kind}:${q.year ?? 0}:${q.tmdbId ?? 0}:${q.title}`
}

/** The proxy's answer for one `TitleQuery`. */
export interface TitleName {
  tmdbId?: number
  /** Missing: TMDB has no name in the language, or the title wasn't found for sure. */
  title?: string
  /** TMDB didn't answer for this one: ask again later. */
  failed: boolean
}

function parseTitleName(raw: unknown): TitleName {
  // A missing item (a shorter answer) is one to ask again.
  if (!isRecord(raw)) return { failed: true }
  return { tmdbId: lossyInt(raw.tmdbId), title: lossyString(raw.title) || undefined, failed: raw.failed === true }
}

/** A trailer or teaser on YouTube (`/v1/videos`). */
export interface TrailerVideo {
  /** The YouTube video id. */
  key: string
  name: string
  type: string
  /** ISO 639-1; empty when TMDB has none. */
  language: string
  official: boolean
}

function parseTrailerVideo(raw: unknown): TrailerVideo | null {
  if (!isRecord(raw)) return null
  const key = lossyString(raw.key)
  if (!key) return null
  return {
    key,
    name: lossyString(raw.name) ?? '',
    type: lossyString(raw.type) ?? 'Trailer',
    language: lossyString(raw.language) ?? '',
    official: raw.official === true,
  }
}

/** A YouTube video id: letters, digits, `_` and `-` (nothing that could change the embed URL). */
export function isYouTubeID(key: string): boolean {
  return /^[A-Za-z0-9_-]{1,32}$/.test(key)
}

/** The watch page, to open in YouTube or a new tab. */
export function trailerWatchURL(video: TrailerVideo): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(video.key)}`
}
