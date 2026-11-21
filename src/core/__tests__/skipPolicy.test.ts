import { describe, expect, it } from 'vitest'
import { makeItem } from '../plexModels'
import type { Segment } from '../segment'
import { applyCorrection, correction } from '../skipCorrection'
import { SkipController, SkipPolicy, skipContextFor, type SkipContext, type SkipMode } from '../skipPolicy'

// Port of SkipPolicyTests.swift.

const intro: Segment = { type: 'intro', start: 17.5, end: 61.7 }
const credits: Segment = { type: 'credits', start: 2909.1, end: 2987.9 }
const recap: Segment = { type: 'recap', start: 0, end: 15 }

function context(
  mode: SkipMode = 'auto',
  { episode = true, first = false, next = true, duration = 2990 as number | undefined } = {},
): SkipContext {
  return { mode, isEpisode: episode, isFirstEpisodeOfSeason: first, hasNextEpisode: next, duration }
}

const seek = (to: number) => ({ kind: 'seek', to })
const nextEpisode = { kind: 'nextEpisode' }
const finish = { kind: 'finish' }
const startNext = { kind: 'startNextEpisodeCountdown' }

describe('SkipPolicy', () => {
  it('auto mode skips intro and credits of a regular episode', () => {
    expect(SkipPolicy.behavior(intro, context())).toBe('auto')
    expect(SkipPolicy.behavior(credits, context())).toBe('auto')
    expect(SkipPolicy.action(intro, context())).toEqual(seek(61.7))
    expect(SkipPolicy.action(credits, context())).toEqual(nextEpisode)
  })

  it('first episode of a season gets buttons', () => {
    const ctx = context('auto', { first: true })
    expect(SkipPolicy.behavior(intro, ctx)).toBe('button')
    expect(SkipPolicy.behavior(credits, ctx)).toBe('button')
  })

  it('button mode', () => {
    expect(SkipPolicy.behavior(intro, context('button'))).toBe('button')
    expect(SkipPolicy.behavior(credits, context('button'))).toBe('button')
  })

  it('off mode', () => {
    for (const segment of [intro, credits, recap]) {
      expect(SkipPolicy.behavior(segment, context('off'))).toBe('none')
    }
  })

  it('recap and preview are button only', () => {
    expect(SkipPolicy.behavior(recap, context())).toBe('button')
    expect(SkipPolicy.behavior({ type: 'preview', start: 2988, end: 2990 }, context())).toBe('button')
    expect(SkipPolicy.title(recap, { kind: 'seek', to: 15 })).toBe('Пропустить пересказ')
  })

  it('movies get buttons and credits finish', () => {
    const movie = context('auto', { episode: false, next: false, duration: 7200 })
    const movieCredits: Segment = { type: 'credits', start: 6900, end: 7195 }
    expect(SkipPolicy.behavior(movieCredits, movie)).toBe('button')
    expect(SkipPolicy.action(movieCredits, movie)).toEqual(finish)
    expect(SkipPolicy.title(movieCredits, { kind: 'finish' })).toBe('Пропустить титры')
  })

  it('last episode credits are a button that finishes', () => {
    const ctx = context('auto', { next: false })
    expect(SkipPolicy.behavior(credits, ctx)).toBe('button')
    expect(SkipPolicy.action(credits, ctx)).toEqual(finish)
  })

  it('mid-file credits seek to their end', () => {
    // Credits followed by a 3-minute post-credits scene.
    const early: Segment = { type: 'credits', start: 2600, end: 2810 }
    expect(SkipPolicy.action(early, context())).toEqual(seek(2810))
    expect(SkipPolicy.behavior(early, context())).toBe('auto')
    expect(SkipPolicy.title(early, { kind: 'seek', to: 2810 })).toBe('Пропустить титры')
  })

  it('context from a Plex item', () => {
    const first = makeItem({ ratingKey: '1', type: 'episode', title: 'e', index: 1, parentIndex: 2, duration: 3_000_000 })
    const ctx = skipContextFor('auto', first, true)
    expect(ctx.isEpisode).toBe(true)
    expect(ctx.isFirstEpisodeOfSeason).toBe(true)
    expect(ctx.duration).toBe(3000)

    const movie = makeItem({ ratingKey: '2', type: 'movie', title: 'm', index: 1 })
    expect(skipContextFor('auto', movie, false).isFirstEpisodeOfSeason).toBe(false)
  })
})

