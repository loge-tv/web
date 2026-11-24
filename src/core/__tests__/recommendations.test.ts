import { describe, expect, it } from 'vitest'
import { LibraryIndex } from '../catalogMatch'
import { DetectorClient } from '../detectorClient'
import { HTTPError } from '../http'
import { catalogHubs, makeDiscoverItem, PlexDiscoverAPI, upcomingCaption, type DiscoverItem, type DiscoverUserState } from '../plexDiscover'
import { parseMetadata, tmdbID, type PlexItem } from '../plexModels'
import { PlexServerAPI } from '../plexServerAPI'
import {
  emptyRecommendations,
  historyTitleKey,
  makeCastShelf,
  makeRecommendationShelves,
  RecommendationSeeds,
  recommendationsAreEmpty,
  RecommendationText,
  seedKey,
  type TMDBTitle,
} from '../recommendations'
import { fixture, MockFetch, testClient } from './support'

// Port of RecommendationsTests.swift.

const item = (raw: Record<string, unknown>): PlexItem => parseMetadata({ MediaContainer: { Metadata: [raw] } })[0]
const discover = (mock: MockFetch) => new PlexDiscoverAPI('acct', testClient, mock.fetch, undefined, undefined, 'ru')
const entry = (ratingKey: string, kind: 'movie' | 'show', title: string) => makeDiscoverItem({ ratingKey, kind, title })

