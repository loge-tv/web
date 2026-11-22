import { isRecord, lossyBool, lossyDouble, lossyInt, lossyString } from './http'

export type PlexItemType = 'movie' | 'show' | 'season' | 'episode' | 'clip' | 'other'

export interface PlexStream {
  id: string
  /** 1 video, 2 audio, 3 subtitle. */
  streamType: number
  index?: number
  codec?: string
  languageCode?: string
  /** Track title from the file, e.g. the dub studio ("LostFilm"). */
  title?: string
  /** Plex's own label, e.g. "Русский (AC3 5.1)". */
  displayTitle?: string
  /** Sidecar subtitle path (external SRT etc.), absent for embedded streams. */
  key?: string
  colorTrc?: string
  doviPresent: boolean
  channels?: number
  isDefault: boolean
  isForced: boolean
  selected: boolean
}

export interface PlexPart {
  id: string
  /** Server path of the file, e.g. `/library/parts/123/1699999999/file.mkv`. */
  key: string
  duration?: number
  size?: number
  container?: string
  /** "sd" when Plex generated preview thumbnails (BIF). */
  indexes?: string
  streams: PlexStream[]
}

export interface PlexMedia {
  id: string
  duration?: number
  container?: string
  videoCodec?: string
  videoResolution?: string
  videoProfile?: string
  audioCodec?: string
  audioChannels?: number
  parts: PlexPart[]
}

/** A Plex metadata item: movie, show, season or episode. */
export interface PlexItem {
  ratingKey: string
  key: string
  type: PlexItemType
  title: string
  /**
   * Plex catalog id (`plex://movie/5d77…`) with the modern agents; older agents give
   * `com.plexapp.agents.…` or nothing.
   */
  guid?: string
  /** Ids in other databases (`tmdb://38142`, `imdb://tt0983213`), asked with `includeGuids`. */
  guids?: string[]
  summary?: string
  year?: number
  index?: number
  parentIndex?: number
  parentRatingKey?: string
  parentTitle?: string
  grandparentRatingKey?: string
  grandparentTitle?: string
  thumb?: string
  art?: string
  parentThumb?: string
  grandparentThumb?: string
  grandparentArt?: string
  contentRating?: string
  audienceRating?: number
  originallyAvailableAt?: string
  /** Milliseconds. */
  duration?: number
  /** Milliseconds, present when partially watched. */
  viewOffset?: number
  viewCount?: number
  leafCount?: number
  viewedLeafCount?: number
  childCount?: number
  addedAt?: number
  /** Unix seconds of the last playback. */
  lastViewedAt?: number
  media: PlexMedia[]
}

export interface PlexLibrarySection {
  key: string
  title: string
  type: string
}

export type SectionKind = 'movie' | 'show' | 'artist' | 'photo' | 'other'

export function sectionKind(section: PlexLibrarySection): SectionKind {
  return (['movie', 'show', 'artist', 'photo'] as const).find((k) => k === section.type) ?? 'other'
}

const itemTypes: PlexItemType[] = ['movie', 'show', 'season', 'episode', 'clip']

function parseStream(raw: unknown): PlexStream | null {
  if (!isRecord(raw)) return null
  return {
    id: lossyString(raw.id) ?? '',
    streamType: lossyInt(raw.streamType) ?? 0,
    index: lossyInt(raw.index),
    codec: lossyString(raw.codec),
    languageCode: lossyString(raw.languageCode),
    title: lossyString(raw.title),
    displayTitle: lossyString(raw.displayTitle),
    key: lossyString(raw.key),
    colorTrc: lossyString(raw.colorTrc),
    doviPresent: (lossyInt(raw.DOVIPresent) ?? 0) !== 0,
    channels: lossyInt(raw.channels),
    isDefault: lossyBool(raw.default),
    isForced: lossyBool(raw.forced),
    selected: lossyBool(raw.selected),
  }
}

