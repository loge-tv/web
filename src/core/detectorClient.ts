import { fetchChecked, fetchJSON, fetchWithTimeout, isRecord, joinURL, lossyString, strictEncode, type FetchFn } from './http'
import { parseSegment, sanitizeSegments, type Segment } from './segment'
import { decodePreferences, preferencesBody, type PreferencesRemote, type ShowPreferences } from './showPreferences'

export const DEFAULT_DETECTOR_URL = 'https://loge-server.example.com'

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
 * Client of the SkipTV detector service. Segment lookups never throw: when the detector
 * is down (or blocks the browser by CORS) or knows nothing about the item, playback simply
 * has no segments. Requests carry only `X-Plex-Token`, `Accept` and `Content-Type`.
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

  async segments(ratingKey: string): Promise<Segment[]> {
    try {
      const url = joinURL(this.baseURL, `/v1/segments/${strictEncode(ratingKey)}`)
      const response = parseSegmentsResponse(await fetchJSON(this.fetchFn, url, this.init(), this.timeoutMs))
      return sanitizeSegments(response?.segments ?? [])
    } catch {
      return []
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

  /** `/healthz` answers "ok" (used by the settings screen). */
  async isReachable(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(this.fetchFn, joinURL(this.baseURL, '/healthz'), {}, this.timeoutMs)
      return response.ok
    } catch {
      return false
    }
  }
}

/** A usable detector base URL from user input, or the default. */
export function normalizeDetectorURL(input: string): string {
  const trimmed = input.trim()
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:' || url.protocol === 'https:') return trimmed.replace(/\/+$/, '')
  } catch {
    // fall through
  }
  return DEFAULT_DETECTOR_URL
}
