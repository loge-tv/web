import { fetchChecked, fetchJSON, fetchWithTimeout, joinURL, lossyInt, lossyString, type FetchFn, type Query } from './http'
import { jsonInit, plexParams, type PlexClientInfo } from './plexAccount'
import { parseMetadata, parseSections, sectionKind, type PlexItem, type PlexLibrarySection, type PlexPart } from './plexModels'
import type { PlaybackState } from './progressTracker'
import { parseHistory, type PlexHistoryEntry } from './recommendations'

/**
 * Plex's answer to a transcode decision. `code` (generalDecisionCode) 1000/1001: direct play or
 * conversion is possible; 2000 and up: refused (2013: outside home without Plex Pass).
 */
export interface TranscodeDecision {
  code?: number
  text?: string
}

export interface TranscodeOptions {
  item: PlexItem
  /** Transcode session id (also used to stop it). */
  session: string
  /** Seconds into the file. */
  offset: number
  /** Connection is on the server's LAN (no remote quality limits). */
  local: boolean
  /** Burn the part's selected subtitle stream into the video. */
  burnSubtitles: boolean
  mediaIndex?: number
  partIndex?: number
}

/** Plex Media Server API bound to one reachable base URL. All auth goes in the query. */
export class PlexServerAPI {
  constructor(
    readonly baseURL: string,
    readonly token: string,
    readonly client: PlexClientInfo,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
  ) {}

  /** Probes candidate URLs in parallel and returns the most preferred reachable one. */
  static async firstReachable(
    candidates: string[],
    token: string,
    client: PlexClientInfo,
    fetchFn: FetchFn = (input, init) => fetch(input, init),
    timeoutMs = 4000,
  ): Promise<string | undefined> {
    const probes = candidates.map(async (url) => {
      try {
        const response = await fetchWithTimeout(fetchFn, joinURL(url, '/identity', plexParams(client, token)), jsonInit, timeoutMs)
        return response.ok
      } catch {
        return false
      }
    })
    // In order of preference: answers as soon as the best reachable one is known,
    // without waiting for slower, less preferred addresses to time out.
    for (let i = 0; i < probes.length; i++) {
      if (await probes[i]) return candidates[i]
    }
    return undefined
  }

  /** Full URL of a server path with client params and the token. */
  url(path: string, query: Query = {}): string {
    const extra = Array.isArray(query) ? query : Object.entries(query)
    const pairs = [...extra, ...Object.entries(plexParams(this.client, this.token))] as [string, string | number | undefined | null][]
    return joinURL(
      this.baseURL,
      path,
      pairs
        .filter((p): p is [string, string | number] => p[1] !== undefined && p[1] !== null)
        .map(([k, v]): [string, string] => [k, String(v)]),
    )
  }

  private async metadata(path: string, query: Query = {}, signal?: AbortSignal): Promise<PlexItem[]> {
    return parseMetadata(await fetchJSON(this.fetchFn, this.url(path, query), { ...jsonInit, signal }))
  }

  async sections(): Promise<PlexLibrarySection[]> {
    return parseSections(await fetchJSON(this.fetchFn, this.url('/library/sections'), jsonInit))
  }

  /** All movies or shows of a library section, sorted by title. */
  async items(section: PlexLibrarySection, signal?: AbortSignal): Promise<PlexItem[]> {
    // Guids: TMDB ids for recommendations.
    const query: Record<string, string> = { sort: 'titleSort', includeGuids: '1' }
    const kind = sectionKind(section)
    if (kind === 'movie') query.type = '1'
    if (kind === 'show') query.type = '2'
    return this.metadata(`/library/sections/${section.key}/all`, query, signal)
  }

  /** "Continue watching": in-progress items and next episodes. */
  onDeck(): Promise<PlexItem[]> {
    return this.metadata('/library/onDeck')
  }

  recentlyAdded(section: PlexLibrarySection, limit = 30): Promise<PlexItem[]> {
    return this.metadata(`/library/sections/${section.key}/recentlyAdded`, {
      'X-Plex-Container-Start': '0',
      'X-Plex-Container-Size': String(limit),
    })
  }

