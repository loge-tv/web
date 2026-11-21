export type SegmentType = 'intro' | 'credits' | 'recap' | 'preview'

export const segmentTypes: SegmentType[] = ['intro', 'credits', 'recap', 'preview']

/** A detected part of a media file; times are seconds from the file start. */
export interface Segment {
  type: SegmentType
  start: number
  end: number
}

export function segmentContains(segment: Segment, time: number): boolean {
  return time >= segment.start && time < segment.end
}

export function segmentLength(segment: Segment): number {
  return segment.end - segment.start
}

/** Value identity of a segment (for maps keyed by segment). */
export function segmentKey(segment: Segment): string {
  return `${segment.type}|${segment.start}|${segment.end}`
}

/** Unknown types and broken values are dropped, not fatal. */
export function parseSegment(raw: unknown): Segment | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const type = segmentTypes.find((t) => t === r.type)
  if (!type || typeof r.start !== 'number' || typeof r.end !== 'number') return null
  return { type, start: r.start, end: r.end }
}

/** Drops broken segments and sorts by start time. */
export function sanitizeSegments(segments: Segment[]): Segment[] {
  return segments
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start)
    .sort((a, b) => a.start - b.start)
}
