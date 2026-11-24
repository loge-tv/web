import type { PlexItem } from './plexModels'
import { sanitizeSegments, segmentContains, segmentKey, type Segment } from './segment'
import { applyCorrectionTo, NO_CORRECTION, type SkipCorrection } from './skipCorrection'

/** User setting: what to do with detected intros/credits. */
export type SkipMode = 'auto' | 'countdown' | 'button' | 'off'

export const skipModes: SkipMode[] = ['auto', 'countdown', 'button', 'off']

export function skipModeTitle(mode: SkipMode): string {
  switch (mode) {
    case 'auto': return 'Автоматически'
    case 'countdown': return 'С отсчётом'
    case 'button': return 'Кнопкой'
    case 'off': return 'Выключено'
  }
}

/** What is being played, as far as skipping is concerned. */
export interface SkipContext {
  mode: SkipMode
  isEpisode: boolean
  /** Episode 1 of a season: the intro is usually new, so it's never skipped silently. */
  isFirstEpisodeOfSeason: boolean
  hasNextEpisode: boolean
  /** File duration in seconds, if known. */
  duration?: number
}

export function skipContextFor(mode: SkipMode, item: PlexItem, hasNextEpisode: boolean): SkipContext {
  return {
    mode,
    isEpisode: item.type === 'episode',
    isFirstEpisodeOfSeason: item.type === 'episode' && item.index === 1,
    hasNextEpisode,
    duration: item.duration !== undefined ? item.duration / 1000 : undefined,
  }
}

export type SkipBehavior = 'auto' | 'countdown' | 'button' | 'none'

/** What a skip does. */
export type SkipAction =
  | { kind: 'seek'; to: number }
  /** Start the next episode. */
  | { kind: 'nextEpisode' }
  /** Close the player (end credits of the last episode or a movie). */
  | { kind: 'finish' }

/** The "Skip …" button currently offered to the user. */
export interface SkipPrompt {
  segment: Segment
  action: SkipAction
  title: string
}

/** "Skipping the intro in 5" shown before a segment in countdown mode. */
export interface SkipCountdown {
  segment: Segment
  secondsLeft: number
  title: string
}

/** Commands the player must execute. */
export type SkipCommand =
  | { kind: 'seek'; to: number }
  /**
   * Show the "Next episode" card with a countdown, then play the next episode. Final credits
   * reached without `nextEpisodeLead` (autoplay off: the card waits for the user).
   */
  | { kind: 'startNextEpisodeCountdown' }
  /** The countdown before the final credits ran out: play the next episode now. */
  | { kind: 'playNextEpisode' }

