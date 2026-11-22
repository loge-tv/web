import type { DiscoverUserState } from './plexDiscover'
import { russianDate } from './plexDiscover'
import { isWatched, type PlexItem } from './plexModels'

// Port of SkipTVKit's ShowCatalog.swift.

/**
 * A season or an episode on a show page: on the server (playable, deletable), only in the Plex
 * catalog (shown greyed, its watch mark from the account), or both.
 */
export interface ShowEntry {
  /** The server's item; undefined when only the catalog has it. */
  server?: PlexItem
  /** The catalog's item with the same number. */
  catalog?: PlexItem
  /** The account's watch state of `catalog` (`/library/metadata/<keys>/userState`). */
  catalogState?: DiscoverUserState
}

/** The server's ratingKey; catalog-only entries get theirs prefixed so the two never clash. */
export function entryID(entry: ShowEntry): string {
  if (entry.server) return entry.server.ratingKey
  return `catalog:${entry.catalog?.ratingKey ?? ''}`
}

/** What the page shows: the server's item when there is one. */
export function entryItem(entry: ShowEntry): PlexItem {
  return entry.server ?? entry.catalog ?? { ratingKey: '', key: '', type: 'other', title: '', media: [] }
}

export function isDownloaded(entry: ShowEntry): boolean {
  return entry.server !== undefined
}

function catalogComplete(item: PlexItem, state: DiscoverUserState | undefined): boolean {
  if (!state) return false
  if (state.viewState === 'complete') return true
  const leaves = item.leafCount
  if (leaves === undefined || leaves <= 0 || state.viewedLeafCount === undefined) return false
  return state.viewedLeafCount >= leaves
}

/**
 * Watched. An episode: the server's own state when downloaded, else the account's. A season:
 * every episode, the ones not downloaded counted by the account's state.
 */
export function entryWatched(entry: ShowEntry): boolean {
  const item = entryItem(entry)
  if (item.type === 'season' || item.type === 'show') {
    const catalogDone = entry.catalog ? catalogComplete(entry.catalog, entry.catalogState) : false
    const server = entry.server
    if (!server) return catalogDone
    if (!isWatched(server)) return false
    // The catalog knows episodes the server lacks: those must be watched too. Whether the
    // account's count includes the server's plays is not known: the server's watched ones plus
    // the account's must cover the catalog's (exact once the season is open).
    const all = entry.catalog?.leafCount
    const here = server.leafCount
    if (all !== undefined && here !== undefined && all > here) {
      return catalogDone || (entry.catalogState?.viewedLeafCount ?? 0) + here >= all
    }
    return true
  }
  if (entry.server) return isWatched(entry.server)
  const state = entry.catalogState
  if (!state) return false
  return state.viewState === 'complete' || (state.viewCount ?? 0) > 0
}

/**
 * The server's seasons (or a season's episodes) with the catalog's, matched by number.
 * Catalog-only ones take their place by number; items without a number keep the server's order
 * after the numbered ones. Without the catalog (old agents, Plex down) it is the server's list as
 * it was.
 */
export function mergeShowCatalog(server: PlexItem[], catalog: PlexItem[], states: Map<string, DiscoverUserState> = new Map()): ShowEntry[] {
  const byIndex = new Map<number, PlexItem>()
  for (const item of catalog) {
    if (item.index === undefined || byIndex.has(item.index)) continue
    byIndex.set(item.index, item)
  }
  const used = new Set<number>()
  const entries: ShowEntry[] = server.map((item) => {
    const match = item.index !== undefined ? byIndex.get(item.index) : undefined
    if (!match || item.index === undefined) return { server: item }
    used.add(item.index)
    return { server: item, catalog: match, catalogState: states.get(match.ratingKey) }
  })
  for (const [index, item] of byIndex) {
    if (used.has(index) || server.some((s) => s.index === index)) continue
    entries.push({ catalog: item, catalogState: states.get(item.ratingKey) })
  }
  // Stable: numbered by number, the rest after them in the server's order.
  return entries
    .map((entry, offset) => ({ entry, offset }))
    .sort((a, b) => {
      const ia = entryItem(a.entry).index ?? Number.MAX_SAFE_INTEGER
      const ib = entryItem(b.entry).index ?? Number.MAX_SAFE_INTEGER
      return ia !== ib ? ia - ib : a.offset - b.offset
    })
    .map((x) => x.entry)
}

/** Under a catalog-only episode: «Нет на сервере · 3 марта 2024», or «Выйдет 12 марта 2027». */
export function catalogEpisodeCaption(item: PlexItem, today: string): string {
  const value = item.originallyAvailableAt
  if (!value || value.length < 10) return 'Нет на сервере'
  const day = value.slice(0, 10)
  const date = russianDate(day)
  if (!date) return 'Нет на сервере'
  return day > today ? `Выйдет ${date}` : `Нет на сервере · ${date}`
}
