import { useSyncExternalStore } from 'react'
import { DEFAULT_DETECTOR } from './config'
import type { WatchlistShelves } from './core/catalogMatch'
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
  /**
   * Home shelves turned off. Stored as the hidden ones, so a shelf added later is on by
   * default.
   */
  hiddenShelves: HomeShelf[]
}

/** Shelves of the home page that can be turned off in settings (same ids as the Apple app). */
export type HomeShelf = 'wanted' | 'upcoming'

export const homeShelves: { id: HomeShelf; title: string; detail: string }[] = [
  { id: 'wanted', title: 'Хочу посмотреть', detail: 'Из списка Plex: вышло, но нет на сервере и ещё не просмотрено.' },
  { id: 'upcoming', title: 'Ещё не вышло', detail: 'Из списка Plex: ещё не вышло, ближайшее первым.' },
]

export const countdownOptions = [5, 10, 15]
export const seekBackOptions = [5, 10, 15, 30]
export const seekForwardOptions = [5, 10, 15, 30, 60]

export const defaultDetectorURL = DEFAULT_DETECTOR ?? DEFAULT_DETECTOR_URL

const defaults: Settings = {
  skipMode: 'countdown',
  autoplayNext: true,
  nextEpisodeCountdown: 5,
  seekBack: 5,
  seekForward: 5,
  detectorURL: defaultDetectorURL,
  preferredConnection: '',
  forceTranscode: false,
  hiddenShelves: [],
}

/** Stored settings over the defaults; values that make no sense fall back to the default. */
export function parseSettings(raw: unknown): Settings {
  const stored = typeof raw === 'object' && raw !== null ? (raw as Partial<Settings>) : {}
  const s = { ...defaults, ...stored }
  if (!skipModes.includes(s.skipMode)) s.skipMode = defaults.skipMode
  if (!(s.nextEpisodeCountdown > 0)) s.nextEpisodeCountdown = defaults.nextEpisodeCountdown
  if (!(s.seekBack > 0)) s.seekBack = defaults.seekBack
  if (!(s.seekForward > 0)) s.seekForward = defaults.seekForward
  if (typeof s.detectorURL !== 'string' || !s.detectorURL) s.detectorURL = defaults.detectorURL
  s.hiddenShelves = Array.isArray(s.hiddenShelves) ? homeShelves.map((h) => h.id).filter((id) => s.hiddenShelves.includes(id)) : []
  return s
}

export function shelfShown(settings: Settings, shelf: HomeShelf): boolean {
  return !settings.hiddenShelves.includes(shelf)
}

/** `hidden` with `shelf` turned on or off, in the order of `homeShelves`. */
export function withShelfShown(hidden: HomeShelf[], shelf: HomeShelf, shown: boolean): HomeShelf[] {
  return homeShelves.map((h) => h.id).filter((id) => (id === shelf ? !shown : hidden.includes(id)))
}

/** The shelves Home shows: the ones turned off are empty (search shows the whole list). */
export function visibleShelves(shelves: WatchlistShelves, settings: Settings): WatchlistShelves {
  return {
    wanted: shelfShown(settings, 'wanted') ? shelves.wanted : [],
    upcoming: shelfShown(settings, 'upcoming') ? shelves.upcoming : [],
  }
}

let current = parseSettings(readJSON(StorageKey.settings))
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
  setShelfShown(shelf: HomeShelf, shown: boolean) {
    settingsStore.update({ hiddenShelves: withShelfShown(current.hiddenShelves, shelf, shown) })
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