describe('SkipController', () => {
  it('auto-skips the intro once', () => {
    const controller = new SkipController([credits, intro], context())
    expect(controller.update(5)).toBeNull()
    expect(controller.prompt).toBeNull()

    expect(controller.update(18)).toEqual(seek(61.7))
    // Still inside while the seek happens: no button, no second command.
    expect(controller.update(18.5)).toBeNull()
    expect(controller.prompt).toBeNull()
    expect(controller.update(62)).toBeNull()
  })

  it('seeking back into an auto-skipped intro shows the button', () => {
    const controller = new SkipController([intro], context())
    expect(controller.update(20)).toEqual(seek(61.7))
    controller.update(70)
    controller.userInteracted()
    expect(controller.update(30)).toBeNull() // never auto-skips twice
    expect(controller.prompt?.title).toBe('Пропустить заставку')
    expect(controller.prompt?.action).toEqual(seek(61.7))
  })

  it('resume inside the intro skips', () => {
    const controller = new SkipController([intro], context())
    expect(controller.update(40)).toEqual(seek(61.7))
  })

  it('no auto-skip at the very end of a segment', () => {
    const controller = new SkipController([intro], context())
    expect(controller.update(61)).toBeNull()
    expect(controller.prompt?.action).toEqual(seek(61.7)) // button remains for the last moment
  })

  it('first episode shows buttons without commands', () => {
    const controller = new SkipController([intro, credits], context('auto', { first: true }))
    expect(controller.update(20)).toBeNull()
    expect(controller.prompt).toEqual({ segment: intro, action: seek(61.7), title: 'Пропустить заставку' })
    expect(controller.update(100)).toBeNull()
    expect(controller.prompt).toBeNull()
    expect(controller.update(2910)).toBeNull()
    expect(controller.prompt?.action).toEqual(nextEpisode)
    expect(controller.prompt?.title).toBe('Следующая серия')
  })

  it('credits start the next-episode countdown', () => {
    const controller = new SkipController([intro, credits], context())
    expect(controller.update(2909.5)).toEqual(startNext)
    expect(controller.update(2911)).toBeNull()
    expect(controller.prompt).toBeNull()
    // User cancels the countdown: credits keep playing with a button.
    controller.userInteracted()
    expect(controller.update(2912)).toBeNull()
    expect(controller.prompt?.action).toEqual(nextEpisode)
  })

  it('off mode does nothing', () => {
    const controller = new SkipController([intro, credits], context('off'))
    expect(controller.update(20)).toBeNull()
    expect(controller.prompt).toBeNull()
    expect(controller.update(2950)).toBeNull()
    expect(controller.prompt).toBeNull()
  })

  it('no segments, no actions', () => {
    const controller = new SkipController([], context())
    expect(controller.update(20)).toBeNull()
    expect(controller.prompt).toBeNull()
    expect(controller.watchedThreshold).toBeUndefined()
  })

  it('duration refines final credits', () => {
    // Item duration unknown: treated as final credits.
    const controller = new SkipController([{ type: 'credits', start: 2600, end: 2810 }], context('auto', { duration: undefined }))
    controller.setDuration(3000)
    expect(controller.update(2601)).toEqual(seek(2810))
    expect(controller.watchedThreshold).toBeUndefined()
  })

  it('watched threshold', () => {
    const controller = new SkipController([intro, credits], context())
    expect(controller.watchedThreshold).toBe(2909.1)
  })
})

