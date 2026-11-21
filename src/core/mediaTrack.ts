import type { PlexPart, PlexStream } from './plexModels'

export type TrackKind = 'audio' | 'sub' | 'video'

/** Audio or subtitle track of the file being played (from Plex streams). */
export interface MediaTrack {
  /** Plex stream id. */
  id: number
  kind: TrackKind
  language?: string
  title?: string
  codec?: string
  channels?: number
  isDefault: boolean
  isForced: boolean
  /** Sidecar file next to the media (subtitles). */
  isExternal: boolean
}

export function track(fields: Partial<MediaTrack> & { id: number; kind: TrackKind }): MediaTrack {
  return { isDefault: false, isForced: false, isExternal: false, ...fields }
}

export const Language = {
  russian: new Set(['ru', 'rus', 'russian', 'ru-ru']),

  names: {
    ru: 'Русский', rus: 'Русский',
    en: 'Английский', eng: 'Английский',
    uk: 'Украинский', ukr: 'Украинский',
    ja: 'Японский', jpn: 'Японский',
    ko: 'Корейский', kor: 'Корейский',
    de: 'Немецкий', ger: 'Немецкий', deu: 'Немецкий',
    fr: 'Французский', fre: 'Французский', fra: 'Французский',
    es: 'Испанский', spa: 'Испанский',
    it: 'Итальянский', ita: 'Итальянский',
    zh: 'Китайский', chi: 'Китайский', zho: 'Китайский',
    tr: 'Турецкий', tur: 'Турецкий',
    pl: 'Польский', pol: 'Польский',
    pt: 'Португальский', por: 'Португальский',
  } as Record<string, string>,

  isRussian(code: string | undefined | null): boolean {
    if (!code) return false
    return Language.russian.has(code.toLowerCase())
  },

  name(code: string | undefined | null): string | undefined {
    if (!code || code.toLowerCase() === 'und') return undefined
    return Language.names[code.toLowerCase()] ?? code
  },

  /** "ru" and "rus" are the same language; unknown codes compare as written. */
  same(a: string | undefined | null, b: string | undefined | null): boolean {
    const x = a?.toLowerCase() ?? ''
    const y = b?.toLowerCase() ?? ''
    if (!x || !y) return !x && !y
    return x === y || (Language.names[x] !== undefined && Language.names[x] === Language.names[y])
  },
}

export function isRussian(t: MediaTrack): boolean {
  return Language.isRussian(t.language)
}

export function codecName(codec: string): string {
  switch (codec.toLowerCase()) {
    case 'truehd': return 'TrueHD'
    case 'eac3': return 'E-AC3'
    case 'ac3': return 'AC3'
    case 'dts': return 'DTS'
    case 'aac': return 'AAC'
    case 'flac': return 'FLAC'
    case 'opus': return 'Opus'
    case 'mp3': return 'MP3'
    case 'subrip':
    case 'srt': return 'SRT'
    case 'hdmv_pgs_subtitle':
    case 'pgs':
    case 'pgssub': return 'PGS'
    case 'ass':
    case 'ssa': return 'ASS'
    case 'dvd_subtitle':
    case 'vobsub': return 'VobSub'
    case 'webvtt':
    case 'vtt': return 'WebVTT'
    case 'mov_text': return 'Text'
    default: return codec.toUpperCase()
  }
}

export function channelLayout(channels: number): string {
  switch (channels) {
    case 1: return '1.0'
    case 2: return '2.0'
    case 6: return '5.1'
    case 8: return '7.1'
    default: return `${channels}ch`
  }
}

/** "Русский · DTS-HD MA 5.1 · Дубляж" */
export function trackDisplayName(t: MediaTrack): string {
  const parts = [Language.name(t.language) ?? `Дорожка ${t.id}`]
  if (t.codec && t.kind === 'audio') {
    let c = codecName(t.codec)
    if (t.channels !== undefined) c += ' ' + channelLayout(t.channels)
    parts.push(c)
  } else if (t.codec && t.kind === 'sub') {
    parts.push(codecName(t.codec))
  }
  if (t.title && t.title.toLowerCase() !== (Language.name(t.language) ?? '').toLowerCase()) {
    parts.push(t.title)
  }
  if (t.isForced) parts.push('форсированные')
  return parts.join(' · ')
}

/** Audio and subtitle tracks of a part, in file order. */
export function tracksFromPart(part: PlexPart | undefined): MediaTrack[] {
  if (!part) return []
  return part.streams
    .filter((s) => s.streamType === 2 || s.streamType === 3)
    .map((s: PlexStream) =>
      track({
        id: Number(s.id),
        kind: s.streamType === 2 ? 'audio' : 'sub',
        language: s.languageCode,
        title: s.title,
        codec: s.codec,
        channels: s.channels,
        isDefault: s.isDefault,
        isForced: s.isForced || /forced|форс/i.test(s.title ?? ''),
        isExternal: !!s.key,
      }),
    )
}

export const TrackSelector = {
  /** Russian audio first; otherwise what the file marks as default; otherwise the first. */
  defaultAudio(tracks: MediaTrack[]): MediaTrack | undefined {
    const audio = tracks.filter((t) => t.kind === 'audio')
    const russian = audio.filter(isRussian)
    // Several Russian dubs: prefer the file default among them, then the first.
    return russian.find((t) => t.isDefault) ?? russian[0] ?? audio.find((t) => t.isDefault) ?? audio[0]
  },

  /**
   * With Russian audio: only forced Russian subtitles (signs, foreign speech).
   * Without Russian audio: full Russian subtitles if present.
   */
  defaultSubtitle(tracks: MediaTrack[], audio: MediaTrack | undefined): MediaTrack | undefined {
    const subs = tracks.filter((t) => t.kind === 'sub' && isRussian(t))
    if (audio && isRussian(audio)) {
      return subs.find((t) => t.isForced)
    }
    return subs.find((t) => !t.isForced) ?? subs[0]
  },
}