export const SkipPolicy = {
  /**
   * Credits ending closer than this to the end of the file are "final":
   * skipping them means moving on, not seeking to a post-credits scene.
   */
  finalCreditsTolerance: 20,

  behavior(segment: Segment, context: SkipContext): SkipBehavior {
    if (context.mode === 'off') return 'none'
    if (context.mode === 'countdown') return SkipPolicy.countdownBehavior(segment, context)
    switch (segment.type) {
      case 'recap':
      case 'preview':
        return 'button'
      case 'intro':
        return SkipPolicy.canAutoSkip(context) ? 'auto' : 'button'
      case 'credits':
        if (!SkipPolicy.canAutoSkip(context)) return 'button'
        // Auto-skip of final credits means "play next"; without a next episode
        // closing the player on its own would be rude, so offer a button.
        if (SkipPolicy.isFinalCredits(segment, context) && !context.hasNextEpisode) return 'button'
        return 'auto'
    }
  },

  action(segment: Segment, context: SkipContext): SkipAction {
    if (segment.type === 'credits' && SkipPolicy.isFinalCredits(segment, context)) {
      return context.hasNextEpisode ? { kind: 'nextEpisode' } : { kind: 'finish' }
    }
    return { kind: 'seek', to: segment.end }
  },

  title(segment: Segment, action: SkipAction): string {
    switch (action.kind) {
      case 'nextEpisode': return 'Следующая серия'
      case 'finish': return 'Пропустить титры'
      case 'seek':
        switch (segment.type) {
          case 'intro': return 'Пропустить заставку'
          case 'credits': return 'Пропустить титры'
          case 'recap': return 'Пропустить пересказ'
          case 'preview': return 'Пропустить анонс'
        }
    }
  },

  /**
   * Countdown mode: the cancellable countdown replaces the first-episode exception.
   * Final credits go straight to the "Next episode" card, which has its own countdown.
   */
  countdownBehavior(segment: Segment, context: SkipContext): SkipBehavior {
    if (!context.isEpisode) return 'button'
    switch (segment.type) {
      case 'recap':
      case 'preview':
        return 'button'
      case 'intro':
        return 'countdown'
      case 'credits':
        if (SkipPolicy.isFinalCredits(segment, context)) {
          return context.hasNextEpisode ? 'auto' : 'button'
        }
        return 'countdown'
    }
  },

  countdownTitle(segment: Segment, secondsLeft: number): string {
    switch (segment.type) {
      case 'intro': return `Пропуск заставки через ${secondsLeft}`
      case 'credits': return `Пропуск титров через ${secondsLeft}`
      case 'recap': return `Пропуск пересказа через ${secondsLeft}`
      case 'preview': return `Пропуск анонса через ${secondsLeft}`
    }
  },

  canAutoSkip(context: SkipContext): boolean {
    return context.mode === 'auto' && context.isEpisode && !context.isFirstEpisodeOfSeason
  },

  isFinalCredits(segment: Segment, context: SkipContext): boolean {
    if (segment.type !== 'credits') return false
    const duration = context.duration
    if (duration === undefined || !(duration > 0)) return true
    return duration - segment.end <= SkipPolicy.finalCreditsTolerance
  },
}

type SegmentState =
  | { kind: 'pending' }
  /** Countdown mode: skip once playback reaches `deadline`. */
  | { kind: 'counting'; deadline: number }
  /** Skipped automatically; no button while still inside. */
  | { kind: 'autoFired' }
  /** Auto-skip happened, then the user moved back or cancelled: button only. */
  | { kind: 'manual' }

const pending: SegmentState = { kind: 'pending' }
const autoFired: SegmentState = { kind: 'autoFired' }
const manual: SegmentState = { kind: 'manual' }

/**
 * Tracks playback position against detected segments and decides when to
 * auto-skip and which button to show. Pure state machine, driven by `update`.
 */
export class SkipController {
  /** Do not auto-skip when less than this remains of the segment. */
  static readonly minimumRemaining = 1.5
  /** Countdown mode: seconds of warning before the skip. */
  static readonly countdownLead = 5

  /** Segments with the user's correction applied: these drive timing and seek targets. */
  segments: Segment[] = []
  /**
   * The same segments as detected: whether credits are "final" is decided on these,
   * so a few seconds of correction never turns "next episode" into a seek or back.
   */
  private detected: Segment[] = []
  private readonly allDetected: Segment[]
  context: SkipContext
  prompt: SkipPrompt | null = null
  /** Countdown before a segment (countdown mode). */
  countdown: SkipCountdown | null = null
  /**
   * Seconds left before the next episode: the countdown runs during the `nextEpisodeLead`
   * seconds before the final credits, so the next episode starts as they do.
   */
  nextEpisodeCountdown: number | null = null
  /**
   * Length of that countdown (the "Next episode" setting); undefined: no countdown, the card
   * waits for the user once the credits start.
   */
  nextEpisodeLead: number | undefined
  private states: SegmentState[] = []

  constructor(segments: Segment[], context: SkipContext, correction: SkipCorrection = NO_CORRECTION) {
    this.allDetected = sanitizeSegments([...segments])
    this.context = { ...context }
    this.applyCorrection(correction)
    this.states = this.segments.map(() => pending)
  }

  private applyCorrection(correction: SkipCorrection) {
    const pairs = this.allDetected
      .map((segment) => {
        const corrected = applyCorrectionTo(correction, segment, this.context.duration)
        return corrected ? ([segment, corrected] as const) : null
      })
      .filter((p): p is readonly [Segment, Segment] => p !== null)
      .sort((a, b) => a[1].start - b[1].start)
    this.detected = pairs.map((p) => p[0])
    this.segments = pairs.map((p) => p[1])
  }