  /** Several items in one request (`/library/metadata/1,2,3`). */
  async itemsByKeys(ratingKeys: string[], signal?: AbortSignal): Promise<PlexItem[]> {
    if (ratingKeys.length === 0) return []
    return this.metadata(`/library/metadata/${ratingKeys.map(encodeURIComponent).join(',')}`, {}, signal)
  }

  /**
   * Full item with media parts, streams, its other ids (`Guid`: TMDB for trailers, TVDB/TMDB/IMDb
   * for TheIntroDB) and chapters (skip segments without Sepia Server).
   */
  async item(ratingKey: string, signal?: AbortSignal): Promise<PlexItem | undefined> {
    return (await this.metadata(`/library/metadata/${ratingKey}`, { includeGuids: '1', includeChapters: '1' }, signal))[0]
  }

  /** Plays, newest first. The server's owner sees everyone's: `accountID` 1 is the owner. */
  async history(accountID?: number, limit = 200): Promise<PlexHistoryEntry[]> {
    const query: Record<string, string> = {
      sort: 'viewedAt:desc',
      'X-Plex-Container-Start': '0',
      'X-Plex-Container-Size': String(limit),
    }
    if (accountID !== undefined) query.accountID = String(accountID)
    return parseHistory(await fetchJSON(this.fetchFn, this.url('/status/sessions/history/all', query), jsonInit))
  }

  /**
   * Deletes a movie, show, season or episode with its files. The server allows it only to its
   * owner with «Allow media deletion» on (Settings → Library); otherwise 401/403. A whole show
   * takes the server a while: up to 3 minutes before it counts as a lost connection.
   */
  async delete(ratingKey: string) {
    await fetchChecked(this.fetchFn, this.url(`/library/metadata/${encodeURIComponent(ratingKey)}`), { ...jsonInit, method: 'DELETE' }, 180_000)
  }

  /** Seasons of a show or episodes of a season. */
  children(ratingKey: string, signal?: AbortSignal): Promise<PlexItem[]> {
    return this.metadata(`/library/metadata/${ratingKey}/children`, {}, signal)
  }

  /** All episodes of a show in order. */
  allEpisodes(showRatingKey: string, signal?: AbortSignal): Promise<PlexItem[]> {
    return this.metadata(`/library/metadata/${showRatingKey}/allLeaves`, {}, signal)
  }

  // MARK: Watch state

  timelineURL(item: PlexItem, state: PlaybackState, position: number, duration: number | undefined, session?: string): string {
    const query: Record<string, string> = {
      ratingKey: item.ratingKey,
      key: item.key,
      state,
      time: String(Math.trunc(position * 1000)),
      hasMDE: '1',
    }
    if (duration !== undefined && duration > 0) query.duration = String(Math.trunc(duration * 1000))
    if (session) query['X-Plex-Session-Identifier'] = session
    return this.url('/:/timeline', query)
  }

  /** Reports playback progress so other Plex clients see "continue watching". */
  async reportTimeline(item: PlexItem, state: PlaybackState, position: number, duration?: number, session?: string, keepalive = false) {
    await fetchChecked(this.fetchFn, this.timelineURL(item, state, position, duration, session), { ...jsonInit, keepalive })
  }

  async markWatched(ratingKey: string) {
    await fetchChecked(this.fetchFn, this.url('/:/scrobble', { identifier: 'com.plexapp.plugins.library', key: ratingKey }), jsonInit)
  }

  async markUnwatched(ratingKey: string) {
    await fetchChecked(this.fetchFn, this.url('/:/unscrobble', { identifier: 'com.plexapp.plugins.library', key: ratingKey }), jsonInit)
  }

  /** Selects the streams the transcoder uses (and other Plex clients start with). */
  async selectStreams(part: PlexPart, streams: { audioStreamID?: number; subtitleStreamID?: number }) {
    const query: Record<string, string> = { allParts: '1' }
    if (streams.audioStreamID !== undefined) query.audioStreamID = String(streams.audioStreamID)
    if (streams.subtitleStreamID !== undefined) query.subtitleStreamID = String(streams.subtitleStreamID)
    await fetchChecked(this.fetchFn, this.url(`/library/parts/${part.id}`, query), { ...jsonInit, method: 'PUT' })
  }

