import { FallbackSegments } from './chapterSegments'
import { fetchWithTimeout, isRecord, joinURL, lossyInt, type FetchFn } from './http'
import { externalID, type PlexItem } from './plexModels'
import type { Segment, SegmentType } from './segment'

export const DEFAULT_THEINTRODB_URL = 'https://api.theintrodb.org/v4'

/** What to ask TheIntroDB about one movie or episode. */
export interface TheIntroDBLookup {
  idName: 'tvdb_id' | 'tmdb_id' | 'imdb_id'
  id: string
  season?: number
  episode?: number
  /** The file's duration, to pick the matching release. */
  durationMs?: number
}

/** `{"start_ms":2655450,"end_ms":null}`; null and absent are both undefined. */
export interface TheIntroDBTimestamp {
  startMs?: number
  endMs?: number
}

/** `{"type":"tv","intro":[…],"recap":[…],"credits":[…],"preview":[…]}`; any array may be absent. */
export interface TheIntroDBMedia {
  intro?: TheIntroDBTimestamp[]
  recap?: TheIntroDBTimestamp[]
  credits?: TheIntroDBTimestamp[]
  preview?: TheIntroDBTimestamp[]
}

function parseTimestamps(raw: unknown): TheIntroDBTimestamp[] | undefined {
  // Like the Swift decoder: an array with anything but objects in it counts as absent.
  if (!Array.isArray(raw) || !raw.every(isRecord)) return undefined
  return raw.map((entry) => ({ startMs: lossyInt(entry.start_ms), endMs: lossyInt(entry.end_ms) }))
}

/** null when the answer isn't a JSON object. */
export function parseTheIntroDBMedia(raw: unknown): TheIntroDBMedia | null {
  if (!isRecord(raw)) return null
  return {
    intro: parseTimestamps(raw.intro),
    recap: parseTimestamps(raw.recap),
    credits: parseTimestamps(raw.credits),
    preview: parseTimestamps(raw.preview),
  }
}

/** Answers of TheIntroDB for the app session, by request URL. */
export class TheIntroDBCache {
  static readonly shared = new TheIntroDBCache()

  private entries = new Map<string, Segment[]>()

  constructor(private readonly limit = 300) {}

  segments(url: string): Segment[] | undefined {
    return this.entries.get(url)
  }

  store(segments: Segment[], url: string) {
    if (!this.entries.has(url) && this.entries.size >= this.limit) {
      // Map keeps insertion order: the first key is the oldest.
      const oldest = this.entries.keys().next()
      if (!oldest.done) this.entries.delete(oldest.value)
    }
    this.entries.set(url, segments)
  }
}

const digits = /^[0-9]+$/
const imdbID = /^tt[0-9]+$/

/**
 * TheIntroDB (theintrodb.org): a community database of intro, recap, credits and preview
 * times, by the show's TVDB/TMDB/IMDb id plus season and episode. Used only without
 * Sepia Server. Anonymous reads: 30 requests per 10 s and 5,000 a day per IP address.
 *
 * `GET https://api.theintrodb.org/v4/media?tvdb_id=415239&season=4&episode=1&duration_ms=2932576`
 * → `{"tvdb_id":415239,"type":"tv","season":4,"episode":1,"credits":[{"start_ms":2655450,"end_ms":null}]}`;
 * 404 when it knows nothing. Times are milliseconds; a missing start is the start of the
 * file, a missing end its end. `duration_ms` picks the closest release.
 *
 * The request is a "simple" CORS GET of its own: only `Accept`, no Plex token, no
 * `X-Plex-*` headers, no credentials. TheIntroDB echoes the Origin.
 */
export class TheIntroDBClient {
  constructor(
    readonly baseURL: string = DEFAULT_THEINTRODB_URL,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
    readonly timeoutMs = 4000,
    private readonly cache: TheIntroDBCache = TheIntroDBCache.shared,
  ) {}

