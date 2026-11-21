import { beforeAll, describe, expect, it } from 'vitest'
import { EpisodeNavigator } from '../episodeNavigator'
import { track, trackDisplayName, TrackSelector, tracksFromPart } from '../mediaTrack'
import { makeItem, parseMetadata, type PlexItem } from '../plexModels'
import { ProgressTracker, ResumePolicy, TimeFormat } from '../progressTracker'
import { fixtureJSON } from './support'

// Port of PlaybackTests.swift.

describe('EpisodeNavigator', () => {
  let episodes: PlexItem[] = []
  beforeAll(() => {
    episodes = parseMetadata(fixtureJSON('allLeaves'))
  })
  const episode = (key: string) => episodes.find((e) => e.ratingKey === key)!

  it('next within a season and across seasons', () => {
    expect(EpisodeNavigator.next(episode('101'), episodes)?.ratingKey).toBe('102')
    expect(EpisodeNavigator.next(episode('103'), episodes)?.ratingKey).toBe('201')
  })

  it('the last episode has no next and specials are skipped', () => {
    expect(EpisodeNavigator.next(episode('202'), episodes)).toBeUndefined() // specials are not next
    expect(EpisodeNavigator.next(episode('900'), episodes)).toBeUndefined()
  })

  it('unknown episode', () => {
    expect(EpisodeNavigator.next(makeItem({ ratingKey: 'x', type: 'episode' }), episodes)).toBeUndefined()
  })

  it('order ignores input order', () => {
    const shuffled = [...episodes].reverse()
    expect(EpisodeNavigator.ordered(shuffled).map((e) => e.ratingKey)).toEqual(['101', '102', '103', '201', '202', '900'])
  })

  it('resume episode', () => {
    expect(EpisodeNavigator.resumeEpisode(episodes)?.ratingKey).toBe('202') // in progress wins
    const noProgress = episodes.filter((e) => e.ratingKey !== '202')
    expect(EpisodeNavigator.resumeEpisode(noProgress)?.ratingKey).toBe('103')
    const allWatched = noProgress.map((e) => ({ ...e, viewCount: 1 }))
    expect(EpisodeNavigator.resumeEpisode(allWatched)?.ratingKey).toBe('101') // rewatch from the start
  })

  it('selected episode in a season', () => {
    const ep = (index: number, { watched = false, offset }: { watched?: boolean; offset?: number } = {}) =>
      makeItem({
        ratingKey: String(index),
        type: 'episode',
        index,
        parentIndex: 1,
        duration: 1_000_000,
        viewOffset: offset,
        viewCount: watched ? 1 : undefined,
      })
    const focus = (list: PlexItem[]) => EpisodeNavigator.focusEpisode(list)?.ratingKey
    expect(focus([ep(1, { watched: true }), ep(2), ep(3, { offset: 300_000 })])).toBe('3') // in progress wins
    expect(focus([ep(1, { watched: true }), ep(2, { watched: true }), ep(3), ep(4)])).toBe('3')
    expect(focus([ep(1), ep(2, { watched: true }), ep(3, { watched: true })])).toBe('1') // only a gap left
    expect(focus([ep(1, { watched: true }), ep(2, { watched: true })])).toBe('1') // all watched
    expect(focus([ep(2), ep(1)])).toBe('1') // by index, not input order
    expect(EpisodeNavigator.focusEpisode([])).toBeUndefined()
  })
})

describe('ProgressTracker', () => {
  it('timeline interval and state changes', () => {
    const tracker = new ProgressTracker()
    const t0 = 1_000_000
    expect(tracker.update('playing', 0, 100, t0)).toEqual([{ kind: 'timeline', state: 'playing', position: 0 }])
    expect(tracker.update('playing', 5, 100, t0 + 5000)).toEqual([])
    expect(tracker.update('playing', 10, 100, t0 + 10000)).toEqual([{ kind: 'timeline', state: 'playing', position: 10 }])
    expect(tracker.update('paused', 11, 100, t0 + 11000)).toEqual([{ kind: 'timeline', state: 'paused', position: 11 }])
    expect(tracker.update('paused', 11, 100, t0 + 30000)).toEqual([]) // no periodic reports while paused
  })

  it('scrobbles at 90 % once', () => {
    const tracker = new ProgressTracker()
    tracker.update('playing', 0, 100, 0)
    expect(tracker.update('playing', 89, 100, 1000)).toEqual([])
    expect(tracker.update('playing', 90, 100, 2000)).toEqual([{ kind: 'scrobble' }])
    expect(tracker.update('playing', 95, 100, 3000)).toEqual([])
  })

  it('scrobbles at the start of the credits', () => {
    const tracker = new ProgressTracker(2909)
    tracker.update('playing', 0, 3500, 0)
    expect(tracker.update('playing', 2910, 3500, 1000)).toEqual([{ kind: 'scrobble' }])
  })

  it('resume policy', () => {
    expect(ResumePolicy.resumePosition(makeItem({ ratingKey: '1', type: 'movie' }))).toBeUndefined()
    expect(ResumePolicy.resumePosition(makeItem({ ratingKey: '1', type: 'movie', duration: 6_000_000, viewOffset: 10_000 }))).toBeUndefined()
    expect(ResumePolicy.resumePosition(makeItem({ ratingKey: '1', type: 'movie', duration: 6_000_000, viewOffset: 615_000 }))).toBe(615)
    expect(ResumePolicy.resumePosition(makeItem({ ratingKey: '1', type: 'movie', duration: 6_000_000, viewOffset: 5_900_000 }))).toBeUndefined()
  })

  it('formatting', () => {
    expect(TimeFormat.clock(75)).toBe('1:15')
    expect(TimeFormat.clock(3725)).toBe('1:02:05')
    expect(TimeFormat.clock(-3)).toBe('0:00')
    expect(TimeFormat.runtime(6_720_000)).toBe('1 ч 52 мин')
    expect(TimeFormat.runtime(2_880_000)).toBe('48 мин')
    expect(TimeFormat.runtime(7_200_000)).toBe('2 ч')
    expect(TimeFormat.runtime(undefined)).toBeUndefined()
  })
})

