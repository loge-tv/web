import type { PlexItem } from './plexModels'

export type PlaybackState = 'playing' | 'paused' | 'stopped' | 'buffering'

export type ProgressReport = { kind: 'timeline'; state: PlaybackState; position: number } | { kind: 'scrobble' }

/** Decides when to send Plex timeline updates and when an item counts as watched. */
export class ProgressTracker {
  /** Plex itself treats 90% as watched. */
  static readonly watchedFraction = 0.9
  /** Seconds between periodic timeline reports. */
  static readonly interval = 10

  lastState: PlaybackState | undefined
  /** Milliseconds (Date.now()) of the last report. */
  lastReportAt: number | undefined
  scrobbled = false

  /** Start of final credits; reaching it marks the item watched. */
  constructor(public creditsStart?: number) {}

  isWatched(position: number, duration: number | undefined): boolean {
    if (this.creditsStart !== undefined && position >= this.creditsStart) return true
    if (duration === undefined || !(duration > 0)) return false
    return position / duration >= ProgressTracker.watchedFraction
  }

  /** Call on every tick and on state changes; returns what to send now. */
  update(state: PlaybackState, position: number, duration: number | undefined, now = Date.now()): ProgressReport[] {
    const reports: ProgressReport[] = []
    const stateChanged = state !== this.lastState
    const due = this.lastReportAt === undefined || (now - this.lastReportAt) / 1000 >= ProgressTracker.interval
    if (stateChanged || (due && state === 'playing')) {
      reports.push({ kind: 'timeline', state, position })
      this.lastState = state
      this.lastReportAt = now
    }
    if (!this.scrobbled && this.isWatched(position, duration)) {
      this.scrobbled = true
      reports.push({ kind: 'scrobble' })
    }
    return reports
  }
}

export const ResumePolicy = {
  /** Offsets shorter than this are not worth asking about. */
  minimumOffset: 30,

  /** Seconds to resume from, or undefined to start at the beginning without asking. */
  resumePosition(item: PlexItem): number | undefined {
    const offset = item.viewOffset
    if (offset === undefined || offset <= 0) return undefined
    const seconds = offset / 1000
    if (seconds < ResumePolicy.minimumOffset) return undefined
    if (item.duration !== undefined && item.duration > 0 && offset / item.duration >= ProgressTracker.watchedFraction) {
      return undefined
    }
    return seconds
  },
}

export const TimeFormat = {
  /** 75 → "1:15", 3725 → "1:02:05". */
  clock(seconds: number): string {
    if (!Number.isFinite(seconds)) return '0:00'
    const total = Math.max(0, Math.floor(seconds))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const pad = (n: number) => String(n).padStart(2, '0')
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
  },

  /** Duration in ms → "1 ч 52 мин" / "48 мин". */
  runtime(milliseconds: number | undefined): string | undefined {
    if (milliseconds === undefined || milliseconds <= 0) return undefined
    const minutes = Math.round(milliseconds / 60000)
    if (minutes >= 60) {
      const h = Math.floor(minutes / 60)
      const m = minutes % 60
      return m === 0 ? `${h} ч` : `${h} ч ${m} мин`
    }
    return `${Math.max(1, minutes)} мин`
  },
}