  // MARK: URLs

  /** Resized image through the server's photo transcoder. */
  imageURL(path: string | undefined, width: number, height: number): string | undefined {
    if (!path) return undefined
    if (path.startsWith('http')) return path
    return joinURL(this.baseURL, '/photo/:/transcode', {
      width: String(width),
      height: String(height),
      minSize: '1',
      upscale: '1',
      url: path,
      'X-Plex-Token': this.token,
    })
  }

  /** Original file for direct play (no transcoding). */
  directPlayURL(part: PlexPart): string {
    return this.resourceURL(part.key)
  }

  /** Any server path with the token attached (files, sidecar subtitles). */
  resourceURL(path: string): string {
    return joinURL(this.baseURL, path, { 'X-Plex-Token': this.token })
  }

  /** Text of a subtitle stream (sidecar file). */
  subtitleURL(streamId: number): string {
    return this.resourceURL(`/library/streams/${streamId}`)
  }

  /** Preview thumbnails of a part (BIF), when its `indexes` contains "sd". */
  bifURL(part: PlexPart): string | undefined {
    if (!(part.indexes ?? '').split(',').includes('sd')) return undefined
    return this.resourceURL(`/library/parts/${part.id}/indexes/sd`)
  }

  /**
   * Universal transcoder as HLS. As close to the original as Plex allows: video is copied
   * when the browser profile supports it (direct stream), audio converted only if needed.
   */
  transcodeURL(o: TranscodeOptions): string {
    return this.url('/video/:/transcode/universal/start.m3u8', this.transcodeQuery(o))
  }

  /** Same parameters as `transcodeURL`: what the server would do. */
  decisionURL(o: TranscodeOptions): string {
    return this.url('/video/:/transcode/universal/decision', this.transcodeQuery(o))
  }

  /**
   * What the server will do with these options. Plex 1.43 refuses (400) some starts of a
   * session it hasn't decided on, so ask this before loading `transcodeURL`.
   */
  async transcodeDecision(o: TranscodeOptions): Promise<TranscodeDecision> {
    const json = await fetchJSON<{ MediaContainer?: Record<string, unknown> }>(this.fetchFn, this.decisionURL(o), jsonInit)
    const container = json.MediaContainer ?? {}
    return { code: lossyInt(container.generalDecisionCode), text: lossyString(container.generalDecisionText) }
  }

  transcodeQuery(o: TranscodeOptions): [string, string][] {
    return [
      ['hasMDE', '1'],
      ['path', `/library/metadata/${o.item.ratingKey}`],
      ['mediaIndex', String(o.mediaIndex ?? 0)],
      ['partIndex', String(o.partIndex ?? 0)],
      ['protocol', 'hls'],
      ['fastSeek', '1'],
      ['copyts', '1'],
      ['offset', String(Math.max(0, Math.floor(o.offset)))],
      ['directPlay', '0'],
      ['directStream', '1'],
      ['directStreamAudio', '1'],
      ['videoQuality', '100'],
      ['subtitleSize', '100'],
      ['audioBoost', '100'],
      ['autoAdjustQuality', '0'],
      ['location', o.local ? 'lan' : 'wan'],
      ['subtitles', o.burnSubtitles ? 'burn' : 'none'],
      ['session', o.session],
      ['X-Plex-Session-Identifier', o.session],
      ['X-Plex-Client-Profile-Extra', PlexServerAPI.hlsProfileExtra],
    ]
  }

  /**
   * What a browser plays through hls.js / Safari: H.264 + AAC in MPEG-TS. H.264 sources
   * are copied (direct stream), everything else is converted.
   */
  static readonly hlsProfileExtra =
    'add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&videoCodec=h264&audioCodec=aac,mp3&replace=true)'

  async stopTranscode(session: string) {
    await fetchChecked(this.fetchFn, this.url('/video/:/transcode/universal/stop', { session }), { ...jsonInit, keepalive: true })
  }
}