describe('TrackSelector', () => {
  const engTrueHD = track({ id: 1, kind: 'audio', language: 'eng', codec: 'truehd', channels: 8, isDefault: true })
  const rusAC3 = track({ id: 2, kind: 'audio', language: 'rus', title: 'Дубляж', codec: 'ac3', channels: 6 })
  const rusMVO = track({ id: 3, kind: 'audio', language: 'ru', title: 'MVO', codec: 'aac', channels: 2 })
  const rusForced = track({ id: 1, kind: 'sub', language: 'rus', codec: 'subrip', isForced: true })
  const rusFull = track({ id: 2, kind: 'sub', language: 'rus', codec: 'hdmv_pgs_subtitle' })
  const engSubs = track({ id: 3, kind: 'sub', language: 'eng', codec: 'subrip', isDefault: true })

  it('Russian audio is preferred over the default', () => {
    expect(TrackSelector.defaultAudio([engTrueHD, rusAC3, rusMVO])).toEqual(rusAC3)
    const defaultMVO = { ...rusMVO, isDefault: true }
    expect(TrackSelector.defaultAudio([engTrueHD, rusAC3, defaultMVO])).toEqual(defaultMVO)
  })

  it('falls back to the file default', () => {
    const jpn = track({ id: 2, kind: 'audio', language: 'jpn' })
    expect(TrackSelector.defaultAudio([jpn, engTrueHD])).toEqual(engTrueHD)
    expect(TrackSelector.defaultAudio([jpn])).toEqual(jpn)
    expect(TrackSelector.defaultAudio([rusFull])).toBeUndefined()
  })

  it('subtitles with Russian audio', () => {
    const tracks = [engTrueHD, rusAC3, rusFull, rusForced, engSubs]
    expect(TrackSelector.defaultSubtitle(tracks, rusAC3)).toEqual(rusForced)
    expect(TrackSelector.defaultSubtitle([rusFull, engSubs], rusAC3)).toBeUndefined()
  })

  it('subtitles with foreign audio', () => {
    expect(TrackSelector.defaultSubtitle([rusForced, rusFull, engSubs], engTrueHD)).toEqual(rusFull)
    expect(TrackSelector.defaultSubtitle([engSubs], engTrueHD)).toBeUndefined()
  })

  it('display name', () => {
    expect(trackDisplayName(engTrueHD)).toBe('Английский · TrueHD 7.1')
    expect(trackDisplayName(rusAC3)).toBe('Русский · AC3 5.1 · Дубляж')
    expect(trackDisplayName(rusForced)).toBe('Русский · SRT · форсированные')
    expect(trackDisplayName(track({ id: 4, kind: 'sub', codec: 'hdmv_pgs_subtitle' }))).toBe('Дорожка 4 · PGS')
  })

  it('tracks come from Plex streams with their file titles', () => {
    const [item] = parseMetadata(fixtureJSON('episode'))
    const tracks = tracksFromPart(item.media[0].parts[0])
    expect(tracks.filter((t) => t.kind === 'audio').map((t) => [t.id, t.language, t.codec, t.channels])).toEqual([
      [2, 'eng', 'truehd', 8],
      [3, 'rus', 'ac3', 6],
    ])
    const eng = tracks.find((t) => t.id === 2)!
    expect(eng.isDefault).toBe(true)
    expect(eng.title).toBeUndefined() // displayTitle "English (TRUEHD 7.1)" is Plex's label, not the dub name
    const sidecar = tracks.find((t) => t.id === 5)!
    expect(sidecar.kind).toBe('sub')
    expect(sidecar.isExternal).toBe(true)
    expect(TrackSelector.defaultAudio(tracks)?.id).toBe(3)
  })
})