  /**
   * Changes the correction mid-playback. Segments already skipped or cancelled stay
   * so; a running countdown starts over against the new boundaries.
   */
  setCorrection(correction: SkipCorrection) {
    const previous = new Map<string, SegmentState>()
    this.detected.forEach((segment, i) => previous.set(segmentKey(segment), this.states[i]))
    this.applyCorrection(correction)
    this.states = this.detected.map((segment) => {
      const state = previous.get(segmentKey(segment)) ?? pending
      return state.kind === 'counting' ? pending : state
    })
    this.countdown = null
    this.nextEpisodeCountdown = null
  }

  /**
   * The next episode is known once the show's episode list loads, which may be after
   * playback has started; only final credits depend on it.
   */
  setHasNextEpisode(hasNext: boolean) {
    this.context.hasNextEpisode = hasNext
  }

  /** Updates duration once the player knows it exactly. */
  setDuration(duration: number) {
    if (!(duration > 0)) return
    this.context.duration = duration
  }

  /** Call on every position tick. Returns a command to run at most once per segment. */
  update(position: number): SkipCommand | null {
    this.countdown = null
    const nextEpisode = this.updateNextEpisodeCountdown(position)
    if (nextEpisode) {
      this.prompt = null
      return nextEpisode
    }
    if (this.nextEpisodeCountdown !== null) {
      this.prompt = null
      return null
    }
    const fromCountdown = this.updateCountdowns(position)
    if (fromCountdown) {
      this.prompt = null
      return fromCountdown
    }
    if (this.countdown) {
      this.prompt = null
      return null
    }

    const i = this.segments.findIndex((s) => segmentContains(s, position) && s.end - position > 0.25)
    if (i < 0) {
      this.prompt = null
      return null
    }
    const segment = this.segments[i]
    const behavior = this.behaviorAt(i)
    const action = this.actionAt(i)

    if (behavior === 'none') {
      this.prompt = null
      return null
    }

    if (behavior === 'auto' && this.states[i].kind === 'pending' && segment.end - position > SkipController.minimumRemaining) {
      this.states[i] = autoFired
      this.prompt = null
      const command = this.commandFor(action)
      if (command) return command
      // Not produced by the policy for auto, keep the button just in case.
      this.states[i] = manual
    }

    if (this.states[i].kind === 'autoFired') {
      this.prompt = null
      return null
    }

    this.prompt = { segment, action, title: SkipPolicy.title(segment, action) }
    return null
  }

  /**
   * Countdown mode. The countdown runs during the `countdownLead` seconds before a
   * segment and the skip fires as it starts. Playback that begins too close to the
   * segment or inside it (resume, seek) still gets the full warning.
   */
  private updateCountdowns(position: number): SkipCommand | null {
    const lead = SkipController.countdownLead
    for (let i = 0; i < this.segments.length; i++) {
      const segment = this.segments[i]
      if (this.behaviorAt(i) !== 'countdown') continue
      const inWindow = position >= segment.start - lead && position < segment.end

      if (this.states[i].kind === 'pending' && inWindow) {
        // Arrived by normal playback: the countdown ends exactly at the start.
        const natural = position <= segment.start - lead + 1
        const deadline = natural ? segment.start : Math.max(segment.start, position + lead)
        this.states[i] =
          deadline <= segment.end - SkipController.minimumRemaining ? { kind: 'counting', deadline } : manual
      }
      const state = this.states[i]
      if (state.kind !== 'counting') continue
      if (!inWindow) {
        // Seeked away before the skip: count again next time.
        this.states[i] = pending
        continue
      }
      if (position >= state.deadline) {
        this.states[i] = autoFired
        const command = this.commandFor(this.actionAt(i))
        if (command) return command
        this.states[i] = manual
        continue
      }
      const secondsLeft = Math.max(1, Math.ceil(state.deadline - position))
      this.countdown = { segment, secondsLeft, title: SkipPolicy.countdownTitle(segment, secondsLeft) }
      return null
    }
    return null
  }

