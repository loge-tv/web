import { fetchChecked, fetchJSON, fetchWithTimeout, isRecord, joinURL, lossyString, strictEncode, type FetchFn } from './http'
import { parseSegment, sanitizeSegments, type Segment } from './segment'
import type { PlexPart } from './plexModels'
import { decodePreferences, preferencesBody, type PreferencesRemote, type ShowPreferences } from './showPreferences'

interface SegmentsResponse {
  ratingKey: string
  segments: Segment[]
  analyzed: boolean
}

function parseSegmentsResponse(raw: unknown): SegmentsResponse | null {
  if (!isRecord(raw)) return null
  return {
    ratingKey: lossyString(raw.ratingKey) ?? '',
    analyzed: raw.analyzed === true,
    // Unknown segment types from a newer detector are dropped, not fatal.
    segments: Array.isArray(raw.segments) ? raw.segments.map(parseSegment).filter((s): s is Segment => s !== null) : [],
  }
}

/**
 * Client of Loge Server (the detector): segments, files and show preferences. TMDB (titles,
 * trailers, recommendations) is the proxy's, `TMDBClient`, Loge Server or not. Segment lookups
 * never throw: when the detector is down (or blocks the browser by CORS) or knows nothing about
 * the item, playback simply has no segments. Requests carry only `X-Plex-Token`, `Accept` and
 * `Content-Type`.
 */
export class DetectorClient implements PreferencesRemote {
  constructor(
    readonly baseURL: string,
    readonly token: string,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
    readonly timeoutMs = 4000,
  ) {}

  private init(extra: RequestInit = {}): RequestInit {
    return {
      ...extra,
      headers: { 'X-Plex-Token': this.token, Accept: 'application/json', ...(extra.headers ?? {}) },
    }
  }

  /**
   * The original file of a part, served by the detector from its own mount of the library.
   * Outside the home network Plex without Plex Pass refuses the file itself (403
   * "Downloading requires a Remote Watch Pass or Plex Pass"), the detector doesn't. A
   * `<video src>` can't send headers, so the token goes in the query (the detector takes it
   * there for files only). The file name only gives the extension.
   */
  fileURL(ratingKey: string, part: PlexPart): string | undefined {
    if (!part.id) return undefined
    const last = part.key.split('/').pop() ?? ''
    const dot = last.lastIndexOf('.')
    const ext = dot > 0 ? last.slice(dot + 1) : (part.container ?? 'bin')
    const path = `/v1/files/${strictEncode(ratingKey)}/${strictEncode(part.id)}/${strictEncode(`file.${ext}`)}`
    return joinURL(this.baseURL, path, { 'X-Plex-Token': this.token })
  }

  async segments(ratingKey: string): Promise<Segment[]> {
    return (await this.segmentsIfAvailable(ratingKey)) ?? []
  }

  /**
   * The item's segments, or null when the server can't be asked: down, refuses the token
   * (someone else's server), or isn't a Loge Server at all. An answer with no segments
   * (nothing found, not analysed yet) is `[]`, not null.
   */
  async segmentsIfAvailable(ratingKey: string): Promise<Segment[] | null> {
    try {
      const url = joinURL(this.baseURL, `/v1/segments/${strictEncode(ratingKey)}`)
      const response = parseSegmentsResponse(await fetchJSON(this.fetchFn, url, this.init(), this.timeoutMs))
      return response ? sanitizeSegments(response.segments) : null
    } catch {
      return null
    }
  }

  /** `{"items":[...]}` (what the detector serves) or a bare array. */
  async segmentsBatch(ratingKeys: string[]): Promise<Record<string, Segment[]>> {
    if (ratingKeys.length === 0) return {}
    try {
      const url = joinURL(this.baseURL, '/v1/segments', { ratingKeys: ratingKeys.join(',') })
      const json = await fetchJSON(this.fetchFn, url, this.init(), this.timeoutMs)
      const list = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.items) ? json.items : null
      if (!list) return {}
      const result: Record<string, Segment[]> = {}
      for (const raw of list) {
        const response = parseSegmentsResponse(raw)
        if (response) result[response.ratingKey] = sanitizeSegments(response.segments)
      }
      return result
    } catch {
      return {}
    }
  }

  // MARK: Per-show preferences

  /**
   * The detector's copy of one show's preferences; null when it has none.
   * Throws when the detector can't be asked (down, or too old for this endpoint).
   */
  async fetchPreferences(key: string): Promise<ShowPreferences | null> {
    const url = joinURL(this.baseURL, `/v1/preferences/${strictEncode(key)}`)
    const json = await fetchJSON(this.fetchFn, url, this.init(), this.timeoutMs)
    if (!isRecord(json)) throw new Error('unexpected preferences response')
    const preferences = json.preferences
    if (preferences === null || preferences === undefined) return null
    return decodePreferences(preferences)
  }

  /** Saves one show's preferences; empty ones delete the detector's copy. */
  async savePreferences(preferences: ShowPreferences, key: string): Promise<void> {
    const url = joinURL(this.baseURL, `/v1/preferences/${strictEncode(key)}`)
    await fetchChecked(
      this.fetchFn,
      url,
      this.init({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: preferencesBody(preferences) }),
      this.timeoutMs,
    )
  }

  /**
   * Whether this page can use Loge Server (the settings screen's status). It asks a /v1 route, not
   * `/healthz`: Loge Server sends CORS headers on /v1 only, so the browser hides `/healthz`'s
   * answer and a working server would read as down. A cheap one — the segments of a key nobody
   * has — that also needs the token taken and CORS in place, which every real request needs.
   */
  async isReachable(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(this.fetchFn, joinURL(this.baseURL, '/v1/segments/0'), this.init(), this.timeoutMs)
      return response.ok
    } catch {
      return false
    }
  }
}

/**
 * A usable Loge Server base URL from user input; empty when there is none. Loge Server is the
 * person's own server, so there is no default address.
 */
export function normalizeDetectorURL(input: string): string {
  const trimmed = input.trim()
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:' || url.protocol === 'https:') return trimmed.replace(/\/+$/, '')
  } catch {
    // fall through
  }
  return ''
}
