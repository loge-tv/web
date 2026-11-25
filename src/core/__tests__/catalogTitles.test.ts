import { describe, expect, it } from 'vitest'
import { CatalogTitles, titleQuery, type TitleEntry } from '../catalogTitles'
import { makeDiscoverItem, PlexDiscoverAPI, type DiscoverItem } from '../plexDiscover'
import type { TitleName, TitleQuery } from '../tmdbClient'
import { MockFetch, testClient } from './support'

const movie = (title: string, year?: number, extra: Partial<DiscoverItem> = {}) =>
  makeDiscoverItem({ ratingKey: `k-${title}`, kind: 'movie', title, year, ...extra })

function memoryStore() {
  let saved: Record<string, TitleEntry> | undefined
  return {
    load: () => saved,
    save: (entries: Record<string, TitleEntry>) => {
      saved = JSON.parse(JSON.stringify(entries))
    },
    get saved() {
      return saved
    },
  }
}

describe('CatalogTitles', () => {
  it('Russian names for English titles, Plex’s own kept; what has no name stays', async () => {
    const asked: TitleQuery[][] = []
    const titles = new CatalogTitles(async (queries) => {
      asked.push(queries)
      return queries.map((q): TitleName => (q.title === 'Soulm8te' ? { tmdbId: 1, title: 'СОУЛМ8ЙТ', failed: false } : { failed: false }))
    })
    const items = [movie('Soulm8te', 2026), movie('Nobody Knows', 2001), movie('Тьма', 2017), movie('No Year')]
    const named = await titles.localize(items)
    expect(named.map((i) => i.title)).toEqual(['СОУЛМ8ЙТ', 'Nobody Knows', 'Тьма', 'No Year'])
    expect(named[0].catalogTitle).toBe('Soulm8te')
    expect(named[1].catalogTitle).toBeUndefined()
    // Russian already, or neither a year nor a TMDB id: not asked.
    expect(asked).toEqual([[{ kind: 'movie', year: 2026, tmdbId: undefined, title: 'Soulm8te' }, { kind: 'movie', year: 2001, tmdbId: undefined, title: 'Nobody Knows' }]])
    // Known now, hits and misses: not asked again.
    await titles.localize(items)
    expect(asked).toHaveLength(1)
  })

  it('a new season standing for its show is not named (its year is the season’s)', () => {
    expect(titleQuery(makeDiscoverItem({ ratingKey: 's', kind: 'show', title: 'Dark', year: 2020, season: 3 }))).toBeUndefined()
    expect(titleQuery(makeDiscoverItem({ ratingKey: 's', kind: 'show', title: 'Dark', guids: ['tmdb://70523'] }))?.query).toEqual({
      kind: 'tv',
      year: undefined,
      tmdbId: 70523,
      title: 'Dark',
    })
  })

  it('a slow answer: the list shows as it is, the name comes next time', async () => {
    let release!: () => void
    const titles = new CatalogTitles(
      (queries) => new Promise((resolve) => (release = () => resolve(queries.map(() => ({ title: 'Имя', failed: false }))))),
      undefined,
      20,
    )
    expect((await titles.localize([movie('Name', 2020)])).map((i) => i.title)).toEqual(['Name'])
    // Known names only, without waiting: still asking.
    expect((await titles.localize([movie('Name', 2020)], 0)).map((i) => i.title)).toEqual(['Name'])
    release()
    await new Promise((r) => setTimeout(r, 0))
    expect(titles.known([movie('Name', 2020)]).map((i) => i.title)).toEqual(['Имя'])
  })

  it('a refusal pauses asking for a few minutes; `failed` items are asked again', async () => {
    let now = 0
    let calls = 0
    let answer: (q: TitleQuery[]) => Promise<TitleName[]> = async () => {
      throw new Error('429')
    }
    const titles = new CatalogTitles(
      (q) => {
        calls += 1
        return answer(q)
      },
      undefined,
      4000,
      () => now,
    )
    await titles.localize([movie('A', 2000)])
    await titles.localize([movie('A', 2000)])
    expect(calls).toBe(1)
    now += CatalogTitles.failurePauseMs
    answer = async (q) => q.map(() => ({ failed: true }))
    await titles.localize([movie('A', 2000)])
    await titles.localize([movie('A', 2000)])
    expect(calls).toBe(3)
  })

  it('names are kept in the store, a month for a name and a day for none; 60 asked at a time', async () => {
    let now = 0
    const store = memoryStore()
    const sizes: number[] = []
    const lookup = async (queries: TitleQuery[]) => {
      sizes.push(queries.length)
      return queries.map((q): TitleName => ({ title: q.title === 'T0' ? 'Т0' : undefined, failed: false }))
    }
    const items = Array.from({ length: 61 }, (_, i) => movie(`T${i}`, 2000))
    await new CatalogTitles(lookup, store, 4000, () => now).localize(items)
    expect(sizes).toEqual([60, 1])
    // Another visit: from the store, nothing asked.
    const again = new CatalogTitles(lookup, store, 4000, () => now)
    expect((await again.localize(items.slice(0, 2))).map((i) => i.title)).toEqual(['Т0', 'T1'])
    expect(sizes).toHaveLength(2)
    // A day later the miss is asked again, the name is not.
    now += 86_400_000 + 1
    await new CatalogTitles(lookup, store, 4000, () => now).localize(items.slice(0, 2))
    expect(sizes).toEqual([60, 1, 1])
  })

  it('the catalog client names what it lists, only in Russian', async () => {
    const discover = new MockFetch()
    discover.stub('/hubs/sections/home/trending-plex', JSON.stringify({ MediaContainer: { Metadata: [{ ratingKey: 'a', type: 'movie', title: 'Soulm8te', year: 2026 }] } }))
    const titles = new CatalogTitles(async (q) => q.map(() => ({ title: 'СОУЛМ8ЙТ', failed: false })))
    const russian = new PlexDiscoverAPI('user', testClient, discover.fetch, 'https://d.test', 'https://i.test', 'ru', titles)
    expect((await russian.hub('trending-plex')).map((i) => [i.title, i.catalogTitle])).toEqual([['СОУЛМ8ЙТ', 'Soulm8te']])
    const english = new PlexDiscoverAPI('user', testClient, discover.fetch, 'https://d.test', 'https://i.test', 'en', titles)
    expect((await english.hub('trending-plex')).map((i) => i.title)).toEqual(['Soulm8te'])
  })
})
