import { useSyncExternalStore } from 'react'
import { DEFAULT_DETECTOR } from './config'
import { DEFAULT_DETECTOR_URL } from './core/detectorClient'
import { skipModes, type SkipMode } from './core/skipPolicy'
import { readJSON, StorageKey, writeJSON } from './storage'

/** User preferences, persisted in localStorage. Same defaults as the tvOS app. */
export interface Settings {
  skipMode: SkipMode
  /** Autoplay the next episode when an episode ends (or its credits are auto-skipped). */
  autoplayNext: boolean
  /** Seconds of the "Next episode" countdown. */
  nextEpisodeCountdown: number
  /** ← step, seconds. */
  seekBack: number
  /** → step, seconds. */
  seekForward: number
  /** Detector service base URL. */
  detectorURL: string
  /** Preferred server connection URL (empty: automatic). */
  preferredConnection: string
  /** Always use the Plex transcoder (if direct play misbehaves in this browser). */
  forceTranscode: boolean
}

export const countdownOptions = [5, 10, 15]
export const seekBackOptions = [5, 10, 15, 30]
export const seekForwardOptions = [10, 15, 30, 60]

export const defaultDetectorURL = DEFAULT_DETECTOR ?? DEFAULT_DETECTOR_URL

const defaults: Settings = {
  skipMode: 'auto',
  autoplayNext: true,
  nextEpisodeCountdown: 5,
  seekBack: 10,
  seekForward: 30,
  detectorURL: defaultDetectorURL,
  preferredConnection: '',
  forceTranscode: false,
}

function load(): Settings {
  const stored = readJSON<Partial<Settings>>(StorageKey.settings) ?? {}
  const s = { ...defaults, ...stored }
  if (!skipModes.includes(s.skipMode)) s.skipMode = defaults.skipMode
  if (!(s.nextEpisodeCountdown > 0)) s.nextEpisodeCountdown = defaults.nextEpisodeCountdown
  if (!(s.seekBack > 0)) s.seekBack = defaults.seekBack
  if (!(s.seekForward > 0)) s.seekForward = defaults.seekForward
  if (typeof s.detectorURL !== 'string' || !s.detectorURL) s.detectorURL = defaults.detectorURL
  return s
}

let current = load()
const listeners = new Set<() => void>()

export const settingsStore = {
  get(): Settings {
    return current
  },
  update(change: Partial<Settings>) {
    current = { ...current, ...change }
    writeJSON(StorageKey.settings, current)
    listeners.forEach((l) => l())
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

export function useSettings(): Settings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get)
}