function parsePart(raw: unknown): PlexPart | null {
  if (!isRecord(raw)) return null
  return {
    id: lossyString(raw.id) ?? '',
    key: lossyString(raw.key) ?? '',
    duration: lossyInt(raw.duration),
    size: lossyInt(raw.size),
    container: lossyString(raw.container),
    indexes: lossyString(raw.indexes),
    streams: Array.isArray(raw.Stream) ? raw.Stream.map(parseStream).filter((s): s is PlexStream => s !== null) : [],
  }
}

function parseMedia(raw: unknown): PlexMedia | null {
  if (!isRecord(raw)) return null
  return {
    id: lossyString(raw.id) ?? '',
    duration: lossyInt(raw.duration),
    container: lossyString(raw.container),
    videoCodec: lossyString(raw.videoCodec),
    videoResolution: lossyString(raw.videoResolution),
    videoProfile: lossyString(raw.videoProfile),
    audioCodec: lossyString(raw.audioCodec),
    audioChannels: lossyInt(raw.audioChannels),
    parts: Array.isArray(raw.Part) ? raw.Part.map(parsePart).filter((p): p is PlexPart => p !== null) : [],
  }
}

/** `Guid: [{id: "tmdb://1"}, …]` → ids. */
export function parseGuids(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isRecord)
    .map((g) => lossyString(g.id))
    .filter((id): id is string => !!id)
}

/** TMDB id from `tmdb://…` guids (library items asked with `includeGuids`, catalog details). */
export function tmdbIDFromGuids(guids: string[] | undefined): number | undefined {
  for (const guid of guids ?? []) {
    if (!guid.startsWith('tmdb://')) continue
    const id = Number(guid.slice(7))
    if (Number.isInteger(id) && id > 0) return id
  }
  return undefined
}

/** TMDB id of a library item, when the library was asked with `includeGuids`. */
export function tmdbID(item: PlexItem): number | undefined {
  return tmdbIDFromGuids(item.guids)
}

export function parseItem(raw: unknown): PlexItem | null {
  if (!isRecord(raw)) return null
  const ratingKey = lossyString(raw.ratingKey) ?? ''
  const typeName = lossyString(raw.type) ?? ''
  return {
    ratingKey,
    key: lossyString(raw.key) ?? `/library/metadata/${ratingKey}`,
    type: itemTypes.find((t) => t === typeName) ?? 'other',
    title: lossyString(raw.title) ?? '',
    guid: lossyString(raw.guid),
    guids: parseGuids(raw.Guid),
    summary: lossyString(raw.summary),
    year: lossyInt(raw.year),
    index: lossyInt(raw.index),
    parentIndex: lossyInt(raw.parentIndex),
    parentRatingKey: lossyString(raw.parentRatingKey),
    parentTitle: lossyString(raw.parentTitle),
    grandparentRatingKey: lossyString(raw.grandparentRatingKey),
    grandparentTitle: lossyString(raw.grandparentTitle),
    thumb: lossyString(raw.thumb),
    art: lossyString(raw.art),
    parentThumb: lossyString(raw.parentThumb),
    grandparentThumb: lossyString(raw.grandparentThumb),
    grandparentArt: lossyString(raw.grandparentArt),
    contentRating: lossyString(raw.contentRating),
    audienceRating: lossyDouble(raw.audienceRating),
    originallyAvailableAt: lossyString(raw.originallyAvailableAt),
    duration: lossyInt(raw.duration),
    viewOffset: lossyInt(raw.viewOffset),
    viewCount: lossyInt(raw.viewCount),
    leafCount: lossyInt(raw.leafCount),
    viewedLeafCount: lossyInt(raw.viewedLeafCount),
    childCount: lossyInt(raw.childCount),
    addedAt: lossyInt(raw.addedAt),
    lastViewedAt: lossyInt(raw.lastViewedAt),
    media: Array.isArray(raw.Media) ? raw.Media.map(parseMedia).filter((m): m is PlexMedia => m !== null) : [],
  }
}

