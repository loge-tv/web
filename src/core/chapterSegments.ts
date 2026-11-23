import type { PlexChapter } from './plexModels'
import type { Segment, SegmentType } from './segment'

// Order matters only for readability: no name is in two lists.
const exactNames: [SegmentType, Set<string>][] = [
  [
    'intro',
    new Set([
      'intro',
      'opening',
      'op',
      'opening credits',
      'opening titles',
      'opening theme',
      'main titles',
      'main title',
      'title sequence',
      'заставка',
      'вступление',
      'начальные титры',
    ]),
  ],
  [
    'credits',
    new Set([
      'credits',
      'end credits',
      'ending credits',
      'closing credits',
      'end titles',
      'end title',
      'closing titles',
      'ending',
      'ed',
      'титры',
      'финальные титры',
      'конечные титры',
      'заключительные титры',
    ]),
  ],
  ['recap', new Set(['recap', 'previously', 'previously on', 'ранее', 'ранее в сериале', 'в предыдущих сериях'])],
  ['preview', new Set(['preview', 'next episode', 'next time', 'coming up', 'анонс', 'в следующей серии'])],
]

/**
 * Names that go on after a separator: "End titles/Somewhere in My Memory", "Previously on Lost".
 * Not after a plain space: "End credits scene" is the scene after them.
 */
const prefixNames: [SegmentType, string[]][] = [
  ['intro', ['opening credits/', 'opening credits:', 'opening credits -', 'opening titles/', 'main titles/']],
  [
    'credits',
    ['end credits/', 'end credits:', 'end credits -', 'end titles/', 'end titles:', 'end titles -', 'closing credits/', 'closing credits:', 'титры:', 'титры /'],
  ],
  ['recap', ['previously on ', 'previously:', 'ранее в сериале ', 'в предыдущих сериях:']],
  ['preview', ['next time on ', 'next on ', 'next episode:', 'в следующей серии:']],
]

/**
 * Skip segments from the file's own chapters, when they are named like "Intro", "Credits",
 * "Recap" or "Preview" (WEB-DL and Blu-ray releases often have "Credits"; anime has
 * "Opening"/"Ending"). Used only without Loge Server. Port of SkipTVKit ChapterSegments.
 */
export const ChapterSegments = {
  /**
   * Segments of the named chapters, after `FallbackSegments.plausible`.
   * `duration` is the file's, in seconds; a chapter without an end runs to the next one.
   */
  segments(chapters: PlexChapter[], isMovie: boolean, duration: number | undefined): Segment[] {
    const sorted = [...chapters].sort((a, b) => a.start - b.start)
    const found: Segment[] = []
    sorted.forEach((chapter, i) => {
      const type = ChapterSegments.type(chapter.tag)
      if (!type) return
      const end = chapter.end ?? sorted[i + 1]?.start ?? duration
      if (end === undefined) return
      found.push({ type, start: chapter.start, end })
    })
    return FallbackSegments.plausible(found, isMovie, duration)
  },

  /**
   * The segment type a chapter name stands for, undefined for an ordinary chapter.
   * "Post-credits" or "Ending scene" are not credits: one-word names must match whole.
   */
  type(tag: string | undefined): SegmentType | undefined {
    if (tag === undefined) return undefined
    const name = ChapterSegments.normalize(tag)
    if (name === '') return undefined
    for (const [type, names] of exactNames) if (names.has(name)) return type
    for (const [type, prefixes] of prefixNames) if (prefixes.some((prefix) => name.startsWith(prefix))) return type
    return undefined
  },

  /**
   * Lowercased, "ё" → "е", one space between words, no trailing dots or digits
   * ("Credits 2" → "credits").
   */
  normalize(tag: string): string {
    const name = tag
      .toLowerCase()
      .replace(/ё/g, 'е')
      .split(/\s+/)
      .filter((word) => word !== '')
      .join(' ')
    return name.replace(/[. \p{N}]+$/u, '')
  },
}

/**
 * Checks shared by the sources used without Loge Server (chapters, TheIntroDB): both can
 * belong to another release of the episode or to another episode altogether.
 */
export const FallbackSegments = {
  /**
   * Clamped to the file and sorted; drops what can't be right for this file:
   * - an empty or inverted range, or one that starts after the end of the file;
   * - intro or recap that starts in the second half, credits or preview in the first;
   * - anything but credits in a movie (opening titles of a film are part of the film).
   */
  plausible(segments: Segment[], isMovie: boolean, duration: number | undefined): Segment[] {
    return segments
      .flatMap((segment): Segment[] => {
        if (isMovie && segment.type !== 'credits') return []
        let start = Math.max(0, segment.start)
        let end = segment.end
        if (!Number.isFinite(start) || !Number.isFinite(end)) return []
        if (duration !== undefined && duration > 0) {
          end = Math.min(end, duration)
          if (!(start < duration - 1)) return []
          const firstHalf = start < duration / 2
          switch (segment.type) {
            case 'intro':
            case 'recap':
              if (!firstHalf) return []
              break
            case 'credits':
            case 'preview':
              if (firstHalf) return []
              break
          }
        }
        start = Math.min(start, end)
        if (!(end - start >= 1)) return []
        return [{ type: segment.type, start, end }]
      })
      .sort((a, b) => a.start - b.start)
  },
}
