import type { MediaTrack } from './mediaTrack'
import type { PlexMedia, PlexPart } from './plexModels'

/** What the browser can do; `canPlay` is `video.canPlayType(...) !== ''` or MSE support. */
export interface BrowserCapabilities {
  canPlay(mime: string): boolean
  /** `HTMLMediaElement.audioTracks` works (Safari): any audio track of the file can be chosen. */
  audioTrackSwitching: boolean
}

export type SubtitleDelivery =
  /** No subtitles. */
  | { kind: 'none' }
  /** Text subtitles fetched from Plex and drawn by the player. */
  | { kind: 'text'; streamId: number }
  /** Burned into the video by the Plex transcoder (image subtitles). */
  | { kind: 'burn'; streamId: number }

export type PlaybackPlan =
  | { mode: 'direct'; subtitles: SubtitleDelivery; reason: string }
  | { mode: 'transcode'; subtitles: SubtitleDelivery; reason: string }

const textSubtitleCodecs = new Set(['srt', 'subrip', 'ass', 'ssa', 'webvtt', 'vtt', 'mov_text', 'text', 'smi', 'sami'])

export function isTextSubtitle(t: MediaTrack): boolean {
  return textSubtitleCodecs.has((t.codec ?? '').toLowerCase())
}

/** Container MIME types a `<video>` element understands. MKV/AVI/TS are not among them. */
export function containerMime(container: string | undefined): string | undefined {
  switch ((container ?? '').toLowerCase()) {
    case 'mp4':
    case 'm4v':
    case 'mov':
      return 'video/mp4'
    case 'webm':
      return 'video/webm'
    default:
      return undefined
  }
}

export function videoCodecString(codec: string | undefined): string | undefined {
  switch ((codec ?? '').toLowerCase()) {
    case 'h264':
    case 'avc1':
      return 'avc1.640028'
    case 'hevc':
    case 'h265':
      return 'hvc1.1.6.L120.90'
    case 'vp9':
      return 'vp09.00.40.08'
    case 'vp8':
      return 'vp8'
    case 'av1':
      return 'av01.0.08M.08'
    default:
      return undefined
  }
}

export function audioCodecString(codec: string | undefined): string | undefined {
  switch ((codec ?? '').toLowerCase()) {
    case 'aac':
      return 'mp4a.40.2'
    case 'mp3':
      return 'mp4a.69'
    case 'ac3':
      return 'ac-3'
    case 'eac3':
      return 'ec-3'
    case 'opus':
      return 'opus'
    case 'flac':
      return 'flac'
    case 'vorbis':
      return 'vorbis'
    default:
      return undefined
  }
}

/** The audio stream a `<video>` element plays without track switching: the default one, else the first. */
export function browserDefaultAudio(tracks: MediaTrack[]): MediaTrack | undefined {
  const audio = tracks.filter((t) => t.kind === 'audio')
  return audio.find((t) => t.isDefault) ?? audio[0]
}

export function subtitleDelivery(subtitle: MediaTrack | undefined, textFailed: boolean): SubtitleDelivery {
  if (!subtitle) return { kind: 'none' }
  if (isTextSubtitle(subtitle) && !textFailed) return { kind: 'text', streamId: subtitle.id }
  return { kind: 'burn', streamId: subtitle.id }
}

/**
 * Direct play needs a container and codecs the browser plays, the chosen audio being the
 * one it plays by default (or track switching), and no burned-in subtitles. Anything else
 * goes through the Plex transcoder, which copies what it can (direct stream).
 */
export function planPlayback(input: {
  media: PlexMedia | undefined
  part: PlexPart | undefined
  tracks: MediaTrack[]
  audio: MediaTrack | undefined
  subtitle: MediaTrack | undefined
  capabilities: BrowserCapabilities
  /** Text subtitles of this stream could not be fetched: burn them in instead. */
  textSubtitleFailed?: boolean
  forceTranscode?: boolean
}): PlaybackPlan {
  const subtitles = subtitleDelivery(input.subtitle, input.textSubtitleFailed ?? false)
  const transcode = (reason: string): PlaybackPlan => ({ mode: 'transcode', subtitles, reason })
  if (input.forceTranscode) return transcode('выбрано транскодирование')
  const { media, part } = input
  if (!media || !part) return transcode('нет сведений о файле')
  const mime = containerMime(part.container ?? media.container)
  if (!mime) return transcode(`контейнер ${part.container ?? media.container ?? '?'}`)
  const video = videoCodecString(media.videoCodec)
  if (!video) return transcode(`видео ${media.videoCodec ?? '?'}`)
  const codecs = [video]
  if (input.audio) {
    const audio = audioCodecString(input.audio.codec)
    if (!audio) return transcode(`звук ${input.audio.codec ?? '?'}`)
    codecs.push(audio)
    const playsByDefault = browserDefaultAudio(input.tracks)?.id === input.audio.id
    if (!playsByDefault && !input.capabilities.audioTrackSwitching) return transcode('выбрана не основная дорожка')
  }
  if (!input.capabilities.canPlay(`${mime}; codecs="${codecs.join(', ')}"`)) {
    return transcode('браузер не воспроизводит эти кодеки')
  }
  if (subtitles.kind === 'burn') return transcode('графические субтитры')
  return { mode: 'direct', subtitles, reason: 'исходный файл' }
}