function container(json: unknown): Record<string, unknown> {
  if (isRecord(json) && isRecord(json.MediaContainer)) return json.MediaContainer
  throw new Error('Неожиданный ответ сервера Plex')
}

/** `{"MediaContainer":{"Metadata":[…]}}` → items. */
export function parseMetadata(json: unknown): PlexItem[] {
  const c = container(json)
  if (!Array.isArray(c.Metadata)) return []
  return c.Metadata.map(parseItem).filter((i): i is PlexItem => i !== null)
}

/** `{"MediaContainer":{"Directory":[…]}}` → library sections. */
export function parseSections(json: unknown): PlexLibrarySection[] {
  const c = container(json)
  if (!Array.isArray(c.Directory)) return []
  return c.Directory.filter(isRecord).map((d) => ({
    key: lossyString(d.key) ?? '',
    title: lossyString(d.title) ?? '',
    type: lossyString(d.type) ?? '',
  }))
}

/** A minimal item for tests and synthetic cards. */
export function makeItem(fields: Partial<PlexItem> & { ratingKey: string; type: PlexItemType }): PlexItem {
  return {
    key: `/library/metadata/${fields.ratingKey}`,
    title: '',
    media: [],
    ...fields,
  }
}

// MARK: Derived

export function isWatched(item: PlexItem): boolean {
  switch (item.type) {
    case 'show':
    case 'season':
      if (item.leafCount !== undefined && item.viewedLeafCount !== undefined && item.leafCount > 0) {
        return item.viewedLeafCount >= item.leafCount
      }
      return false
    default:
      return (item.viewCount ?? 0) > 0 && (item.viewOffset ?? 0) === 0
  }
}

/** 0…1 progress of a partially watched item, undefined when not started. */
export function progress(item: PlexItem): number | undefined {
  const { viewOffset, duration } = item
  if (viewOffset === undefined || duration === undefined || duration <= 0 || viewOffset <= 0) return undefined
  return Math.min(1, viewOffset / duration)
}

export function unwatchedLeafCount(item: PlexItem): number | undefined {
  if (item.leafCount === undefined) return undefined
  return Math.max(0, item.leafCount - (item.viewedLeafCount ?? 0))
}

/** First playable file part. */
export function primaryPart(item: PlexItem): PlexPart | undefined {
  return item.media[0]?.parts[0]
}

/** "S1 · E3" style label for episodes. */
export function episodeLabel(item: PlexItem): string | undefined {
  if (item.type !== 'episode') return undefined
  if (item.parentIndex !== undefined && item.index !== undefined) return `S${item.parentIndex} · E${item.index}`
  if (item.index !== undefined) return `E${item.index}`
  return undefined
}

/** Poster image: show poster for episodes/seasons when they have no own. */
export function posterPath(item: PlexItem): string | undefined {
  switch (item.type) {
    case 'episode':
      return item.grandparentThumb ?? item.parentThumb ?? item.thumb
    case 'season':
      return item.thumb ?? item.parentThumb
    default:
      return item.thumb
  }
}

/** Landscape image: episode still, or backdrop for everything else. */
export function landscapePath(item: PlexItem): string | undefined {
  if (item.type === 'episode') return item.thumb ?? item.art ?? item.grandparentArt
  return item.art ?? item.thumb
}

export function backdropPath(item: PlexItem): string | undefined {
  return item.art ?? item.grandparentArt ?? item.thumb
}

/**
 * Key of the same title in Plex's online catalog (Discover, Watchlist): the tail of a
 * `plex://movie/…` or `plex://show/…` guid. Undefined for items matched by older agents.
 */
export function catalogKey(item: PlexItem): string | undefined {
  const guid = item.guid
  if (!guid || !(guid.startsWith('plex://movie/') || guid.startsWith('plex://show/'))) return undefined
  return guid.split('/').pop() || undefined
}

