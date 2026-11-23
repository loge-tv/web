import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DetectorClient } from '../../core/detectorClient'
import { makeItem, type PlexItem, type PlexPart, type PlexStream } from '../../core/plexModels'
import type { PlexServerAPI, TranscodeOptions } from '../../core/plexServerAPI'
import type { Segment } from '../../core/segment'
import {
  MemoryStorage,
  ShowPreferencesStore,
  ShowPreferencesSync,
  type AudioPreference,
  type ShowPreferences,
} from '../../core/showPreferences'
import { correction, NO_CORRECTION } from '../../core/skipCorrection'
import type { SkipMode } from '../../core/skipPolicy'
import { PlayerSession } from '../playerSession'

// The real module reads `navigator` on import (absent in Node 20).
vi.mock('../../platform', () => ({ newSessionId: () => 'session-1' }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Lets resolved promises run their continuations (timers stay frozen). */
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

/** Just enough of `<video>` for the session; events are dispatched by the test. */
class FakeVideo extends EventTarget {
  currentTime = 0
  duration = NaN
  paused = true
  src = ''
  error: MediaError | null = null
  seekable = { length: 0, start: () => 0, end: () => 0 }

  play = vi.fn(async () => {
    this.paused = false
    this.dispatchEvent(new Event('play'))
  })

  pause() {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }

  load() {}

  removeAttribute(name: string) {
    if (name === 'src') this.src = ''
  }

  canPlayType() {
    return 'maybe'
  }

  /** Playback reached `position` (file time of a direct play). */
  playTo(position: number) {
    this.currentTime = position
    this.dispatchEvent(new Event('timeupdate'))
  }
}

const stream = (fields: Partial<PlexStream> & { id: string; streamType: number }): PlexStream => ({
  doviPresent: false,
  isDefault: false,
  isForced: false,
  selected: false,
  ...fields,
})

const part: PlexPart = {
  id: '11',
  key: '/library/parts/11/file.mp4',
  container: 'mp4',
  streams: [
    stream({ id: '1', streamType: 1, codec: 'h264' }),
    stream({ id: '2', streamType: 2, codec: 'aac', languageCode: 'rus', title: 'Дубляж', channels: 2, isDefault: true }),
    stream({ id: '3', streamType: 2, codec: 'aac', languageCode: 'rus', title: 'LostFilm', channels: 2 }),
  ],
}

const episode = (index: number): PlexItem =>
  makeItem({
    ratingKey: String(100 + index),
    type: 'episode',
    index,
    parentIndex: 1,
    grandparentRatingKey: '100',
    duration: 2_990_000,
    media: [{ id: String(index), container: 'mp4', videoCodec: 'h264', parts: [part] }],
  })

const current = episode(2)
const next = episode(3)

const intro: Segment = { type: 'intro', start: 17.5, end: 61.7 }
const credits: Segment = { type: 'credits', start: 2909.1, end: 2987.9 }

const lostFilm: AudioPreference = { language: 'rus', title: 'LostFilm', codec: 'aac', channels: 2, indexInLanguage: 1 }

function setup({ skipMode = 'auto' as SkipMode, cached }: { skipMode?: SkipMode; cached?: ShowPreferences } = {}) {
  const segments = deferred<Segment[] | null>()
  const episodes = deferred<PlexItem[]>()
  const pulled = deferred<ShowPreferences | null>()

  const api = {
    baseURL: 'http://pms.test:32400',
    token: 'token',
    item: vi.fn(async (key: string) => (key === current.ratingKey ? current : undefined)),
    allEpisodes: vi.fn(() => episodes.promise),
    selectStreams: vi.fn(async () => {}),
    transcodeDecision: vi.fn(async () => ({ code: 1000 })),
    transcodeURL: vi.fn((o: TranscodeOptions) => `http://pms.test:32400/start.m3u8?offset=${o.offset}`),
    directPlayURL: vi.fn((p: PlexPart) => `http://pms.test:32400${p.key}`),
    reportTimeline: vi.fn(async () => {}),
    markWatched: vi.fn(async () => {}),
    stopTranscode: vi.fn(async () => {}),
    subtitleURL: vi.fn((id: number) => `http://pms.test:32400/library/streams/${id}`),
  }
  const detector = {
    baseURL: 'http://loge.test',
    segmentsIfAvailable: vi.fn(() => segments.promise),
  }
  const remote = {
    fetchPreferences: vi.fn(() => pulled.promise),
    savePreferences: vi.fn(async () => {}),
  }
  const store = new ShowPreferencesStore(new MemoryStorage())
  // What an earlier session took from Loge Server (not a change of the user).
  if (cached) store.replace('100', cached)
  const sync = new ShowPreferencesSync(store, () => remote)
  const schedulePush = vi.spyOn(sync, 'schedulePush')
  const video = new FakeVideo()

  const session = new PlayerSession(
    {
      api: api as unknown as PlexServerAPI,
      detector: () => detector as unknown as DetectorClient,
      settings: () => ({ skipMode, autoplayNext: true, nextEpisodeCountdown: 5, forceTranscode: false }),
      preferences: store,
      preferencesSync: sync,
      capabilities: { canPlay: () => true, audioTrackSwitching: false },
      nativeHLS: () => true,
      local: true,
    },
    // As PlayerPage opens it: only the key is known.
    makeItem({ ratingKey: current.ratingKey, type: 'other' }),
  )
  session.attach(video as unknown as HTMLVideoElement)
  sessions.push(session)
  return { session, video, api, detector, remote, store, schedulePush, segments, episodes, pulled }
}

/** Starts the session and lets the media load. */
async function started(s: ReturnType<typeof setup>, startAt?: number) {
  s.session.start(startAt)
  await flush()
  s.video.dispatchEvent(new Event('loadedmetadata'))
  await flush()
}

const sessions: PlayerSession[] = []

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  sessions.splice(0).forEach((s) => s.dispose())
  vi.useRealTimers()
})

