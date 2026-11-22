import { useSyncExternalStore } from 'react'
import { DEFAULT_DETECTOR } from './config'
import type { WatchlistShelves } from './core/catalogMatch'
import { DEFAULT_DETECTOR_URL } from './core/detectorClient'
import { Language } from './core/mediaTrack'
import { catalogHubs, type CatalogHub } from './core/plexDiscover'
import type { PlexLibrarySection } from './core/plexModels'
import { ShelfOrder } from './core/shelfOrder'
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
  /** Order of the home shelves set in settings (shelf ids); empty — the default. */
  shelfOrder: HomeShelf[]
  /** Collections of «Обзор» turned off. */
  hiddenHubs: CatalogHub[]
  /**
   * Language of the audio picked by default (the best track in it) and of trailers: an ISO
   * 639-1 code from `Language.choices`.
   */
  preferredLanguage: string
}

/**
 * Shelves of the home page, each can be turned off and moved in settings (ids as in the Apple
 * app): `continue`, `wanted`, `upcoming`, `recent:<section key>` (one per library),
 * `similarOnServer`, `because`, `moreWithCast`.
 */
export type HomeShelf = string

/** Shelves of TMDB and Plex recommendations: only while one is on, TMDB and Plex are asked. */
export const recommendationShelves: HomeShelf[] = ['similarOnServer', 'because', 'moreWithCast']

const fixedShelves: { id: HomeShelf; title: string; detail: string }[] = [
  { id: 'continue', title: 'Продолжить просмотр', detail: 'Начатое и следующие серии, что смотрели последним — первым.' },
  { id: 'wanted', title: 'Хочу посмотреть', detail: 'Из списка Plex: вышло, но нет на сервере и ещё не просмотрено.' },
  { id: 'upcoming', title: 'Ещё не вышло', detail: 'Из списка Plex: ещё не вышло, ближайшее первым.' },
  { id: 'similarOnServer', title: 'Похожее на сервере', detail: 'Рекомендации TMDB к недавно просмотренному, которые уже есть на сервере.' },
  { id: 'because', title: 'Потому что вы смотрели…', detail: 'Рекомендации TMDB к недавно просмотренному, которых нет на сервере.' },
  {
    id: 'moreWithCast',
    title: 'Ещё с этими актёрами',
    detail: 'Из каталога Plex: другие фильмы и сериалы актёров и создателей недавно просмотренного.',
  },
]

function isShelfID(id: unknown): id is HomeShelf {
  if (typeof id !== 'string') return false
  return fixedShelves.some((s) => s.id === id) || (id.startsWith('recent:') && id.length > 7)
}

/** The order before the user changes it. */
export function defaultShelfOrder(sections: PlexLibrarySection[]): HomeShelf[] {
  return ['continue', 'wanted', 'upcoming', ...sections.map((s) => `recent:${s.key}`), ...recommendationShelves]
}

/** Title and description of a shelf in settings: «Недавно добавлено · Фильмы». */
export function shelfInfo(id: HomeShelf, sections: PlexLibrarySection[]): { title: string; detail: string } {
  if (id.startsWith('recent:')) {
    const section = sections.find((s) => s.key === id.slice(7))
    return { title: section ? `Недавно добавлено · ${section.title}` : 'Недавно добавлено', detail: 'Новое в медиатеке на сервере.' }
  }
  const fixed = fixedShelves.find((s) => s.id === id)
  return fixed ? { title: fixed.title, detail: fixed.detail } : { title: id, detail: '' }
}