describe('countdown mode', () => {
  it('policy', () => {
    const ctx = context('countdown')
    expect(SkipPolicy.behavior(intro, ctx)).toBe('countdown')
    expect(SkipPolicy.behavior(intro, context('countdown', { first: true }))).toBe('countdown') // first episode too
    expect(SkipPolicy.behavior(credits, ctx)).toBe('auto') // final credits go to the next-episode card
    expect(SkipPolicy.behavior(credits, context('countdown', { next: false }))).toBe('button')
    expect(SkipPolicy.behavior({ type: 'credits', start: 2600, end: 2810 }, ctx)).toBe('countdown')
    expect(SkipPolicy.behavior(recap, ctx)).toBe('button')
    expect(SkipPolicy.behavior(intro, context('countdown', { episode: false, next: false }))).toBe('button') // movies
  })

  it('runs before the intro and skips at its start', () => {
    const controller = new SkipController([intro, credits], context('countdown'))
    expect(controller.update(10)).toBeNull()
    expect(controller.countdown).toBeNull()

    expect(controller.update(12.6)).toBeNull()
    expect(controller.countdown?.segment).toEqual(intro)
    expect(controller.countdown?.secondsLeft).toBe(5)
    expect(controller.countdown?.title).toBe('Пропуск заставки через 5')
    expect(controller.prompt).toBeNull()

    expect(controller.update(15.0)).toBeNull()
    expect(controller.countdown?.secondsLeft).toBe(3)

    expect(controller.update(17.5)).toEqual(seek(61.7))
    expect(controller.countdown).toBeNull()
    expect(controller.update(18)).toBeNull() // fires once
    expect(controller.prompt).toBeNull()
  })

  it('a cancelled countdown plays the intro with a button', () => {
    const controller = new SkipController([intro], context('countdown'))
    controller.update(13)
    expect(controller.countdown).not.toBeNull()
    controller.cancelCountdown()
    expect(controller.countdown).toBeNull()

    expect(controller.update(14)).toBeNull()
    expect(controller.countdown).toBeNull()
    expect(controller.update(17.5)).toBeNull() // no skip after cancel
    expect(controller.prompt?.title).toBe('Пропустить заставку')
    expect(controller.prompt?.action).toEqual(seek(61.7))
  })

  it('counts down when playback starts inside the intro', () => {
    const controller = new SkipController([intro], context('countdown'))
    expect(controller.update(30)).toBeNull()
    expect(controller.countdown?.secondsLeft).toBe(5)
    expect(controller.update(34.2)).toBeNull()
    expect(controller.countdown?.secondsLeft).toBe(1)
    expect(controller.update(35)).toEqual(seek(61.7))
  })

  it('full warning for an intro right at the start of the file', () => {
    const early: Segment = { type: 'intro', start: 2, end: 40 }
    const controller = new SkipController([early], context('countdown'))
    expect(controller.update(0)).toBeNull()
    expect(controller.countdown?.secondsLeft).toBe(5) // full warning even if the lead-in is shorter
    expect(controller.update(4.5)).toBeNull()
    expect(controller.update(5)).toEqual(seek(40))
  })

  it('no countdown when too little of the segment is left', () => {
    const controller = new SkipController([intro], context('countdown'))
    expect(controller.update(58)).toBeNull()
    expect(controller.countdown).toBeNull()
    expect(controller.prompt?.action).toEqual(seek(61.7))
  })

  it('seeking away restarts the countdown', () => {
    const controller = new SkipController([intro], context('countdown'))
    controller.update(13)
    expect(controller.countdown).not.toBeNull()
    expect(controller.update(3)).toBeNull()
    expect(controller.countdown).toBeNull()
    expect(controller.update(12.6)).toBeNull()
    expect(controller.countdown?.secondsLeft).toBe(5)
  })

  it('a user seek during the countdown recounts from the new position', () => {
    const controller = new SkipController([intro], context('countdown'))
    controller.update(13)
    controller.userInteracted()
    expect(controller.update(25)).toBeNull()
    expect(controller.countdown?.secondsLeft).toBe(5)
    expect(controller.update(30)).toEqual(seek(61.7))
  })

  it('counts down for mid-file credits', () => {
    const early: Segment = { type: 'credits', start: 2600, end: 2810 }
    const controller = new SkipController([early], context('countdown'))
    expect(controller.update(2596)).toBeNull()
    expect(controller.countdown?.title).toBe('Пропуск титров через 4')
    expect(controller.update(2600)).toEqual(seek(2810))
  })

  it('final credits start the next-episode card', () => {
    const controller = new SkipController([intro, credits], context('countdown'))
    expect(controller.update(2905)).toBeNull()
    expect(controller.countdown).toBeNull() // the next-episode card has its own countdown
    expect(controller.update(2909.5)).toEqual(startNext)
  })
})

describe('correction', () => {
  it('shifts intro and credits separately', () => {
    const c = correction({ introStart: -2, introEnd: 3, creditsStart: 1, creditsEnd: -4 })
    const corrected = applyCorrection(c, [intro, credits, recap], 2990)
    expect(corrected[0]).toEqual({ type: 'intro', start: 15.5, end: 64.7 })
    expect(corrected[1].type).toBe('credits')
    expect(corrected[1].start).toBeCloseTo(2910.1, 9)
    expect(corrected[1].end).toBeCloseTo(2983.9, 9)
    expect(corrected[2]).toEqual(recap)
  })

  it('stays inside the file and drops collapsed segments', () => {
    const c = correction({ introStart: -5, introEnd: 5, creditsEnd: 5 })
    const short: Segment = { type: 'intro', start: 2, end: 4 }
    expect(applyCorrection(c, [short], 100)).toEqual([{ type: 'intro', start: 0, end: 9 }])
    expect(applyCorrection(c, [credits], 2990)).toEqual([{ type: 'credits', start: 2909.1, end: 2990 }])
    expect(applyCorrection(correction({ introStart: 5, introEnd: -5 }), [{ type: 'intro', start: 10, end: 19 }], undefined)).toEqual([])
  })

  it('the controller uses corrected boundaries', () => {
    const controller = new SkipController([intro], context(), correction({ introStart: 2, introEnd: -3 }))
    expect(controller.update(18)).toBeNull() // starts 2 s later
    const command = controller.update(19.6)
    expect(command?.kind).toBe('seek')
    expect(command?.kind === 'seek' && command.to).toBeCloseTo(58.7, 9)
    expect(controller.segments).toHaveLength(1)
    expect(controller.segments[0].start).toBe(19.5)
    expect(controller.segments[0].end).toBeCloseTo(58.7, 9)
  })

  it('the countdown follows the corrected start', () => {
    const controller = new SkipController([intro], context('countdown'), correction({ introStart: -3 }))
    expect(controller.update(9.6)).toBeNull()
    expect(controller.countdown?.secondsLeft).toBe(5)
    expect(controller.update(14.5)).toEqual(seek(61.7))
  })

  it('correction does not change which credits are final', () => {
    // Credits end 17 s before EOF: final. Moving their end earlier must not make them "mid-file".
    const late: Segment = { type: 'credits', start: 2900, end: 2973 }
    const earlier = new SkipController([late], context(), correction({ creditsEnd: -5 }))
    expect(earlier.update(2901)).toEqual(startNext)
    expect(earlier.watchedThreshold).toBe(2900)

    // Credits end 23 s before EOF: a post-credits scene follows. +5 must still land on it.
    const mid: Segment = { type: 'credits', start: 2900, end: 2967 }
    const later = new SkipController([mid], context(), correction({ creditsStart: 1, creditsEnd: 5 }))
    expect(later.update(2900.5)).toBeNull() // start moved by +1
    expect(later.update(2901.5)).toEqual(seek(2972))
    expect(later.watchedThreshold).toBeUndefined()
  })
})