describe('PlayerSession start', () => {
  it('starts the video while segments, next episode and preferences are still loading', async () => {
    const s = setup()
    s.session.start()
    await flush()

    expect(s.video.src).toBe('http://pms.test:32400/library/parts/11/file.mp4')
    expect(s.detector.segmentsIfAvailable).toHaveBeenCalledWith('102')
    expect(s.api.allEpisodes).toHaveBeenCalledWith('100')
    expect(s.remote.fetchPreferences).toHaveBeenCalledWith('100')

    s.video.dispatchEvent(new Event('loadedmetadata'))
    await flush()
    expect(s.video.play).toHaveBeenCalled()
    const snapshot = s.session.getSnapshot()
    expect(snapshot.loading).toBe(false)
    expect(snapshot.selectedAudio).toBe(2)
    expect(snapshot.segmentSources).toBeUndefined()
    expect(snapshot.nextEpisode).toBeUndefined()

    // Time updates before the segments only report progress.
    s.video.playTo(5)
    expect(s.session.getSnapshot().position).toBe(5)
    expect(s.session.getSnapshot().skipPrompt).toBeNull()
    expect(s.api.reportTimeline).toHaveBeenCalled()

    s.segments.resolve([intro, credits])
    await flush()
    expect(s.session.getSnapshot().segments).toEqual([intro, credits])
    expect(s.session.getSnapshot().segmentSources).toEqual({ segments: [intro, credits], sources: ['server'] })
  })

  it('starts with the dub cached for the show, without waiting for Loge Server', async () => {
    const s = setup({ cached: { correction: { ...NO_CORRECTION }, audio: lostFilm } })
    await started(s, 40)

    expect(s.session.getSnapshot().selectedAudio).toBe(3)
    // Not the browser's default track: through the transcoder, at the resume point.
    expect(s.api.selectStreams).toHaveBeenCalledWith(part, { audioStreamID: 3, subtitleStreamID: 0 })
    expect(s.api.transcodeURL).toHaveBeenCalledWith(expect.objectContaining({ offset: 40 }))
  })

  it('late segments act on an intro the playback is already inside', async () => {
    const s = setup()
    await started(s)
    s.video.playTo(30)

    s.segments.resolve([intro, credits])
    await flush()
    // Judged at once, as the controller does when created mid-segment: no time update needed.
    expect(s.video.currentTime).toBe(61.7)
    expect(s.session.getSnapshot().position).toBe(61.7)
  })

  it('late segments give an intro from 0:00 its full countdown', async () => {
    const s = setup({ skipMode: 'countdown' })
    await started(s)
    s.video.playTo(3)

    s.segments.resolve([{ type: 'intro', start: 0, end: 40 }])
    await flush()
    expect(s.session.getSnapshot().skipCountdown?.secondsLeft).toBe(5)

    s.video.playTo(8)
    expect(s.video.currentTime).toBe(40)
  })

  it('a next episode that comes after the segments turns on the next episode at the final credits', async () => {
    const s = setup()
    await started(s)
    s.segments.resolve([intro, credits])
    await flush()

    s.episodes.resolve([current, next])
    await flush()
    expect(s.session.getSnapshot().nextEpisode?.ratingKey).toBe('103')

    s.video.playTo(2910)
    expect(s.session.getSnapshot().nextCard).toEqual({ item: next, secondsLeft: 5 })
  })

  it('a next episode that comes first is known to the controller made later', async () => {
    const s = setup()
    await started(s)
    s.episodes.resolve([current, next])
    await flush()
    s.segments.resolve([intro, credits])
    await flush()

    s.video.playTo(2910)
    expect(s.session.getSnapshot().nextCard).toEqual({ item: next, secondsLeft: 5 })
  })

  it('without a next episode the final credits only offer a button', async () => {
    const s = setup()
    await started(s)
    s.segments.resolve([intro, credits])
    s.episodes.resolve([current])
    await flush()

    s.video.playTo(2910)
    expect(s.session.getSnapshot().nextCard).toBeNull()
    expect(s.session.getSnapshot().skipPrompt?.action).toEqual({ kind: 'finish' })
  })

  it('the credits start goes to the progress tracker that already reports', async () => {
    const s = setup()
    await started(s)
    s.video.playTo(100)
    expect(s.api.reportTimeline).toHaveBeenCalled()

    // Final credits well before 90 % of the file.
    s.segments.resolve([{ type: 'credits', start: 2500, end: 2980 }])
    await flush()
    s.video.playTo(2600)
    expect(s.api.markWatched).toHaveBeenCalledWith('102')
  })

  it('a different dub pulled after the start is switched to, not pushed', async () => {
    const s = setup()
    await started(s)
    s.video.playTo(120)
    expect(s.session.getSnapshot().plan?.mode).toBe('direct')

    s.pulled.resolve({ correction: { ...NO_CORRECTION }, audio: lostFilm })
    await flush()

    const snapshot = s.session.getSnapshot()
    expect(snapshot.selectedAudio).toBe(3)
    expect(snapshot.plan?.mode).toBe('transcode')
    // The session's own switch: Plex gets the stream, the transcode starts where playback is.
    expect(s.api.selectStreams).toHaveBeenCalledWith(part, { audioStreamID: 3, subtitleStreamID: 0 })
    expect(s.api.transcodeURL).toHaveBeenCalledWith(expect.objectContaining({ offset: 120 }))
    expect(s.video.src).toBe('http://pms.test:32400/start.m3u8?offset=120')
    // Not a choice of the user.
    expect(s.schedulePush).not.toHaveBeenCalled()
    expect(s.store.dirtyKeys.size).toBe(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(s.remote.savePreferences).not.toHaveBeenCalled()
  })

  it('segments and a dub that come before the media is ready', async () => {
    const s = setup()
    s.session.start(40)
    await flush()
    expect(s.session.getSnapshot().plan?.mode).toBe('direct')

    // Loge Server usually answers before the file opens.
    s.segments.resolve([intro, credits])
    s.pulled.resolve({ correction: { ...NO_CORRECTION }, audio: lostFilm })
    await flush()
    expect(s.session.getSnapshot().segments).toEqual([intro, credits])
    expect(s.api.reportTimeline).not.toHaveBeenCalled() // nothing is reported while the media opens
    // The direct play is replaced by the transcode with the dub, still at the resume point.
    expect(s.api.transcodeURL).toHaveBeenCalledWith(expect.objectContaining({ offset: 40 }))
    expect(s.video.src).toBe('http://pms.test:32400/start.m3u8?offset=40')

    s.video.dispatchEvent(new Event('loadedmetadata'))
    await flush()
    expect(s.video.play).toHaveBeenCalledTimes(1) // only the stream that replaced the first one
    expect(s.session.getSnapshot().loading).toBe(false)

    // The stream counts from the offset: its 0 is 0:40 of the file, inside the intro.
    s.video.playTo(0)
    expect(s.session.getSnapshot().position).toBe(61.7)
  })

  it('a pull that changes nothing reloads nothing', async () => {
    const cached: ShowPreferences = { correction: correction({ introEnd: 2 }), audio: lostFilm }
    const s = setup({ cached })
    await started(s, 40)
    expect(s.api.selectStreams).toHaveBeenCalledTimes(1)
    const src = s.video.src

    s.pulled.resolve(cached)
    await flush()
    expect(s.api.selectStreams).toHaveBeenCalledTimes(1)
    expect(s.api.transcodeURL).toHaveBeenCalledTimes(1)
    expect(s.video.src).toBe(src)
    expect(s.session.getSnapshot().selectedAudio).toBe(3)
    expect(s.session.getSnapshot().correction).toEqual(cached.correction)
    expect(s.schedulePush).not.toHaveBeenCalled()
  })

  it('a correction pulled after the segments moves them', async () => {
    const s = setup()
    await started(s)
    s.segments.resolve([intro, credits])
    await flush()

    s.pulled.resolve({ correction: correction({ introEnd: 3 }) })
    await flush()
    const snapshot = s.session.getSnapshot()
    expect(snapshot.correction).toEqual(correction({ introEnd: 3 }))
    expect(snapshot.segments[0]).toEqual({ type: 'intro', start: 17.5, end: 64.7 })
    expect(s.schedulePush).not.toHaveBeenCalled()

    s.video.playTo(20)
    expect(s.video.currentTime).toBe(64.7)
  })

  it('a correction pulled before the segments is used for them', async () => {
    const s = setup()
    await started(s)
    s.pulled.resolve({ correction: correction({ introEnd: 3 }) })
    await flush()
    s.segments.resolve([intro, credits])
    await flush()
    expect(s.session.getSnapshot().segments[0]).toEqual({ type: 'intro', start: 17.5, end: 64.7 })
  })

  it('results of a closed session are dropped', async () => {
    const s = setup()
    await started(s)
    s.session.close()

    s.segments.resolve([intro, credits])
    s.episodes.resolve([current, next])
    s.pulled.resolve({ correction: { ...NO_CORRECTION }, audio: lostFilm })
    await flush()
    const snapshot = s.session.getSnapshot()
    expect(snapshot.segments).toEqual([])
    expect(snapshot.nextEpisode).toBeUndefined()
    expect(snapshot.selectedAudio).toBe(2)
    expect(s.api.selectStreams).not.toHaveBeenCalled()
  })
})

describe('PlayerSession next episode countdown', () => {
  /** Playing with the segments and the next episode known. */
  async function playing() {
    const s = setup()
    await started(s)
    s.segments.resolve([intro, credits])
    s.episodes.resolve([current, next])
    await flush()
    return s
  }

  it('counts down before the final credits and starts the next episode as they begin', async () => {
    const s = await playing()
    s.video.playTo(2900)
    expect(s.session.getSnapshot().nextCard).toBeNull()
    s.video.playTo(2904.2)
    expect(s.session.getSnapshot().nextCard).toEqual({ item: next, secondsLeft: 5 })
    expect(s.session.getSnapshot().skipPrompt).toBeNull()
    s.video.playTo(2907)
    expect(s.session.getSnapshot().nextCard?.secondsLeft).toBe(3)

    const timelines = s.api.reportTimeline.mock.calls.length
    s.video.playTo(2909.1)
    // Not N seconds into the credits: at their start.
    expect(s.session.getSnapshot().item.ratingKey).toBe('103')
    expect(s.session.getSnapshot().nextCard).toBeNull()
    expect(s.api.markWatched).toHaveBeenCalledWith('102')
    // The last report of this episode is its stop; nothing of the next one rides on this tick.
    const reported = s.api.reportTimeline.mock.calls.slice(timelines) as unknown as [PlexItem, string][]
    expect(reported.map(([item, state]) => `${item.ratingKey} ${state}`)).toEqual(['102 stopped'])
  })

  it('a pause freezes it', async () => {
    const s = await playing()
    s.video.playTo(2905)
    expect(s.session.getSnapshot().nextCard?.secondsLeft).toBe(5)
    s.video.pause()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(s.session.getSnapshot().nextCard).toEqual({ item: next, secondsLeft: 5 })
    expect(s.session.getSnapshot().item.ratingKey).toBe('102')
  })

  it('«Титры» cancels it: the credits play with the «Следующая серия» button', async () => {
    const s = await playing()
    s.video.playTo(2905)
    expect(s.session.getSnapshot().nextCard).not.toBeNull()
    s.session.cancelNextEpisode()
    expect(s.session.getSnapshot().nextCard).toBeNull()
    s.video.playTo(2906)
    expect(s.session.getSnapshot().nextCard, 'stays cancelled').toBeNull()
    s.video.playTo(2912)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(s.session.getSnapshot().item.ratingKey).toBe('102')
    expect(s.session.getSnapshot().skipPrompt?.title).toBe('Следующая серия')
  })

  it('a seek away takes the card down; back in, it counts again', async () => {
    const s = await playing()
    s.video.playTo(2905)
    expect(s.session.getSnapshot().nextCard).not.toBeNull()
    s.session.seekTo(1000)
    expect(s.session.getSnapshot().nextCard).toBeNull()
    s.session.seekTo(2950)
    expect(s.session.getSnapshot().nextCard).toEqual({ item: next, secondsLeft: 5 })
  })

  it('the file ending before the countdown runs out starts the next episode', async () => {
    const s = await playing()
    s.video.playTo(2985)
    expect(s.session.getSnapshot().nextCard?.secondsLeft).toBe(3)
    s.video.dispatchEvent(new Event('ended'))
    expect(s.session.getSnapshot().item.ratingKey).toBe('103')
  })
})