  /**
   * The lookup for a movie (its own ids) or an episode (the show's ids, Plex's season and
   * episode numbers); null without a usable id. TVDB first, like TheIntroDB itself: TMDB
   * and IMDb ids are mapped to TVDB on its side.
   */
  static lookup(item: PlexItem, show: PlexItem | undefined): TheIntroDBLookup | null {
    let owner: PlexItem
    let season: number | undefined
    let episode: number | undefined
    switch (item.type) {
      case 'movie':
        owner = item
        break
      case 'episode': {
        const s = item.parentIndex
        const e = item.index
        if (!show || s === undefined || e === undefined || s < 0 || e < 1) return null
        owner = show
        season = s
        episode = e
        break
      }
      default:
        return null
    }
    const durationMs = item.duration !== undefined && item.duration > 0 ? item.duration : undefined
    const tvdb = externalID(owner, 'tvdb')
    if (tvdb !== undefined && digits.test(tvdb)) return { idName: 'tvdb_id', id: tvdb, season, episode, durationMs }
    const tmdb = externalID(owner, 'tmdb')
    if (tmdb !== undefined && digits.test(tmdb)) return { idName: 'tmdb_id', id: tmdb, season, episode, durationMs }
    const imdb = externalID(owner, 'imdb')
    if (imdb !== undefined && imdbID.test(imdb)) return { idName: 'imdb_id', id: imdb, season, episode, durationMs }
    return null
  }

  url(lookup: TheIntroDBLookup): string {
    const query: [string, string][] = [[lookup.idName, lookup.id]]
    if (lookup.season !== undefined) query.push(['season', String(lookup.season)])
    if (lookup.episode !== undefined) query.push(['episode', String(lookup.episode)])
    if (lookup.durationMs !== undefined) query.push(['duration_ms', String(lookup.durationMs)])
    return joinURL(this.baseURL, '/media', query)
  }

  /**
   * Segments for this file after `FallbackSegments.plausible`; [] when TheIntroDB knows
   * nothing, is unreachable or rate-limits us. Answers (404 included) are cached for the
   * app session, failures aren't.
   */
  async segments(lookup: TheIntroDBLookup, isMovie: boolean, duration: number | undefined): Promise<Segment[]> {
    const url = this.url(lookup)
    const cached = this.cache.segments(url)
    if (cached) return cached
    let found: Segment[]
    try {
      // A request of its own: no Plex token or X-Plex-* headers go to a third party.
      const response = await fetchWithTimeout(
        this.fetchFn,
        url,
        { headers: { Accept: 'application/json' }, credentials: 'omit' },
        this.timeoutMs,
      )
      if (response.ok) {
        let media: TheIntroDBMedia | null
        try {
          media = parseTheIntroDBMedia(JSON.parse(await response.text()))
        } catch {
          media = null
        }
        if (!media) return []
        found = FallbackSegments.plausible(TheIntroDBClient.segmentsOf(media, duration), isMovie, duration)
      } else if (response.status === 400 || response.status === 404) {
        found = []
      } else {
        return []
      }
    } catch {
      return []
    }
    this.cache.store(found, url)
    return found
  }

  /**
   * Seconds; drops entries that miss the bound their type needs (an intro needs its end,
   * credits their start) and the 0/0 TheIntroDB uses for "confirmed absent".
   */
  static segmentsOf(media: TheIntroDBMedia, duration: number | undefined): Segment[] {
    const result: Segment[] = []
    const add = (entries: TheIntroDBTimestamp[] | undefined, type: SegmentType) => {
      for (const entry of entries ?? []) {
        let start: number
        let end: number
        switch (type) {
          case 'intro':
          case 'recap':
            if (entry.endMs === undefined) continue
            start = (entry.startMs ?? 0) / 1000
            end = entry.endMs / 1000
            break
          case 'credits':
          case 'preview': {
            if (entry.startMs === undefined) continue
            start = entry.startMs / 1000
            const e = entry.endMs !== undefined ? entry.endMs / 1000 : duration
            if (e === undefined) continue
            end = e
            break
          }
        }
        if (!(end > start)) continue
        result.push({ type, start, end })
      }
    }
    add(media.intro, 'intro')
    add(media.recap, 'recap')
    add(media.credits, 'credits')
    add(media.preview, 'preview')
    return result
  }
}