/** A stable order for the stored hidden ids: the fixed ones as listed, libraries by key. */
function canonical(ids: HomeShelf[]): HomeShelf[] {
  const rank = (id: HomeShelf) => {
    const fixed = ['continue', 'wanted', 'upcoming'].indexOf(id)
    if (fixed >= 0) return [fixed, '']
    if (id.startsWith('recent:')) return [3, id]
    return [4 + recommendationShelves.indexOf(id), '']
  }
  return [...new Set(ids)].sort((a, b) => {
    const [ra, ka] = rank(a)
    const [rb, kb] = rank(b)
    return ra !== rb ? (ra as number) - (rb as number) : (ka as string) < (kb as string) ? -1 : (ka as string) > (kb as string) ? 1 : 0
  })
}

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
  shelfOrder: [],
  hiddenHubs: [],
  // Russian until changed: the apps always picked Russian audio first.
  preferredLanguage: 'ru',
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
  s.hiddenShelves = Array.isArray(s.hiddenShelves) ? canonical(s.hiddenShelves.filter(isShelfID)) : []
  s.shelfOrder = Array.isArray(s.shelfOrder) ? [...new Set(s.shelfOrder.filter(isShelfID))] : []
  s.hiddenHubs = Array.isArray(s.hiddenHubs) ? catalogHubs.map((h) => h.id).filter((id) => s.hiddenHubs.includes(id)) : []
  if (typeof s.preferredLanguage !== 'string' || !Language.choices.includes(s.preferredLanguage)) s.preferredLanguage = defaults.preferredLanguage
  return s
}

export function shelfShown(settings: Settings, shelf: HomeShelf): boolean {
  return !settings.hiddenShelves.includes(shelf)
}

/** `hidden` with `shelf` turned on or off. */
export function withShelfShown(hidden: HomeShelf[], shelf: HomeShelf, shown: boolean): HomeShelf[] {
  return canonical(shown ? hidden.filter((id) => id !== shelf) : [...hidden, shelf])
}

/** The list shelves Home shows: the ones turned off are empty (search shows the whole list). */
export function visibleShelves(shelves: WatchlistShelves, settings: Settings): WatchlistShelves {
  return {
    wanted: shelfShown(settings, 'wanted') ? shelves.wanted : [],
    upcoming: shelfShown(settings, 'upcoming') ? shelves.upcoming : [],
  }
}

/** Every home shelf of this server (one «Недавно добавлено» per library), on or off, in the user's order. */
export function homeShelfOrder(settings: Settings, sections: PlexLibrarySection[]): HomeShelf[] {
  return ShelfOrder.arrange(settings.shelfOrder, defaultShelfOrder(sections))
}

/** The shelves Home shows, in order. */
export function visibleHomeShelves(settings: Settings, sections: PlexLibrarySection[]): HomeShelf[] {
  return homeShelfOrder(settings, sections).filter((id) => shelfShown(settings, id))
}

export function hasDefaultShelfOrder(settings: Settings, sections: PlexLibrarySection[]): boolean {
  return homeShelfOrder(settings, sections).join('|') === defaultShelfOrder(sections).join('|')
}

/** Either recommendation shelf is on: only then TMDB and Plex are asked. */
export function wantsRecommendations(settings: Settings): boolean {
  return recommendationShelves.some((id) => shelfShown(settings, id))
}

export function hubShown(settings: Settings, hub: CatalogHub): boolean {
  return !settings.hiddenHubs.includes(hub)
}

/** «Обзор» is there while any of its collections is on. */
export function showsExplore(settings: Settings): boolean {
  return catalogHubs.some((h) => hubShown(settings, h.id))
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
  /** Moves `shelf` one place up (−1) or down (+1); another server's libraries keep their places. */
  moveShelf(shelf: HomeShelf, offset: number, sections: PlexLibrarySection[]) {
    const order = homeShelfOrder(current, sections)
    const index = order.indexOf(shelf)
    if (index < 0) return
    settingsStore.update({ shelfOrder: ShelfOrder.save(ShelfOrder.move(order, index, offset), current.shelfOrder) })
  },
  resetShelfOrder() {
    settingsStore.update({ shelfOrder: [] })
  },
  setHubShown(hub: CatalogHub, shown: boolean) {
    const hidden = shown ? current.hiddenHubs.filter((h) => h !== hub) : [...current.hiddenHubs, hub]
    settingsStore.update({ hiddenHubs: catalogHubs.map((h) => h.id).filter((id) => hidden.includes(id)) })
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
