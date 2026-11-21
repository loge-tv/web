import { describe, expect, it } from 'vitest'
import { bifFrameAt, buildBif, parseBif } from '../bif'
import { track, tracksFromPart } from '../mediaTrack'
import { planPlayback, type BrowserCapabilities } from '../playbackPlan'
import type { PlexMedia, PlexPart } from '../plexModels'
import { activeCues, decodeSubtitleBytes, parseSubtitles } from '../subtitles'

// Web-only: direct play decision, BIF thumbnails, subtitles.

const chrome: BrowserCapabilities = {
  canPlay: (mime) => mime.startsWith('video/mp4') && !mime.includes('ac-3') && !mime.includes('hvc1'),
  audioTrackSwitching: false,
}

function file(container: string, video: string, streams: PlexPart['streams']): { media: PlexMedia; part: PlexPart } {
  const part: PlexPart = { id: '1', key: '/f', container, streams }
  return { media: { id: '1', container, videoCodec: video, parts: [part] }, part }
}

const stream = (id: number, streamType: number, codec: string, extra: Partial<PlexPart['streams'][number]> = {}) => ({
  id: String(id),
  streamType,
  codec,
  doviPresent: false,
  isDefault: false,
  isForced: false,
  selected: false,
  ...extra,
})

describe('planPlayback', () => {
  it('direct play of an MP4 with the default audio', () => {
    const { media, part } = file('mp4', 'h264', [stream(1, 1, 'h264'), stream(2, 2, 'aac', { languageCode: 'rus' })])
    const tracks = tracksFromPart(part)
    const plan = planPlayback({ media, part, tracks, audio: tracks[0], subtitle: undefined, capabilities: chrome })
    expect(plan.mode).toBe('direct')
  })

  it('MKV, unsupported audio and a non-default dub go through the transcoder', () => {
    const mkv = file('mkv', 'h264', [stream(2, 2, 'aac')])
    expect(planPlayback({ ...mkv, tracks: tracksFromPart(mkv.part), audio: undefined, subtitle: undefined, capabilities: chrome }).mode).toBe('transcode')

    const ac3 = file('mp4', 'h264', [stream(2, 2, 'ac3')])
    const ac3Tracks = tracksFromPart(ac3.part)
    expect(planPlayback({ ...ac3, tracks: ac3Tracks, audio: ac3Tracks[0], subtitle: undefined, capabilities: chrome }).mode).toBe('transcode')

    const twoDubs = file('mp4', 'h264', [stream(2, 2, 'aac', { languageCode: 'eng', isDefault: true }), stream(3, 2, 'aac', { languageCode: 'rus' })])
    const tracks = tracksFromPart(twoDubs.part)
    const russian = tracks.find((t) => t.id === 3)
    expect(planPlayback({ ...twoDubs, tracks, audio: russian, subtitle: undefined, capabilities: chrome }).mode).toBe('transcode')
    // Safari can switch the audio track of the file itself.
    expect(planPlayback({ ...twoDubs, tracks, audio: russian, subtitle: undefined, capabilities: { ...chrome, audioTrackSwitching: true } }).mode).toBe('direct')
  })

  it('text subtitles are drawn by the player, image subtitles are burned in', () => {
    const { media, part } = file('mp4', 'h264', [stream(2, 2, 'aac'), stream(4, 3, 'srt'), stream(5, 3, 'pgs')])
    const tracks = tracksFromPart(part)
    const srt = planPlayback({ media, part, tracks, audio: tracks[0], subtitle: tracks[1], capabilities: chrome })
    expect(srt).toMatchObject({ mode: 'direct', subtitles: { kind: 'text', streamId: 4 } })
    const pgs = planPlayback({ media, part, tracks, audio: tracks[0], subtitle: tracks[2], capabilities: chrome })
    expect(pgs).toMatchObject({ mode: 'transcode', subtitles: { kind: 'burn', streamId: 5 } })
    const failed = planPlayback({ media, part, tracks, audio: tracks[0], subtitle: tracks[1], capabilities: chrome, textSubtitleFailed: true })
    expect(failed).toMatchObject({ mode: 'transcode', subtitles: { kind: 'burn', streamId: 4 } })
  })
})

describe('BIF', () => {
  it('parses frames and finds the one for a time', () => {
    const images = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])]
    const bif = buildBif(images, 10000)
    const index = parseBif(bif.buffer as ArrayBuffer)
    expect(index.frames.map((f) => f.timeMs)).toEqual([0, 10000, 20000])
    expect([...bif.slice(index.frames[1].start, index.frames[1].end)]).toEqual([4, 5])
    expect(bifFrameAt(index, 0)).toBe(0)
    expect(bifFrameAt(index, 9.9)).toBe(0)
    expect(bifFrameAt(index, 10)).toBe(1)
    expect(bifFrameAt(index, 999)).toBe(2)
  })

  it('rejects other files', () => {
    expect(() => parseBif(new Uint8Array(100).buffer)).toThrow()
  })
})

describe('subtitles', () => {
  it('SRT with markup', () => {
    const cues = parseSubtitles('1\r\n00:00:01,500 --> 00:00:03,000\r\n<i>Привет</i>\r\n\r\n2\r\n00:01:02,000 --> 00:01:04,250\r\nДве\r\nстроки\r\n')
    expect(cues).toEqual([
      { start: 1.5, end: 3, text: 'Привет' },
      { start: 62, end: 64.25, text: 'Две\nстроки' },
    ])
    expect(activeCues(cues, 2).map((c) => c.text)).toEqual(['Привет'])
    expect(activeCues(cues, 3)).toEqual([])
    expect(activeCues(cues, 63).map((c) => c.text)).toEqual(['Две\nстроки'])
  })

  it('WebVTT', () => {
    const cues = parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.500 align:middle\nHello\n')
    expect(cues).toEqual([{ start: 1, end: 2.5, text: 'Hello' }])
  })

  it('ASS dialogue lines', () => {
    const ass = [
      '[Script Info]',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:05.10,0:00:07.00,Default,,0,0,0,,{\\an8}Надпись, с запятой\\Nвторая',
    ].join('\n')
    expect(parseSubtitles(ass, 'ass')).toEqual([{ start: 5.1, end: 7, text: 'Надпись, с запятой\nвторая' }])
  })

  it('decodes Windows-1251 files', () => {
    // "Привет" in cp1251.
    const bytes = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])
    expect(decodeSubtitleBytes(bytes)).toBe('Привет')
    expect(decodeSubtitleBytes(new TextEncoder().encode(String.fromCharCode(0xfeff) + 'Привет'))).toBe('Привет')
  })

  it('forced subtitles are recognised by title too', () => {
    const tracks = tracksFromPart({ id: '1', key: '', streams: [stream(1, 3, 'srt', { title: 'Forced', languageCode: 'rus' })] })
    expect(tracks[0]).toEqual(track({ id: 1, kind: 'sub', codec: 'srt', title: 'Forced', language: 'rus', isForced: true }))
  })
})
