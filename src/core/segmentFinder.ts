import { ChapterSegments } from './chapterSegments'
import type { DetectorClient } from './detectorClient'
import type { PlexItem } from './plexModels'
import type { Segment, SegmentType } from './segment'
import { TheIntroDBClient } from './theIntroDB'

export type SegmentSource = 'server' | 'chapters' | 'theIntroDB'

/** Skip segments of an item and where they came from. */
export interface FoundSegments {
  segments: Segment[]
  /**
   * `['server']` when Sepia Server answered (even with nothing); otherwise the fallback
   * sources that gave something, possibly none.
   */
  sources: SegmentSource[]
}

export const FoundSegments = {
  fromServer(found: FoundSegments): boolean {
    return found.sources.length === 1 && found.sources[0] === 'server'
  },

  /** For the player's markup panel: where the markup comes from, undefined for Sepia Server. */
  note(found: FoundSegments): string | undefined {
    if (FoundSegments.fromServer(found)) return undefined
    const chapters = found.sources.includes('chapters')
    const theIntroDB = found.sources.includes('theIntroDB')
    if (chapters && theIntroDB) return 'из глав файла и TheIntroDB'
    if (chapters) return 'из глав файла'
    if (theIntroDB) return 'из TheIntroDB'
    return 'Sepia Server недоступен, а в главах файла и TheIntroDB разметки нет'
  },
}

/**
 * Remembers for a few minutes that Sepia Server couldn't be asked, so that the next
 * episodes don't wait for its timeout before the fallback.
 */
export class ServerAvailability {
  static readonly shared = new ServerAvailability()

  private downUntil = new Map<string, number>()

  constructor(
    private readonly retryAfterMs = 300_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  isDown(url: string): boolean {
    const until = this.downUntil.get(url)
    return until !== undefined && this.now() < until
  }

  markDown(url: string) {
    this.downUntil.set(url, this.now() + this.retryAfterMs)
  }

  markUp(url: string) {
    this.downUntil.delete(url)
  }
}

export interface SegmentFinderOptions {
  detector: DetectorClient | null
  /** null turns TheIntroDB off. Default: the real TheIntroDB with the session cache. */
  theIntroDB?: TheIntroDBClient | null
  /** Default: shared by the whole app session. */
  availability?: ServerAvailability
  /** The show of an episode, for its TVDB/TMDB id. */
  show: (ratingKey: string) => Promise<PlexItem | undefined>
}

/**
 * Where the player gets skip segments: Sepia Server; when it can't be asked (down, refuses
 * the token, no server at all), the file's named chapters, and TheIntroDB for the types
 * the chapters don't have. Chapters win: they belong to this very file.
 * Port of SkipTVKit SegmentFinder.
 */
export class SegmentFinder {
  readonly detector: DetectorClient | null
  readonly theIntroDB: TheIntroDBClient | null
  readonly availability: ServerAvailability
  private readonly show: (ratingKey: string) => Promise<PlexItem | undefined>

  constructor(options: SegmentFinderOptions) {
    this.detector = options.detector
    this.theIntroDB = options.theIntroDB === undefined ? new TheIntroDBClient() : options.theIntroDB
    this.availability = options.availability ?? ServerAvailability.shared
    this.show = options.show
  }

  async find(item: PlexItem): Promise<FoundSegments> {
    const { detector, availability } = this
    if (detector && !availability.isDown(detector.baseURL)) {
      const segments = await detector.segmentsIfAvailable(item.ratingKey)
      if (segments !== null) {
        availability.markUp(detector.baseURL)
        return { segments, sources: ['server'] }
      }
      availability.markDown(detector.baseURL)
    }
    return this.fallback(item)
  }

  async fallback(item: PlexItem): Promise<FoundSegments> {
    if (item.type !== 'movie' && item.type !== 'episode') return { segments: [], sources: [] }
    const isMovie = item.type === 'movie'
    const duration = item.duration !== undefined && item.duration > 0 ? item.duration / 1000 : undefined
    let segments = ChapterSegments.segments(item.chapters, isMovie, duration)
    const sources: SegmentSource[] = segments.length === 0 ? [] : ['chapters']
    const covered = new Set<SegmentType>(segments.map((s) => s.type))
    const wanted: SegmentType[] = isMovie ? ['credits'] : ['intro', 'credits']
    const theIntroDB = this.theIntroDB
    if (!wanted.every((type) => covered.has(type)) && theIntroDB) {
      let show: PlexItem | undefined
      if (item.type === 'episode' && item.grandparentRatingKey) {
        try {
          show = await this.show(item.grandparentRatingKey)
        } catch {
          show = undefined
        }
      }
      const lookup = TheIntroDBClient.lookup(item, show)
      if (lookup) {
        const extra = (await theIntroDB.segments(lookup, isMovie, duration)).filter((s) => !covered.has(s.type))
        if (extra.length > 0) {
          segments = [...segments, ...extra]
          sources.push('theIntroDB')
        }
      }
    }
    return { segments: [...segments].sort((a, b) => a.start - b.start), sources }
  }
}