  /**
   * The countdown to the next episode: during the `nextEpisodeLead` seconds before final
   * credits that would play the next episode on their own, ending as they start. Playback
   * that begins closer than that (resume, seek into the credits) gets the full countdown,
   * cut at the end of the credits.
   */
  private updateNextEpisodeCountdown(position: number): SkipCommand | null {
    this.nextEpisodeCountdown = null
    const lead = this.nextEpisodeLead
    if (lead === undefined || !(lead > 0)) return null
    for (let i = 0; i < this.segments.length; i++) {
      if (this.behaviorAt(i) !== 'auto' || this.actionAt(i).kind !== 'nextEpisode') continue
      const segment = this.segments[i]
      const inWindow = position >= segment.start - lead && position < segment.end
      if (this.states[i].kind === 'pending' && inWindow) {
        const natural = position <= segment.start - lead + 1
        const deadline = natural ? segment.start : Math.min(Math.max(segment.start, position + lead), segment.end)
        this.states[i] = { kind: 'counting', deadline }
      }
      const state = this.states[i]
      if (state.kind !== 'counting') continue
      // Ran out (also when the last tick lands at the very end of the credits; a user's seek
      // resets the countdown before this, in `userSeeked`).
      if (position >= state.deadline) {
        this.states[i] = autoFired
        return { kind: 'playNextEpisode' }
      }
      if (!inWindow) {
        // Seeked away before it ran out: count again next time.
        this.states[i] = pending
        continue
      }
      this.nextEpisodeCountdown = Math.max(1, Math.ceil(state.deadline - position))
      return null
    }
    return null
  }

  private behaviorAt(i: number): SkipBehavior {
    return SkipPolicy.behavior(this.detected[i], this.context)
  }

  /** Policy decided on the detected segment, seek target from the corrected one. */
  private actionAt(i: number): SkipAction {
    const action = SkipPolicy.action(this.detected[i], this.context)
    return action.kind === 'seek' ? { kind: 'seek', to: this.segments[i].end } : action
  }

  private commandFor(action: SkipAction): SkipCommand | null {
    switch (action.kind) {
      case 'seek': return { kind: 'seek', to: action.to }
      case 'nextEpisode': return { kind: 'startNextEpisodeCountdown' }
      case 'finish': return null
    }
  }

  /**
   * The user cancelled the countdown (before a segment or to the next episode): play the
   * segment, offer the button inside it.
   */
  cancelCountdown() {
    this.states = this.states.map((s) => (s.kind === 'counting' ? manual : s))
    this.countdown = null
    this.nextEpisodeCountdown = null
  }

  /**
   * The user cancelled the next-episode card (or otherwise interacted): never auto-skip
   * a segment twice, but show the button again for segments that were auto-skipped.
   * A running skip countdown restarts from the new position.
   */
  userInteracted() {
    this.states = this.states.map((s) => {
      switch (s.kind) {
        case 'autoFired': return manual
        case 'counting': return pending
        default: return s
      }
    })
  }

  /**
   * The user moved playback to `position`. Seeking back before a segment makes it fresh
   * again: it counts down / skips as on first arrival. Landing inside a segment that was
   * already skipped: countdown mode counts down again (it can be cancelled), auto mode
   * only offers the button, so the intro can be rewatched. A countdown the user cancelled
   * stays cancelled while playback is inside the segment.
   */
  userSeeked(position: number) {
    this.states = this.states.map((state, i) => {
      const segment = this.segments[i]
      if (position < segment.start) return pending
      switch (state.kind) {
        case 'autoFired':
          return this.behaviorAt(i) === 'countdown' && position < segment.end ? pending : manual
        case 'counting':
          return pending
        default:
          return state
      }
    })
    this.countdown = null
    this.nextEpisodeCountdown = null
  }

  /** Position from which progress counts as "watched": start of the final credits, if known. */
  get watchedThreshold(): number | undefined {
    const i = this.segments.findIndex((_, j) => SkipPolicy.isFinalCredits(this.detected[j], this.context))
    return i >= 0 ? this.segments[i].start : undefined
  }
}

export function actionsEqual(a: SkipAction, b: SkipAction): boolean {
  return a.kind === b.kind && (a.kind !== 'seek' || (b.kind === 'seek' && a.to === b.to))
}