describe('seeking back', () => {
  const make = (mode: SkipMode) =>
    new SkipController([{ type: 'intro', start: 20, end: 60 }], {
      mode,
      isEpisode: true,
      isFirstEpisodeOfSeason: false,
      hasNextEpisode: true,
      duration: 3000,
    })

  it('countdown again after seeking back before the intro', () => {
    const c = make('countdown')
    c.update(15.5)
    expect(c.update(20)).toEqual(seek(60))
    c.userSeeked(8)
    expect(c.update(8)).toBeNull()
    expect(c.update(15.2)).toBeNull()
    expect(c.countdown?.secondsLeft).toBe(5)
    expect(c.update(20)).toEqual(seek(60))
  })

  it('countdown again after seeking back into a skipped intro', () => {
    const c = make('countdown')
    c.update(15.5)
    expect(c.update(20)).toEqual(seek(60))
    c.userSeeked(50)
    expect(c.update(50)).toBeNull()
    expect(c.countdown?.secondsLeft).toBe(5) // full warning from where the seek landed
    expect(c.update(55)).toEqual(seek(60))
  })

  it('a cancelled countdown stays cancelled inside but not before', () => {
    const c = make('countdown')
    c.update(16)
    c.cancelCountdown()
    expect(c.update(30)).toBeNull()
    c.userSeeked(25)
    expect(c.update(25)).toBeNull()
    expect(c.countdown).toBeNull() // the user said «Не пропускать»
    expect(c.prompt?.title).toBe('Пропустить заставку')
    c.userSeeked(10)
    expect(c.update(15.5)).toBeNull()
    expect(c.countdown).not.toBeNull() // before the intro it is fresh again
  })

  it('auto mode: seeking back into the intro offers the button before it skips again', () => {
    const c = make('auto')
    expect(c.update(21)).toEqual(seek(60))
    c.userSeeked(40)
    expect(c.update(40)).toBeNull() // rewatching the intro: no instant skip
    expect(c.prompt?.title).toBe('Пропустить заставку')
    c.userSeeked(5)
    expect(c.update(5)).toBeNull()
    expect(c.update(20.5)).toEqual(seek(60))
  })
})

describe('correction changed mid-playback', () => {
  const ctx = (mode: SkipMode): SkipContext => ({
    mode,
    isEpisode: true,
    isFirstEpisodeOfSeason: false,
    hasNextEpisode: true,
    duration: 3000,
  })

  it('keeps skipped segments skipped', () => {
    const controller = new SkipController([{ type: 'intro', start: 20, end: 60 }], ctx('auto'))
    expect(controller.update(21)).toEqual(seek(60))
    controller.setCorrection(correction({ introEnd: 3 }))
    expect(controller.segments).toEqual([{ type: 'intro', start: 20, end: 63 }])
    expect(controller.update(61)).toBeNull() // not skipped again
  })

  it('restarts a running countdown', () => {
    const controller = new SkipController([{ type: 'intro', start: 20, end: 60 }], ctx('countdown'))
    controller.update(15.5)
    expect(controller.countdown?.secondsLeft).toBe(5)
    controller.setCorrection(correction({ introStart: 3 }))
    expect(controller.countdown).toBeNull()
    expect(controller.update(16)).toBeNull()
    expect(controller.countdown).toBeNull() // new start is 23 s: the window opens at 18 s
    expect(controller.update(18.5)).toBeNull()
    expect(controller.countdown?.secondsLeft).toBe(5)
    expect(controller.update(22)).toBeNull()
    expect(controller.update(23)).toEqual(seek(60))
  })
})