describe('recommendations', () => {
  it('library items asked with includeGuids carry the TMDB id', () => {
    const show = item({
      ratingKey: '49679',
      type: 'show',
      title: '9-1-1',
      guid: 'plex://show/5d9c08e9705e7a001e6e645b',
      Guid: [{ id: 'imdb://tt7235466' }, { id: 'tmdb://75219' }, { id: 'tvdb://337907' }],
    })
    expect(tmdbID(show)).toBe(75219)
    expect(tmdbID(item({ ratingKey: '1', type: 'movie', title: 'Old agent', guid: 'com.plexapp.agents.imdb://tt1' }))).toBeUndefined()
  })

  it('library lists and details ask for the guids', async () => {
    const mock = new MockFetch()
    mock.stub('/library/sections/1/all', JSON.stringify({ MediaContainer: { Metadata: [] } }))
    mock.stub('/library/metadata/5', JSON.stringify({ MediaContainer: { Metadata: [] } }))
    const server = new PlexServerAPI('http://pms:32400', 'srv', testClient, mock.fetch)
    await server.items({ key: '1', title: 'Фильмы', type: 'movie' })
    await server.item('5')
    expect(mock.requests.map((r) => r.url.searchParams.get('includeGuids'))).toEqual(['1', '1'])
  })

  /** Real rows: an episode of a show on the server, an episode and a movie that left it. */
  it('history and seeds', async () => {
    const body = {
      MediaContainer: {
        size: 6,
        Metadata: [
          { historyKey: '/status/sessions/history/2091', key: '/library/metadata/55552', ratingKey: '55552', grandparentKey: '/library/metadata/52323', type: 'episode', viewedAt: 1795367179, accountID: 1 },
          { historyKey: '/status/sessions/history/2090', key: '/library/metadata/55551', ratingKey: '55551', grandparentKey: '/library/metadata/52323', type: 'episode', viewedAt: 1795367000, accountID: 1 },
          { historyKey: '/status/sessions/history/2053', key: null, ratingKey: null, grandparentKey: null, grandparentTitle: 'Теория большого взрыва', type: 'episode', viewedAt: 1795274195, accountID: 1 },
          { historyKey: '/status/sessions/history/2010', key: null, ratingKey: null, grandparentKey: null, title: 'Человек-паук: Новый день', type: 'movie', viewedAt: 1794511785, accountID: 1 },
          { historyKey: '/status/sessions/history/2000', key: '/library/metadata/700', ratingKey: '700', type: 'movie', viewedAt: 1794000000, accountID: 1 },
          { historyKey: '/status/sessions/history/1990', key: '/library/metadata/800', ratingKey: '800', type: 'movie', viewedAt: 1793000000, accountID: 1 },
        ],
      },
    }
    const mock = new MockFetch()
    mock.stub('/status/sessions/history/all', JSON.stringify(body))
    const server = new PlexServerAPI('http://pms:32400', 'srv', testClient, mock.fetch)
    const history = await server.history(1)
    expect(history).toHaveLength(6)
    expect(mock.last.url.searchParams.get('accountID')).toBe('1')
    expect(mock.last.url.searchParams.get('sort')).toBe('viewedAt:desc')
    expect(history.map(historyTitleKey)).toEqual(['52323', '52323', undefined, undefined, '700', '800'])

    const index = new LibraryIndex([
      item({ ratingKey: '52323', type: 'show', title: 'Теория большого взрыва', Guid: [{ id: 'tmdb://1418' }] }),
      item({ ratingKey: '700', type: 'movie', title: 'No TMDB id' }),
      item({ ratingKey: '800', type: 'movie', title: '5 сантиметров в секунду', Guid: [{ id: 'tmdb://38142' }] }),
    ])
    const recent = RecommendationSeeds.recentFromHistory(history, index)
    // Deduped, newest first, gone and id-less titles skipped.
    expect(RecommendationSeeds.pick(recent).map(seedKey)).toEqual(['tv:1418', 'movie:38142'])
    expect(RecommendationSeeds.pick(recent, 1)).toHaveLength(1)

    // No history: the library's last plays.
    const viewed = new LibraryIndex([
      item({ ratingKey: '1', type: 'movie', title: 'Old', lastViewedAt: 100, Guid: [{ id: 'tmdb://1' }] }),
      item({ ratingKey: '2', type: 'show', title: 'New', lastViewedAt: 300, Guid: [{ id: 'tmdb://2' }] }),
      item({ ratingKey: '3', type: 'movie', title: 'Never played', Guid: [{ id: 'tmdb://3' }] }),
      item({ ratingKey: '4', type: 'movie', title: 'No id', lastViewedAt: 200 }),
    ])
    const fromIndex = RecommendationSeeds.recentFromIndex(viewed)
    expect(fromIndex.map((i) => i.ratingKey)).toEqual(['2', '4', '1'])
    expect(RecommendationSeeds.pick(fromIndex).map(seedKey)).toEqual(['tv:2', 'movie:1'])
  })

  it('detector recommendations', async () => {
    const mock = new MockFetch()
    mock.stub(
      '/v1/recommendations',
      JSON.stringify({
        items: [
          { seed: 'movie:38142', titles: [{ tmdbId: 372058, type: 'movie', title: 'Твоё имя', originalTitle: '君の名は。', releaseDate: '2016-08-26', year: 2016 }] },
          { seed: 'tv:1418', titles: [], failed: true },
        ],
      }),
    )
    const detector = new DetectorClient('http://det', 'srv', mock.fetch)
    const answer = await detector.recommendations(['movie:38142', 'tv:1418'])
    expect(answer?.['movie:38142']).toEqual([{ tmdbId: 372058, type: 'movie', title: 'Твоё имя', year: 2016 }])
    expect(answer?.['tv:1418']).toBeUndefined() // a failed seed is left out
    expect(mock.last.url.searchParams.get('seeds')).toBe('movie:38142,tv:1418')
    expect(mock.last.url.searchParams.get('language')).toBe('ru-RU')
    expect(mock.last.headers.get('X-Plex-Token')).toBe('srv')

    const none = new MockFetch()
    none.stub('/v1/recommendations', JSON.stringify({ error: 'tmdb is not configured', configured: false }), 404)
    expect(await new DetectorClient('http://det', 'srv', none.fetch).recommendations(['movie:1'])).toBeNull()

    const down = new MockFetch()
    down.stub('/v1/recommendations', JSON.stringify({ error: 'tmdb is unreachable' }), 502)
    await expect(new DetectorClient('http://det', 'srv', down.fetch).recommendations(['movie:1'])).rejects.toBeInstanceOf(HTTPError)
    // Nothing to ask: no request.
    expect(await new DetectorClient('http://det', 'srv', down.fetch).recommendations([])).toEqual({})
  })

  /** The real answer of `/library/metadata/matches` for tmdb://603 (trimmed). */
  it('catalog match by TMDB id', async () => {
    const mock = new MockFetch()
    mock.stub(
      '/library/metadata/matches',
      JSON.stringify({
        MediaContainer: {
          identifier: 'tv.plex.provider.discover',
          size: 1,
          Metadata: [
            {
              ratingKey: '5d776827880197001ec90904',
              key: '/library/metadata/5d776827880197001ec90904',
              guid: 'plex://movie/5d776827880197001ec90904',
              type: 'movie',
              title: 'The Matrix',
              year: 1999,
              originallyAvailableAt: '1999-03-31',
              Guid: [{ id: 'imdb://tt0133093' }, { id: 'tmdb://603' }, { id: 'tvdb://169' }],
            },
          ],
        },
      }),
    )
    const found = await discover(mock).match(603, 'movie')
    expect(found?.ratingKey).toBe('5d776827880197001ec90904')
    expect(found?.year).toBe(1999)
    expect(found?.guids).toContain('tmdb://603')
    expect(mock.last.url.searchParams.get('type')).toBe('1')
    expect(mock.last.url.searchParams.get('guid')).toBe('tmdb://603')

    const missing = new MockFetch()
    missing.stub('/library/metadata/matches', '', 404)
    expect(await discover(missing).match(1, 'show')).toBeUndefined()
    expect(missing.last.url.searchParams.get('type')).toBe('2')
    // Stored as JSON and read back the same.
    expect(JSON.parse(JSON.stringify(found))).toEqual(found)
  })

  /**
   * Plex's own lists: «More From This Cast & Crew» (a person in the list is dropped) and a
   * ready-made collection; the cast shelf leaves out the seed, the server's and watched titles.
   */
  it('cast shelf and hubs', async () => {
    const mock = new MockFetch()
    mock.stub(
      '/library/metadata/cat-x/more-from-credits',
      JSON.stringify({
        MediaContainer: {
          title: 'More From This Cast & Crew',
          size: 3,
          Metadata: [
            { ratingKey: 'a', guid: 'plex://movie/a', type: 'movie', title: 'A', year: 2001 },
            { ratingKey: 'p', type: 'person', title: 'Someone' },
            { ratingKey: 'b', guid: 'plex://show/b', type: 'show', title: 'B', year: 2002 },
          ],
        },
      }),
    )
    mock.stub(
      '/hubs/sections/home/coming-soon',
      JSON.stringify({ MediaContainer: { title: 'Coming Soon', size: 1, Metadata: [{ ratingKey: 's', type: 'movie', title: 'Elsinore', originallyAvailableAt: '2027-03-12' }] } }),
    )
    const api = discover(mock)
    expect((await api.moreFromCredits('cat-x')).map((i) => i.ratingKey)).toEqual(['a', 'b'])
    expect((await api.hub('coming-soon')).map((i) => i.title)).toEqual(['Elsinore'])
    expect(catalogHubs.find((h) => h.id === 'coming-soon')?.upcoming).toBe(true)
    expect(catalogHubs.find((h) => h.id === 'trending-plex')?.upcoming).toBe(false)

    const seed = item({ ratingKey: '10', type: 'show', title: 'Seed', guid: 'plex://show/cat-x' })
    const onServer = item({ ratingKey: '11', type: 'movie', title: 'On server', guid: 'plex://movie/srv' })
    const index = new LibraryIndex([seed, onServer])
    const entries: DiscoverItem[] = [
      entry('cat-x', 'show', 'Seed'),
      entry('srv', 'movie', 'On server'),
      entry('w', 'movie', 'Watched'),
      entry('n1', 'movie', 'New 1'),
      entry('n2', 'movie', 'On a TMDB shelf'),
      entry('n3', 'show', 'New 3'),
      entry('n1', 'movie', 'New 1 again'),
    ]
    const states = new Map<string, DiscoverUserState>([['w', { ratingKey: 'w', viewCount: 1 }]])
    const shelf = makeCastShelf(seed, entries, index, states, new Set(['n2']))
    expect(shelf?.items.map((i) => i.ratingKey)).toEqual(['n1', 'n3'])
    expect(makeCastShelf(seed, entries, index, new Map(), new Set(), 1)?.items).toHaveLength(1)
    expect(makeCastShelf(seed, entries.slice(0, 2), index, new Map())).toBeUndefined()
    expect(recommendationsAreEmpty({ ...emptyRecommendations, cast: shelf })).toBe(false)
    expect(RecommendationText.cast('Seed')).toBe('Ещё с актёрами «Seed»')
  })

  /** Real answers of two collections (account with the Russian language): every title decodes. */
  it('real hubs', async () => {
    const mock = new MockFetch()
    mock.stub('/hubs/sections/home/trending-plex', fixture('discover-hub-trending-plex'))
    mock.stub('/hubs/sections/home/coming-soon', fixture('discover-hub-coming-soon'))
    const api = discover(mock)
    const trending = await api.hub('trending-plex')
    expect(trending).toHaveLength(15)
    expect(trending[0].title).toBe('Человек с Земли')
    const soon = await api.hub('coming-soon')
    expect(soon).toHaveLength(30)
    expect(soon.some((i) => i.kind === 'show' && i.season === undefined)).toBe(true)
    // A new season stands for its show.
    const season = soon.find((i) => i.season !== undefined)!
    expect(season.ratingKey).toBe('5d9c08ffe264b7001fc4d397')
    expect(season.guid).toBe('plex://show/5d9c08ffe264b7001fc4d397')
    expect(season.title).toBe('новобранец')
    expect(season.season).toBe(9)
    expect(upcomingCaption(season).startsWith('Сезон 9 · ')).toBe(true)
    expect(soon.every((i) => i.ratingKey !== '' && i.title !== '')).toBe(true)
  })

  it('shelves', () => {
    const seen = item({ ratingKey: '800', type: 'movie', title: 'Seed movie', viewCount: 1, Guid: [{ id: 'tmdb://38142' }] })
    const show = item({ ratingKey: '52323', type: 'show', title: 'Seed show', viewedLeafCount: 30, Guid: [{ id: 'tmdb://1418' }] })
    const fresh = item({ ratingKey: '900', type: 'movie', title: 'On the server, not watched', Guid: [{ id: 'imdb://tt1' }, { id: 'tmdb://129' }] })
    const begun = item({ ratingKey: '901', type: 'movie', title: 'Begun', viewOffset: 60000, Guid: [{ id: 'tmdb://130' }] })
    const byCatalog = item({ ratingKey: '902', type: 'show', title: 'Matched by catalog key', guid: 'plex://show/cat-x' })
    const index = new LibraryIndex([seen, show, fresh, begun, byCatalog])
    const seeds = [
      { item: seen, tmdbID: 38142 },
      { item: show, tmdbID: 1418 },
    ]
    const t = (tmdbId: number, type: string, title: string): TMDBTitle => ({ tmdbId, type, title })
    const titles: Record<string, TMDBTitle[]> = {
      'movie:38142': [t(129, 'movie', 'fresh'), t(130, 'movie', 'begun'), t(1418, 'tv', 'the other seed'), t(1, 'movie', 'a'), t(2, 'movie', 'watched elsewhere'), t(3, 'movie', 'no Plex entry')],
      'tv:1418': [t(129, 'movie', 'fresh again'), t(1, 'movie', 'a again'), t(50, 'tv', 'b'), t(51, 'tv', 'on server by catalog key')],
    }
    const catalog: Record<string, DiscoverItem> = {
      'movie:1': entry('cat-a', 'movie', 'A'),
      'movie:2': entry('cat-w', 'movie', 'W'),
      'tv:50': entry('cat-b', 'show', 'B'),
      'tv:51': entry('cat-x', 'show', 'X'),
    }
    const states = new Map<string, DiscoverUserState>([['cat-w', { ratingKey: 'cat-w', viewCount: 2 }]])
    const shelves = makeRecommendationShelves(seeds, titles, catalog, index, states)
    // On the server, not begun, no seed, once.
    expect(shelves.onServer.map((i) => i.ratingKey)).toEqual(['900', '902'])
    expect(shelves.because.map((b) => seedKey(b.seed))).toEqual(['movie:38142', 'tv:1418'])
    // Watched elsewhere and unmatched titles dropped; TMDB's (Russian) title, not the catalog's English one.
    expect(shelves.because[0].items.map((i) => i.ratingKey)).toEqual(['cat-a'])
    expect(shelves.because[0].items[0].title).toBe('a')
    // A title shows once, in the first shelf.
    expect(shelves.because[1].items.map((i) => i.ratingKey)).toEqual(['cat-b'])

    const capped = makeRecommendationShelves(seeds, titles, catalog, index, new Map(), 1, 1)
    expect(capped.onServer).toHaveLength(1)
    expect(capped.because[0].items).toHaveLength(1)
    expect(recommendationsAreEmpty(emptyRecommendations)).toBe(true)
    expect(RecommendationText.because('Seed movie')).toBe('Потому что вы смотрели «Seed movie»')
  })
})
