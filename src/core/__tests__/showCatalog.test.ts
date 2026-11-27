import { describe, expect, it } from 'vitest'
import { PlexDiscoverAPI, type DiscoverUserState } from '../plexDiscover'
import { parseItem, type PlexItem } from '../plexModels'
import { catalogEpisodeCaption, entryID, entryItem, entryWatched, isDownloaded, mergeShowCatalog } from '../showCatalog'
import { MockFetch, testClient } from './support'

// Port of the Apple app's ShowCatalogTests.swift.

const item = (raw: object): PlexItem => parseItem(raw)!
const season = (key: string, index: number, leaves: number, viewed = 0) =>
  item({ ratingKey: key, type: 'season', title: `Сезон ${index}`, index, leafCount: leaves, viewedLeafCount: viewed })
const episode = (key: string, index: number, watched = false) =>
  item({ ratingKey: key, type: 'episode', title: `Серия ${index}`, index, ...(watched ? { viewCount: 1 } : {}) })
const states = (entries: DiscoverUserState[]) => new Map(entries.map((s) => [s.ratingKey, s]))

describe('ShowCatalog', () => {
  it('seasons: server ones first matched by number, catalog-only after, watched counted with the account', () => {
    const server = [season('s0', 0, 2), season('s1', 1, 8, 8), season('s2', 2, 3, 3)]
    const catalog = [season('c1', 1, 8), season('c2', 2, 10), season('c3', 3, 6)]
    const merged = mergeShowCatalog(server, catalog, states([{ ratingKey: 'c2', viewedLeafCount: 4 }, { ratingKey: 'c3', viewedLeafCount: 6 }]))
    expect(merged.map(entryID)).toEqual(['s0', 's1', 's2', 'catalog:c3'])
    expect(merged.map(isDownloaded)).toEqual([true, true, true, false])
    // s1 all watched; s2: 3 downloaded watched but 4 of 10 on the account; c3: 6 of 6.
    expect(merged.map(entryWatched)).toEqual([false, true, false, true])
    expect(merged[1].catalog?.ratingKey).toBe('c1')
    // The 7 not downloaded marked on the account: season 2 is through.
    const through = mergeShowCatalog(server, catalog, states([{ ratingKey: 'c2', viewedLeafCount: 7 }]))
    expect(entryWatched(through[2])).toBe(true)
  })

  it('catalog seasons around the server\'s by number', () => {
    const merged = mergeShowCatalog([season('s2', 2, 1)], [season('c3', 3, 1), season('c1', 1, 1), season('c2', 2, 1)])
    expect(merged.map(entryID)).toEqual(['catalog:c1', 's2', 'catalog:c3'])
    expect(entryWatched(merged[0])).toBe(false)
  })

  it('without the catalog nothing changes; unnumbered after the numbered in the server\'s order', () => {
    expect(mergeShowCatalog([season('s2', 2, 1), season('s1', 1, 1)], []).map(entryID)).toEqual(['s1', 's2'])
    const odd = item({ ratingKey: 'x', type: 'episode', title: 'Без номера' })
    expect(mergeShowCatalog([odd, episode('e1', 1)], []).map(entryID)).toEqual(['e1', 'x'])
  })

  it('episodes: the server\'s state for downloaded ones, the account\'s for the rest', () => {
    const server = [episode('e1', 1, true), episode('e2', 2)]
    const catalog = [1, 2, 3, 4].map((i) => episode(`c${i}`, i))
    const merged = mergeShowCatalog(
      server,
      catalog,
      states([
        { ratingKey: 'c2', viewCount: 1 },
        { ratingKey: 'c3', viewCount: 2 },
        { ratingKey: 'c4', viewState: 'complete' },
      ]),
    )
    expect(merged.map(entryID)).toEqual(['e1', 'e2', 'catalog:c3', 'catalog:c4'])
    expect(merged.map(entryWatched)).toEqual([true, false, true, true])
    expect(entryItem(merged[2]).title).toBe('Серия 3')
  })

  it('captions of catalog episodes', () => {
    expect(catalogEpisodeCaption(item({ ratingKey: 'a', type: 'episode', title: 'x', originallyAvailableAt: '2024-03-09' }), '2026-11-22')).toBe('Нет на сервере · 9 марта 2024')
    expect(catalogEpisodeCaption(item({ ratingKey: 'b', type: 'episode', title: 'x', originallyAvailableAt: '2030-01-01' }), '2026-11-22')).toBe('Выйдет 1 января 2030')
    expect(catalogEpisodeCaption(item({ ratingKey: 'c', type: 'episode', title: 'x' }), '2026-11-22')).toBe('Нет на сервере')
  })

  it('metadata host next to Discover; another base serves both', () => {
    expect(new PlexDiscoverAPI('t', testClient).metadataBase).toBe('https://metadata.provider.plex.tv')
    expect(new PlexDiscoverAPI('t', testClient, undefined, 'http://127.0.0.1:5184').metadataBase).toBe('http://127.0.0.1:5184')
  })

  it('catalog children in the server\'s format; the scrobble goes to the metadata host', async () => {
    const mock = new MockFetch()
    mock.stub('/library/metadata/show/children', JSON.stringify({ MediaContainer: { size: 1, Metadata: [{ ratingKey: 'c1', type: 'season', title: 'Сезон 1', index: 1, leafCount: 8 }] } }))
    mock.stub('/actions/scrobble', '{}')
    const api = new PlexDiscoverAPI('t', testClient, mock.fetch)
    expect((await api.children('show'))[0].leafCount).toBe(8)
    await api.setWatched('c1', true)
    expect(mock.last.url.host).toBe('metadata.provider.plex.tv')
    expect(mock.last.url.searchParams.get('key')).toBe('c1')
    expect(mock.last.headers.get('X-Plex-Token')).toBe('t')
  })
})
