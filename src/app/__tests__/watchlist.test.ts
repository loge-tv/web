import { describe, expect, it } from 'vitest'
import { makeDiscoverItem, PlexDiscoverAPI } from '../../core/plexDiscover'
import { makeItem } from '../../core/plexModels'
import { PlexServerAPI } from '../../core/plexServerAPI'
import { MockFetch, testClient } from '../../core/__tests__/support'
import { libraryEntry, Watchlist, watchlistShelves } from '../watchlist'

const listJSON = (keys: string[]) =>
  JSON.stringify({
    MediaContainer: { totalSize: keys.length, Metadata: keys.map((k) => ({ ratingKey: k, type: 'movie', title: k, year: 2020 })) },
  })

const statesPath = (keys: string[]) => `/library/metadata/${keys.join(',')}/userState`

function setUp(keys: string[] = ['a', 'b', 'c']) {
  const discover = new MockFetch()
  discover.stub('/library/sections/watchlist/all', listJSON(keys))
  discover.stub(statesPath(keys), JSON.stringify({ MediaContainer: { UserState: [] } }))
  discover.stub('/actions/addToWatchlist', '')
  discover.stub('/actions/removeFromWatchlist', '')
  const pms = new MockFetch()
  pms.stub('/library/sections/1/all', JSON.stringify({ MediaContainer: { Metadata: [{ ratingKey: '7', type: 'movie', title: 'B', guid: 'plex://movie/b' }] } }))
  const watchlist = new Watchlist()
  const api = new PlexDiscoverAPI('user-token', testClient, discover.fetch)
  const server = new PlexServerAPI('http://pms', 'server-token', testClient, pms.fetch)
  watchlist.configure(api, server, [{ key: '1', title: 'Фильмы', type: 'movie' }])
  return { watchlist, discover }
}

const keys = (w: Watchlist) => w.getSnapshot().items.map((i) => i.ratingKey)

describe('Watchlist', () => {
  it('adds at once, first', async () => {
    const { watchlist, discover } = setUp()
    await watchlist.load()
    const adding = watchlist.toggle(makeDiscoverItem({ ratingKey: 'n', kind: 'movie', title: 'N' }))
    expect(keys(watchlist)).toEqual(['n', 'a', 'b', 'c'])
    await adding
    expect(discover.last.method).toBe('PUT')
    expect(watchlist.getSnapshot().failure).toBeUndefined()
  })

  it('a refused add is taken back and explained', async () => {
    const { watchlist, discover } = setUp()
    await watchlist.load()
    discover.stub('/actions/addToWatchlist', '', 500)
    await watchlist.toggle(makeDiscoverItem({ ratingKey: 'n', kind: 'movie', title: 'Дюна' }))
    expect(keys(watchlist)).toEqual(['a', 'b', 'c'])
    expect(watchlist.getSnapshot().failure).toBe('Не удалось добавить «Дюна» в список. Проверьте подключение к интернету.')
    watchlist.dismissFailure()
    expect(watchlist.getSnapshot().failure).toBeUndefined()
  })

  it('a refused removal puts the title back where it was', async () => {
    const { watchlist, discover } = setUp()
    await watchlist.load()
    discover.stub('/actions/removeFromWatchlist', '', 500)
    const removing = watchlist.toggle(watchlist.getSnapshot().items[1])
    expect(keys(watchlist)).toEqual(['a', 'c'])
    await removing
    expect(keys(watchlist)).toEqual(['a', 'b', 'c'])
    expect(watchlist.getSnapshot().failure).toBe('Не удалось убрать «b» из списка. Проверьте подключение к интернету.')
  })

  it('a second click waits for the first answer', async () => {
    const { watchlist, discover } = setUp()
    await watchlist.load()
    const entry = makeDiscoverItem({ ratingKey: 'n', kind: 'movie', title: 'N' })
    const first = watchlist.toggle(entry)
    await watchlist.toggle(entry)
    await first
    expect(discover.requests.filter((r) => r.method === 'PUT')).toHaveLength(1)
    expect(keys(watchlist)).toContain('n')
  })

  it('answers for a previous account are dropped', async () => {
    const { watchlist } = setUp()
    const loading = watchlist.load()
    watchlist.configure(undefined, undefined, [])
    await loading
    expect(watchlist.getSnapshot().items).toEqual([])
    expect(watchlist.getSnapshot().loaded).toBe(false)
  })

  it('watched titles leave the shelf; without an answer the last known state stays', async () => {
    const { watchlist, discover } = setUp()
    discover.stub(statesPath(['a', 'b', 'c']), '', 500)
    await watchlist.load()
    await watchlist.refreshIndex()
    // A failed /userState doesn't fail the list.
    expect(watchlist.getSnapshot().loaded).toBe(true)
    expect(watchlistShelves(watchlist.getSnapshot(), '2026-11-22').wanted.map((i) => i.ratingKey)).toEqual(['a', 'c'])
    discover.stub(statesPath(['a', 'b', 'c']), JSON.stringify({ MediaContainer: { UserState: [{ ratingKey: 'a', viewCount: 1 }] } }))
    await watchlist.load()
    expect(watchlistShelves(watchlist.getSnapshot(), '2026-11-22').wanted.map((i) => i.ratingKey)).toEqual(['c'])
    discover.stub(statesPath(['a', 'b', 'c']), '', 500)
    await watchlist.load()
    expect(watchlistShelves(watchlist.getSnapshot(), '2026-11-22').wanted.map((i) => i.ratingKey)).toEqual(['c'])
  })

  it('shelves wait for both the list and the index, then drop what the server has', async () => {
    const { watchlist } = setUp()
    await watchlist.load()
    expect(watchlistShelves(watchlist.getSnapshot(), '2026-11-22').wanted).toEqual([])
    await watchlist.refreshIndex()
    expect(watchlistShelves(watchlist.getSnapshot(), '2026-11-22').wanted.map((i) => i.ratingKey)).toEqual(['a', 'c'])
  })

  it('library titles get a list entry once the list is in, if the catalog knows them', async () => {
    const { watchlist } = setUp()
    const modern = makeItem({ ratingKey: '7', type: 'movie', title: 'B', guid: 'plex://movie/b' })
    const old = makeItem({ ratingKey: '8', type: 'movie', title: 'C', guid: 'com.plexapp.agents.imdb://tt1' })
    const season = makeItem({ ratingKey: '9', type: 'season', title: 'Сезон 1', guid: 'plex://season/s' })
    expect(libraryEntry(watchlist.getSnapshot(), modern)).toBeUndefined() // not loaded yet
    await watchlist.loadIfNeeded()
    expect(libraryEntry(watchlist.getSnapshot(), modern)?.ratingKey).toBe('b')
    expect(libraryEntry(watchlist.getSnapshot(), old)).toBeUndefined()
    expect(libraryEntry(watchlist.getSnapshot(), season)).toBeUndefined()
  })
})
