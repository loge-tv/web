import type { Segment } from './segment'

/**
 * User correction of detected boundaries for one show, in seconds (negative: earlier).
 * The start moves the moment a skip (or its countdown) happens, the end moves
 * where playback lands. Recaps and previews are not corrected.
 */
export interface SkipCorrection {
  introStart: number
  introEnd: number
  creditsStart: number
  creditsEnd: number
}

export type CorrectionField = keyof SkipCorrection

export const correctionFields: CorrectionField[] = ['introStart', 'introEnd', 'creditsStart', 'creditsEnd']

export const NO_CORRECTION: SkipCorrection = Object.freeze({ introStart: 0, introEnd: 0, creditsStart: 0, creditsEnd: 0 })

/** Allowed range, whole seconds. */
export const CORRECTION_RANGE = { min: -5, max: 5 } as const

function clamp(value: number): number {
  return Math.min(Math.max(value, CORRECTION_RANGE.min), CORRECTION_RANGE.max)
}

export function correction(fields: Partial<SkipCorrection> = {}): SkipCorrection {
  return { ...NO_CORRECTION, ...fields }
}

export function isZeroCorrection(c: SkipCorrection): boolean {
  return correctionFields.every((f) => c[f] === 0)
}

export function correctionsEqual(a: SkipCorrection, b: SkipCorrection): boolean {
  return correctionFields.every((f) => a[f] === b[f])
}

/** Moves one boundary by `delta`, kept within the range. */
export function adjustCorrection(c: SkipCorrection, field: CorrectionField, delta: number): SkipCorrection {
  return { ...c, [field]: clamp(c[field] + delta) }
}

/** Lenient: missing or broken fields are 0, values are kept within the range. */
export function decodeCorrection(raw: unknown): SkipCorrection {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const value = (key: CorrectionField) => {
    const v = r[key]
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v) : 0
  }
  return {
    introStart: value('introStart'),
    introEnd: value('introEnd'),
    creditsStart: value('creditsStart'),
    creditsEnd: value('creditsEnd'),
  }
}

/** The corrected segment, or null when it collapses to less than a second. */
export function applyCorrectionTo(c: SkipCorrection, segment: Segment, duration: number | undefined): Segment | null {
  let startShift: number
  let endShift: number
  switch (segment.type) {
    case 'intro':
      ;[startShift, endShift] = [c.introStart, c.introEnd]
      break
    case 'credits':
      ;[startShift, endShift] = [c.creditsStart, c.creditsEnd]
      break
    default:
      return segment
  }
  let start = Math.max(0, segment.start + startShift)
  let end = segment.end + endShift
  if (duration !== undefined && duration > 0) {
    end = Math.min(end, duration)
    start = Math.min(start, duration)
  }
  if (end - start < 1) return null
  return { type: segment.type, start, end }
}

/** Shifts boundaries, keeps them inside the file and drops segments that collapse. */
export function applyCorrection(c: SkipCorrection, segments: Segment[], duration: number | undefined): Segment[] {
  return segments.map((s) => applyCorrectionTo(c, s, duration)).filter((s): s is Segment => s !== null)
}
