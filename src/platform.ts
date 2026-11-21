import { APP_NAME, APP_VERSION } from './config'
import type { PlexClientInfo } from './core/plexAccount'
import type { BrowserCapabilities } from './core/playbackPlan'
import { readString, StorageKey, writeString } from './storage'

function browserName(): string {
  const ua = navigator.userAgent
  if (/Edg\//.test(ua)) return 'Microsoft Edge'
  if (/OPR\//.test(ua)) return 'Opera'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Chrome\//.test(ua) || /CriOS\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return 'Chrome'
}

function osName(): string {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Android/.test(ua)) return 'Android'
  if (/Mac OS X/.test(ua)) return 'macOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Linux/.test(ua)) return 'Linux'
  return ''
}

export const isSafari = browserName() === 'Safari'
export const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches

/** Stable per-browser id: Plex lists this browser as one device. */
function clientIdentifier(): string {
  let id = readString(StorageKey.clientIdentifier)
  if (!id) {
    id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
    writeString(StorageKey.clientIdentifier, id)
  }
  return id
}

export function makeClientInfo(): PlexClientInfo {
  const browser = browserName()
  return {
    clientIdentifier: clientIdentifier(),
    product: APP_NAME,
    version: APP_VERSION,
    platform: browser,
    platformVersion: '',
    device: osName() || 'Browser',
    deviceName: `${APP_NAME} (${browser})`,
  }
}

let probe: HTMLVideoElement | undefined

export const capabilities: BrowserCapabilities = {
  canPlay(mime: string) {
    probe ??= document.createElement('video')
    return probe.canPlayType(mime) !== ''
  },
  audioTrackSwitching: typeof HTMLMediaElement !== 'undefined' && 'audioTracks' in HTMLMediaElement.prototype,
}

/** Native HLS (Safari, iOS): preferred there over hls.js. */
export function nativeHLS(): boolean {
  probe ??= document.createElement('video')
  return isSafari && probe.canPlayType('application/vnd.apple.mpegurl') !== ''
}

export function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && !!document.documentElement.requestFullscreen && document.fullscreenEnabled
}

export function newSessionId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
