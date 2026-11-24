import { isRecord } from './http'
import { isYouTubeID, type TrailerVideo } from './detectorClient'

/**
 * YouTube's embedded player of a video, in `language`. `enablejsapi=1` and the page's `origin`
 * let the player tell the page about its errors over postMessage (see `parseYouTubeMessage`).
 */
export function youTubeEmbedURL(base: string, video: TrailerVideo, language: string, origin: string): string {
  const lang = isYouTubeID(language) ? language : 'ru'
  const query = new URLSearchParams({ autoplay: '1', playsinline: '1', rel: '0', hl: lang, cc_lang_pref: lang, enablejsapi: '1', origin })
  return `${base}/embed/${encodeURIComponent(video.key)}?${query}`
}

/**
 * What the page says to the embedded player, as YouTube's IFrame Player API (www-widgetapi.js)
 * does: «listening» (until the player answers), then a subscription to its errors. The player then
 * posts JSON strings like `{"event":"onError","info":150,"id":1,"channel":"widget"}`.
 * Only checked against the fake YouTube of the smoke test: the tests never reach the real one.
 */
export function youTubeHandshake(id: number): string[] {
  return [
    JSON.stringify({ event: 'listening', id, channel: 'widget' }),
    JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onError'], id, channel: 'widget' }),
  ]
}

export interface YouTubeEvent {
  event: string
  info: unknown
}

/** A message of the embedded player (a JSON string, or an object), or null for anything else. */
export function parseYouTubeMessage(data: unknown): YouTubeEvent | null {
  let value = data
  if (typeof data === 'string') {
    try {
      value = JSON.parse(data)
    } catch {
      return null
    }
  }
  if (!isRecord(value) || typeof value.event !== 'string') return null
  return { event: value.event, info: value.info }
}

/**
 * Why a trailer isn't playing in the page: YouTube can't be reached (offline, blocked) — the frame
 * would show the browser's error page — or its player refused the video (its error code: 2, 5,
 * 100, 101, 150, 153).
 */
export type TrailerFailure = { kind: 'network' } | { kind: 'player'; code: number }

export const TrailerText = {
  network: 'Трейлер не загрузился: нет связи с YouTube.',
  // 101/150: YouTube's own refusal. Its author may forbid embedding, but YouTube answers 150 to
  // its «confirm you're not a bot» sign-in wall too (seen for an embeddable Blender film), and
  // to a video blocked in the viewer's country: the text names no cause.
  notEmbeddable: 'YouTube не показывает это видео здесь — откройте его в YouTube.',
  removed: 'Это видео удалено или скрыто.',
  playerError: 'YouTube не смог показать это видео.',
  retry: 'Повторить',
  openInYouTube: 'Открыть в YouTube',
}

export function trailerFailureText(failure: TrailerFailure): string {
  if (failure.kind === 'network') return TrailerText.network
  if (failure.code === 101 || failure.code === 150) return TrailerText.notEmbeddable
  if (failure.code === 100) return TrailerText.removed
  return TrailerText.playerError
}