/** The show this item belongs to (for episodes and seasons) or itself. */
export function showRatingKey(item: PlexItem): string | undefined {
  switch (item.type) {
    case 'show':
      return item.ratingKey
    case 'season':
      return item.parentRatingKey
    case 'episode':
      return item.grandparentRatingKey
    default:
      return undefined
  }
}

export function displayTitle(item: PlexItem): string {
  switch (item.type) {
    case 'episode':
      return item.grandparentTitle ?? item.title
    case 'season':
      return item.parentTitle ?? item.title
    default:
      return item.title
  }
}

export function displaySubtitle(item: PlexItem): string | undefined {
  switch (item.type) {
    case 'episode':
      return [episodeLabel(item), item.title].filter((s): s is string => !!s).join(' — ')
    case 'season':
      return item.title
    default:
      return item.year !== undefined ? String(item.year) : undefined
  }
}

/** "DOLBY VISION", "HDR" or undefined, from the video stream. */
export function dynamicRangeBadge(media: PlexMedia): string | undefined {
  const video = media.parts[0]?.streams.find((s) => s.streamType === 1)
  if (!video) return undefined
  if (video.doviPresent) return 'DOLBY VISION'
  switch (video.colorTrc?.toLowerCase()) {
    case 'smpte2084':
    case 'arib-std-b67':
      return 'HDR'
    default:
      return undefined
  }
}

// MARK: Home

const inProgress = (item: PlexItem) => (item.viewOffset ?? 0) > 0

/**
 * "Continue watching" (port of SkipTVKit HomeOrdering) as one list by recency, most recent
 * first: an item in progress counts from when it was last watched, the next episode of a
 * started show from when the show was last watched (`showLastViewed`, the shows'
 * `lastViewedAt`: the next episode itself was never played; without it the item's own
 * `lastViewedAt`). Half-watched items get no priority over next-up ones. Items without a time
 * go last; ties keep the server's order.
 */
export function orderContinueWatching(items: PlexItem[], showLastViewed: Record<string, number> = {}): PlexItem[] {
  const lastWatched = (item: PlexItem) =>
    (inProgress(item)
      ? item.lastViewedAt
      : (item.grandparentRatingKey && showLastViewed[item.grandparentRatingKey]) || item.lastViewedAt) ?? -Infinity
  return items
    .map((item, offset) => ({ item, offset, time: lastWatched(item) }))
    .sort((a, b) => (a.time !== b.time ? b.time - a.time : a.offset - b.offset))
    .map(({ item }) => item)
}

/** Shows whose `lastViewedAt` is needed to order the next-up episodes. */
export function showsToLookUp(items: PlexItem[]): string[] {
  const shows = new Set<string>()
  for (const item of items) {
    if (!inProgress(item) && item.type === 'episode' && item.grandparentRatingKey) shows.add(item.grandparentRatingKey)
  }
  return [...shows]
}

/** Recently added TV episodes become one card per show season. */
export function collapseRecentlyAdded(items: PlexItem[]): PlexItem[] {
  const seen = new Set<string>()
  const result: PlexItem[] = []
  for (const item of items) {
    const key = item.type === 'episode' ? (item.parentRatingKey ?? item.ratingKey) : item.ratingKey
    if (seen.has(key)) continue
    seen.add(key)
    if (item.type === 'episode' && item.parentRatingKey) {
      result.push({
        ...item,
        type: 'season',
        ratingKey: item.parentRatingKey,
        key: `/library/metadata/${item.parentRatingKey}/children`,
        title: item.parentTitle ?? `Сезон ${item.parentIndex ?? 0}`,
        thumb: item.parentThumb ?? item.grandparentThumb,
        parentRatingKey: item.grandparentRatingKey,
        parentTitle: item.grandparentTitle,
        index: item.parentIndex,
        viewCount: undefined,
        viewOffset: undefined,
        leafCount: undefined,
        viewedLeafCount: undefined,
      })
    } else {
      result.push(item)
    }
  }
  return result
}
