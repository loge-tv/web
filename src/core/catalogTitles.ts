import type { DiscoverItem } from './plexDiscover'
import { discoverTmdbID } from './plexDiscover'
import { TMDBClient, type TitleName, type TitleQuery } from './tmdbClient'

/** The proxy's names for these queries, in order. Throws when it can't answer now. */
export type TitleLookup = (queries: TitleQuery[]) => Promise<TitleName[]>

/** Where the names are kept between visits. */
export interface TitleStore {
  load(): Record<string, TitleEntry> | undefined
  save(entries: Record<string, TitleEntry>): void
}

export interface TitleEntry {
  /** "": TMDB has no name in Russian (or the title wasn't found for sure). */
  title: string
  /** Unix ms. */
  expires: number
}

const DAY = 86_400_000

/**
 * Russian names of catalog titles Plex has only in English («Soulm8te» → «СОУЛМ8ЙТ»), from TMDB
 * through the TMDB proxy (`/v1/titles`); a port of the Apple app's `CatalogTitles`. Names are kept
 * in storage: known ones show at once; new ones are waited for at most `waitMs` before a list
 * shows as it is (the answer still lands in the store for next time). When the proxy can't answer,
 * titles stay as Plex gives them and it isn't asked again for a few minutes.
 */
export class CatalogTitles {
  static readonly hitTTL = 30 * DAY
  static readonly missTTL = DAY
  static readonly failurePauseMs = 5 * 60_000

  private entries?: Record<string, TitleEntry>
  private pausedUntil = 0
  /** Keys being asked now → the request asking them. */
  private asking = new Map<string, Promise<void>>()

  constructor(
    private readonly lookup: TitleLookup,
    private readonly store?: TitleStore,
    readonly waitMs = 4000,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * `items` with Russian names where one is known; the catalog's own name stays in
   * `catalogTitle` (matching library items by name uses it). New names are waited for at most
   * `waitMs` (0: known names only, as you type or for a long filmography); the lookup goes on for
   * next time either way.
   */
  async localize(items: DiscoverItem[], waitMs = this.waitMs): Promise<DiscoverItem[]> {
    const entries = this.load()
    const date = this.now()
    const missing = new Map<string, TitleQuery>()
    const pending: Promise<void>[] = []
    for (const item of items) {
      const q = titleQuery(item)
      if (!q) continue
      const entry = entries[q.key]
      if (entry && entry.expires > date) continue
      const asked = this.asking.get(q.key)
      if (asked) pending.push(asked)
      else missing.set(q.key, q.query)
    }
    if (missing.size > 0 && date >= this.pausedUntil) {
      const task = this.ask(missing)
      for (const key of missing.keys()) this.asking.set(key, task)
      pending.push(task)
    }
    if (pending.length > 0 && waitMs > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([Promise.all(pending), new Promise((resolve) => (timer = setTimeout(resolve, waitMs)))])
      clearTimeout(timer)
    }
    return this.known(items)
  }

  /** Names known for `items`, without asking. */
  known(items: DiscoverItem[]): DiscoverItem[] {
    const entries = this.load()
    const date = this.now()
    return items.map((item) => {
      const q = titleQuery(item)
      const entry = q ? entries[q.key] : undefined
      if (!entry || !entry.title || entry.expires <= date) return item
      return { ...item, catalogTitle: item.catalogTitle ?? item.title, title: entry.title }
    })
  }

  private async ask(wanted: Map<string, TitleQuery>): Promise<void> {
    const keys = [...wanted.keys()]
    let changed = false
    try {
      for (let start = 0; start < keys.length; start += TMDBClient.titlesPerRequest) {
        const part = keys.slice(start, start + TMDBClient.titlesPerRequest)
        let answers: TitleName[]
        try {
          answers = await this.lookup(part.map((k) => wanted.get(k)!))
        } catch (error) {
          console.warn('catalog titles', error)
          this.pausedUntil = this.now() + CatalogTitles.failurePauseMs
          break
        }
        const entries = this.load()
        const date = this.now()
        part.forEach((key, i) => {
          const answer = answers[i]
          if (!answer || answer.failed) return
          const title = answer.title && isRussian(answer.title) ? answer.title : ''
          entries[key] = { title, expires: date + (title ? CatalogTitles.hitTTL : CatalogTitles.missTTL) }
          changed = true
        })
      }
    } finally {
      for (const key of keys) this.asking.delete(key)
      if (changed) this.save()
    }
  }

  private load(): Record<string, TitleEntry> {
    if (this.entries) return this.entries
    const stored = this.store?.load()
    const date = this.now()
    const live: Record<string, TitleEntry> = {}
    if (stored && typeof stored === 'object') {
      for (const [key, entry] of Object.entries(stored)) {
        if (entry && typeof entry.title === 'string' && typeof entry.expires === 'number' && entry.expires > date) live[key] = entry
      }
    }
    this.entries = live
    return live
  }

  private save() {
    const date = this.now()
    const live = Object.fromEntries(Object.entries(this.load()).filter(([, e]) => e.expires > date))
    this.entries = live
    this.store?.save(live)
  }
}

/**
 * The store key and the proxy query of a title worth naming: a movie or show (not a new season
 * standing for its show: its year is the season's) named without Cyrillic, with a year or a
 * TMDB id.
 */
export function titleQuery(item: DiscoverItem): { key: string; query: TitleQuery } | undefined {
  const title = (item.catalogTitle ?? item.title).trim()
  if (!title || item.season !== undefined || isRussian(title)) return undefined
  const year = item.year ?? (item.originallyAvailableAt ? Number(item.originallyAvailableAt.slice(0, 4)) || undefined : undefined)
  const tmdbId = discoverTmdbID(item)
  if (year === undefined && tmdbId === undefined) return undefined
  const kind = item.kind === 'movie' ? 'movie' : 'tv'
  const folded = title.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  return { key: `${kind}|${year ?? 0}|${tmdbId ?? 0}|${folded}`, query: { kind, year, tmdbId, title } }
}

export function isRussian(text: string): boolean {
  return /[Ѐ-ӿ]/.test(text)
}
