import { describe, expect, it } from 'vitest'
import { PlexDiscoverAPI } from '../../core/plexDiscover'
import { PlexServerAPI } from '../../core/plexServerAPI'
import { TMDBClient } from '../../core/tmdbClient'
import { MockFetch, testClient } from '../../core/__tests__/support'
import { Explore } from '../explore'
import { CatalogMatchCache, Recommendations } from '../recommendations'
import { Watchlist } from '../watchlist'

const container = (Metadata: unknown[]) => JSON.stringify({ MediaContainer: { size: Metadata.length, Metadata } })

function setUp() {
  const pms = new MockFetch()
  pms.stub(
    '/library/sections/1/all',
    container([
      { ratingKey: '1', type: 'movie', title: 'Seed', guid: 'plex://movie/cat-seed', viewCount: 1, lastViewedAt: 10, Guid: [{ id: 'tmdb://1' }] },
      { ratingKey: '2', type: 'movie', title: 'Fresh', guid: 'plex://movie/cat-fresh', Guid: [{ id: 'tmdb://2' }] },
    ]),
  )
  pms.stub('/status/sessions/history/all', container([{ ratingKey: '1', type: 'movie', viewedAt: 10, accountID: 1 }]))
  const discover = new MockFetch()
  discover.stub('/library/sections/watchlist/all', container([]))
  discover.stub('/library/metadata/matches', container([{ ratingKey: 'cat-3', type: 'movie', title: 'Three (en)', year: 2003 }]))
  discover.stub('/library/metadata/cat-seed/more-from-credits', container([{ ratingKey: 'cat-4', type: 'show', title: 'Four', year: 2004 }]))
  discover.stub('/library/metadata/cat-3,cat-4/userState', JSON.stringify({ MediaContainer: { UserState: [] } }))
  const proxy = new MockFetch()
  proxy.stub(
    '/v1/recommendations',
    JSON.stringify({ items: [{ seed: 'movie:1', titles: [{ tmdbId: 2, type: 'movie', title: 'Fresh' }, { tmdbId: 3, type: 'movie', title: 'Три' }] }] }),
  )
  const api = new PlexDiscoverAPI('user', testClient, discover.fetch)
  const server = new PlexServerAPI('http://pms', 'srv', testClient, pms.fetch)
  const watchlist = new Watchlist()
  watchlist.configure(api, server, [{ key: '1', title: 'Фильмы', type: 'movie' }])
  const recommendations = new Recommendations()
  recommendations.configure(api, server, true, new TMDBClient('http://tmdb', 'client', proxy.fetch))
  return { pms, discover, proxy, watchlist, recommendations }
}

describe('Recommendations', () => {
  it('TMDB shelves through the proxy and Plex’s cast list', async () => {
    const { discover, proxy, watchlist, recommendations } = setUp()
    await recommendations.refresh(watchlist)
    const { shelves } = recommendations.getSnapshot()
    expect(proxy.last.headers.get('X-Plex-Token')).toBeNull()
    expect(shelves.onServer.map((i) => i.title)).toEqual(['Fresh'])
    expect(shelves.because.map((b) => b.items.map((i) => i.title))).toEqual([['Три']])
    expect(shelves.cast?.items.map((i) => i.ratingKey)).toEqual(['cat-4'])
    // Fresh asks again only when it is stale.
    const asked = discover.requests.length
    await recommendations.refresh(watchlist)
    expect(discover.requests.length).toBe(asked)
    // Deleted from the server: gone from «Похожее на сервере» at once.
    recommendations.forget(new Set(['2']))
    expect(recommendations.getSnapshot().shelves.onServer).toEqual([])
  })

  it('a refusal (404 too) is no «no key»: no TMDB shelves this time, the cast list still, asked again next time', async () => {
    const { proxy, watchlist, recommendations } = setUp()
    proxy.stub('/v1/recommendations', '{"error":"not found"}', 404)
    await recommendations.refresh(watchlist)
    const { shelves } = recommendations.getSnapshot()
    expect(shelves.onServer).toEqual([])
    expect(shelves.because).toEqual([])
    expect(shelves.cast?.items).toHaveLength(1)
    proxy.stub('/v1/recommendations', JSON.stringify({ items: [{ seed: 'movie:1', titles: [{ tmdbId: 3, type: 'movie', title: 'Три' }] }] }))
    await recommendations.refresh(watchlist)
    expect(recommendations.getSnapshot().shelves.because).toHaveLength(1)
  })

  it('the proxy down for a moment: the TMDB shelves stay', async () => {
    const { proxy, watchlist, recommendations } = setUp()
    await recommendations.refresh(watchlist)
    proxy.fail('/v1/recommendations')
    recommendations.expire()
    await recommendations.refresh(watchlist)
    expect(recommendations.getSnapshot().shelves.because).toHaveLength(1)
    expect(recommendations.getSnapshot().shelves.onServer).toHaveLength(1)
  })

  it('catalog matches are asked once, a few at a time, and kept', async () => {
    const discover = new MockFetch()
    discover.stub('/library/metadata/matches', '', 404)
    const api = new PlexDiscoverAPI('user', testClient, discover.fetch)
    const cache = new CatalogMatchCache('test-matches')
    const titles = Array.from({ length: 50 }, (_, i) => ({ tmdbId: i + 1, type: 'movie', title: `T${i}` }))
    expect(await cache.entries(titles, api)).toEqual({})
    // At most 45 per refresh; the rest next time.
    expect(discover.requests).toHaveLength(45)
    await cache.entries(titles, api)
    expect(discover.requests).toHaveLength(50)
    await new CatalogMatchCache('test-matches').entries(titles, api)
    expect(discover.requests).toHaveLength(50)
  })
})

describe('Explore', () => {
  it('collections in order, empty ones left out; all down: failed', async () => {
    const discover = new MockFetch()
    discover.stub('/hubs/sections/home/trending-plex', container([{ ratingKey: 'a', type: 'movie', title: 'A' }, { ratingKey: 'a', type: 'movie', title: 'A' }]))
    discover.stub('/hubs/sections/home/coming-soon', container([]))
    const explore = new Explore()
    explore.configure(new PlexDiscoverAPI('user', testClient, discover.fetch))
    await explore.load()
    expect(explore.getSnapshot().collections.map((c) => [c.hub, c.items.length])).toEqual([['trending-plex', 1]])
    expect(explore.getSnapshot().failed).toBe(false)

    const down = new MockFetch()
    const failing = new Explore()
    failing.configure(new PlexDiscoverAPI('user', testClient, async (input: string) => (down.fail(new URL(input).pathname), down.fetch(input))))
    await failing.load()
    expect(failing.getSnapshot()).toMatchObject({ loaded: true, failed: true })
  })
})
