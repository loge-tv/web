import { describe, expect, it } from 'vitest'
import { CatalogText, foldTitle, LibraryIndex, makeWatchlistShelves, mergeCatalogSearch, shelvesAreEmpty } from '../catalogMatch'
import { HTTPError } from '../http'
import {
  dayOf,
  discoverCaption,
  discoverItemFromLibrary,
  isReleased,
  isWatchedInPlex,
  makeDiscoverItem,
  parseDiscoverItems,
  PlexDiscoverAPI,
  releaseDay,
  upcomingCaption,
  withUserState,
  type DiscoverItem,
} from '../plexDiscover'
import { catalogKey, makeItem, parseMetadata, type PlexItemType } from '../plexModels'
import { fixture, MockFetch, testClient } from './support'

// Port of DiscoverTests.swift (DiscoverTests, CatalogMatchTests) plus web-only parts.

function api(mock: MockFetch) {
  return new PlexDiscoverAPI('user-token', testClient, mock.fetch, undefined, undefined, 'ru')
}

describe('Discover API', () => {
  // `discover-search.json` is a real response (trimmed) plus a person, which must be dropped.
  it('search parses movies and shows', async () => {
    const mock = new MockFetch()
    mock.stub('/library/search', fixture('discover-search'))

    const items = await api(mock).search('дюна')
    expect(items.map((i) => i.title)).toEqual(['Дюна', 'Дюна', 'Дюна'])
    expect(items.map((i) => i.year)).toEqual([2021, 1984, 2000])
    expect(items.map((i) => i.kind)).toEqual(['movie', 'movie', 'show'])
    expect(items[0].ratingKey).toBe('5d776cac47dd6e001f6ee059')
    expect(items[0].guid).toBe('plex://movie/5d776cac47dd6e001f6ee059')
    expect(items[0].duration).toBe(9_300_000)
    expect(items[0].genres).toEqual(['Sci-Fi', 'Action'])
    expect(items[2].childCount).toBe(1)
    expect(discoverCaption(items[2])).toBe('Сериал · 2000')

    const request = mock.requests[0]
    expect(request.url.host).toBe('discover.provider.plex.tv')
    expect(request.url.searchParams.get('query')).toBe('дюна')
    expect(request.url.searchParams.get('searchTypes')).toBe('movies,tv')
    expect(request.headers.get('X-Plex-Token')).toBe('user-token')
    expect(request.headers.get('X-Plex-Language')).toBe('ru')
    expect(request.headers.get('X-Plex-Client-Identifier')).toBe(testClient.clientIdentifier)
    // The account token stays out of URLs.
    expect(request.url.searchParams.get('X-Plex-Token')).toBeNull()
  })

  // `watchlist.json` is shaped after what Seerr reads (`totalSize`, `Metadata`), not recorded.
  it('watchlist pages until totalSize', async () => {
    const mock = new MockFetch()
    mock.stub('/library/sections/watchlist/all', fixture('watchlist'))

    const items = await api(mock).watchlist(2)
    // totalSize 3 with 2 per page asks for a second page; the stub repeats the first,
    // and repeated keys are not added twice.
    expect(mock.requests).toHaveLength(2)
    expect(mock.requests.map((r) => r.url.searchParams.get('X-Plex-Container-Start'))).toEqual(['0', '2'])
    expect(items.map((i) => i.ratingKey)).toEqual(['5d9c08444eefaa001f5d9359', '5d776cac47dd6e001f6ee059'])
    expect(items.map((i) => i.kind)).toEqual(['show', 'movie'])
  })

  // The answer's shape is a real one (keys changed): shows count episodes, movies plays.
  it('user states in chunks', async () => {
    const mock = new MockFetch()
    mock.stub(
      '/library/metadata/s1,m1/userState',
      '{"MediaContainer":{"identifier":"tv.plex.provider.discover","size":2,"UserState":[{"ratingKey":"s1","type":"show","viewedLeafCount":12,"watchlistedAt":1792598042},{"ratingKey":"m1","type":"movie","viewCount":0,"viewOffset":0,"watchlistedAt":1792779204}]}}',
    )
    mock.stub(
      '/library/metadata/m2/userState',
      '{"MediaContainer":{"identifier":"tv.plex.provider.metadata","size":1,"UserState":{"ratingKey":"m2","type":"movie","viewCount":2}}}',
    )
    const states = await api(mock).userStates(['s1', 'm1', 'm2'], 2)
    expect(mock.requests).toHaveLength(2)
    expect(mock.requests[0].headers.get('X-Plex-Token')).toBe('user-token')
    expect(states.get('s1')?.viewedLeafCount).toBe(12)
    expect(states.get('m1')?.viewCount).toBe(0)
    expect(states.get('m2')?.viewCount).toBe(2)

    const show = makeDiscoverItem({ ratingKey: 's1', kind: 'show', title: '5:32' })
    expect(isWatchedInPlex(show)).toBe(false)
    expect(isWatchedInPlex(withUserState(show, states.get('s1')))).toBe(true)
    expect(isWatchedInPlex(withUserState(makeDiscoverItem({ ratingKey: 'm1', kind: 'movie', title: 'M' }), states.get('m1')))).toBe(false)
    expect(isWatchedInPlex(withUserState(makeDiscoverItem({ ratingKey: 'm2', kind: 'movie', title: 'M' }), states.get('m2')))).toBe(true)
  })

  // Watch state as attributes (like a media server) or as a `UserState` child, one or a list.
  it('watch state is parsed', () => {
    const item = (fields: Record<string, unknown>) =>
      parseDiscoverItems({ MediaContainer: { Metadata: [{ ratingKey: 'k', type: 'movie', title: 'T', ...fields }] } }).items[0]
    expect(isWatchedInPlex(item({ viewCount: 1 }))).toBe(true)
    expect(isWatchedInPlex(item({ UserState: { viewCount: '2' } }))).toBe(true)
    expect(isWatchedInPlex(item({ UserState: [{ viewState: 'complete' }] }))).toBe(true)
    // Episodes count only for shows.
    expect(isWatchedInPlex(item({ UserState: [{ viewedLeafCount: 3 }] }))).toBe(false)
    expect(isWatchedInPlex(item({ userState: true }))).toBe(false)
    expect(isWatchedInPlex(item({}))).toBe(false)
    // A show counts by its episodes, not by plays.
    expect(isWatchedInPlex({ ...item({ viewCount: 3 }), kind: 'show' })).toBe(false)
    expect(isWatchedInPlex({ ...item({ viewedLeafCount: 1 }), kind: 'show' })).toBe(true)
  })

  it('release day and the caption of what is not out yet', () => {
    const movie = makeDiscoverItem({ ratingKey: 'm', kind: 'movie', title: 'M', year: 2027, originallyAvailableAt: '2027-03-12' })
    expect(releaseDay(movie)).toBe('2027-03-12')
    expect(isReleased(movie, '2027-03-11')).toBe(false)
    expect(isReleased(movie, '2027-03-12')).toBe(true)
    expect(upcomingCaption(movie)).toBe('12 марта 2027')

    const show = makeDiscoverItem({ ratingKey: 's', kind: 'show', title: 'S', year: 2027, originallyAvailableAt: '2027-01-05T00:00:00Z' })
    expect(upcomingCaption(show)).toBe('5 января 2027')
    const yearOnly = { ...show, originallyAvailableAt: undefined }
    expect(upcomingCaption(yearOnly)).toBe('2027')
    // Only a year: out from that year on.
    expect(isReleased(yearOnly, '2027-01-01')).toBe(true)
    expect(isReleased(yearOnly, '2026-12-31')).toBe(false)

    const announced = makeDiscoverItem({ ratingKey: 'a', kind: 'movie', title: 'A' })
    expect(isReleased(announced, '2030-01-01')).toBe(false)
    expect(upcomingCaption(announced)).toBe('Дата не объявлена')
  })

  it('day of a date in a time zone', () => {
    // 2026-11-22 21:30 UTC is already the 23rd in Moscow.
    const date = new Date(1_795_383_000 * 1000)
    expect(dayOf(date, 'Europe/Moscow')).toBe('2026-11-23')
    expect(dayOf(date, 'UTC')).toBe('2026-11-22')
  })

  it('details: Metadata or Video', async () => {
    const mock = new MockFetch()
    mock.stub('/library/metadata/abc', JSON.stringify({ MediaContainer: { Video: [{ ratingKey: 'abc', type: 'movie', title: 'X', summary: 'S' }] } }))
    const item = await api(mock).details('abc')
    expect(item?.summary).toBe('S')
  })

  it('watchlist actions are PUTs', async () => {
    const mock = new MockFetch()
    mock.stub('/actions/addToWatchlist', '')
    mock.stub('/actions/removeFromWatchlist', '')
    const client = api(mock)

    await client.addToWatchlist('abc')
    await client.removeFromWatchlist('abc')
    expect(mock.requests.map((r) => r.method)).toEqual(['PUT', 'PUT'])
    expect(mock.requests.map((r) => r.url.pathname)).toEqual(['/actions/addToWatchlist', '/actions/removeFromWatchlist'])
    expect(mock.requests.map((r) => r.url.searchParams.get('ratingKey'))).toEqual(['abc', 'abc'])
  })

  it('a refused action throws', async () => {
    const mock = new MockFetch()
    mock.stub('/actions/addToWatchlist', '', 401)
    const error = await api(mock).addToWatchlist('abc').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HTTPError)
    expect((error as HTTPError).status).toBe(401)
  })

  it('images go through the Plex resizer', () => {
    const client = new PlexDiscoverAPI('t', testClient)
    const url = new URL(client.imageURL('https://image.tmdb.org/t/p/original/x.jpg', 400, 600)!)
    expect(url.host).toBe('images.plex.tv')
    expect(url.pathname).toBe('/photo')
    expect(url.searchParams.get('url')).toBe('https://image.tmdb.org/t/p/original/x.jpg')
    expect(url.searchParams.get('width')).toBe('400')
    expect(url.searchParams.get('X-Plex-Token')).toBeNull() // the account token stays off image URLs
    expect(client.imageURL('/library/metadata/1/thumb', 1, 1)).toBeUndefined()
    expect(client.imageURL(undefined, 1, 1)).toBeUndefined()
  })
})

describe('Catalog match', () => {
  const library = (ratingKey: string, title: string, guid: string | undefined, type: PlexItemType = 'movie', year?: number) =>
    makeItem({ ratingKey, type, title, guid, year })

  it('catalog key only for the modern agents', () => {
    expect(catalogKey(library('1', 'A', 'plex://movie/5d776cac'))).toBe('5d776cac')
    expect(catalogKey(library('2', 'B', 'plex://show/5d9c0844', 'show'))).toBe('5d9c0844')
    expect(catalogKey(library('3', 'C', 'com.plexapp.agents.themoviedb://438631?lang=ru'))).toBeUndefined()
    expect(catalogKey(library('4', 'D', 'plex://episode/5e1'))).toBeUndefined()
    expect(catalogKey(library('5', 'E', undefined))).toBeUndefined()
  })

  it('library guid is parsed', () => {
    const [item] = parseMetadata({
      MediaContainer: { Metadata: [{ ratingKey: 7, type: 'movie', title: 'Дюна', guid: 'plex://movie/5d776cac47dd6e001f6ee059' }] },
    })
    expect(catalogKey(item)).toBe('5d776cac47dd6e001f6ee059')
  })

  it('search splits the library and the catalog', () => {
    const index = new LibraryIndex([
      library('10', 'Дюна', 'plex://movie/m2021'),
      library('11', 'Дюна: Часть вторая', 'plex://movie/m2024'),
      library('12', 'Старая Дюна', 'com.plexapp.agents.imdb://tt0087182'),
      library('13', 'Другое', 'plex://movie/other'),
    ])
    const catalog = [
      makeDiscoverItem({ ratingKey: 'm2021', kind: 'movie', title: 'Дюна', year: 2021 }),
      makeDiscoverItem({ ratingKey: 'm1984', kind: 'movie', title: 'Дюна', year: 1984 }),
      makeDiscoverItem({ ratingKey: 's2000', kind: 'show', title: 'Дюна', year: 2000 }),
    ]
    const result = mergeCatalogSearch('дюна', index, catalog)
    // The catalog's match first, then title matches (an old-agent item among them), each once.
    expect(result.inLibrary.map((i) => i.ratingKey)).toEqual(['10', '11', '12'])
    expect(result.elsewhere.map((i) => i.ratingKey)).toEqual(['m1984', 's2000'])
  })

  // Not in the Apple app (it matches by catalog key only): old-agent items would otherwise show
  // up again under «Нет на сервере» and stay on «Хочу посмотреть».
  it('old-agent items match by kind, title and year', () => {
    const index = new LibraryIndex([
      library('20', 'Ёлки', 'com.plexapp.agents.imdb://tt1', 'movie', 2010),
      library('21', 'Дюна', 'plex://movie/m2021', 'movie', 2021),
    ])
    const entry = (ratingKey: string, title: string, year?: number, kind: 'movie' | 'show' = 'movie') =>
      makeDiscoverItem({ ratingKey, kind, title, year })
    expect(index.item(entry('e2010', 'елки', 2010))?.ratingKey).toBe('20')
    expect(index.item(entry('e2011', 'Ёлки', 2011))).toBeUndefined()
    expect(index.item(entry('e-show', 'Ёлки', 2010, 'show'))).toBeUndefined()
    expect(index.item(entry('e-nodate', 'Ёлки'))).toBeUndefined()
    // A keyed item is matched by its key alone: the same title and year is another title.
    expect(index.item(entry('remake', 'Дюна', 2021))).toBeUndefined()
    const result = mergeCatalogSearch('елки', index, [entry('e2010', 'Ёлки', 2010)])
    expect(result.inLibrary.map((i) => i.ratingKey)).toEqual(['20'])
    expect(result.elsewhere).toEqual([])
    expect(makeWatchlistShelves([entry('e2010', 'Ёлки', 2010)], index, '2026-11-22').wanted).toEqual([])
  })

  it('title search ignores case and diacritics', () => {
    expect(foldTitle('Ёлки')).toBe(foldTitle('елки'))
    const index = new LibraryIndex([library('1', 'Ёлки', undefined), library('2', 'Мой сосед Тоторо', undefined), library('3', 'Amélie', undefined)])
    expect(index.search('елки').map((i) => i.ratingKey)).toEqual(['1'])
    expect(index.search('  ТОТОРО ').map((i) => i.ratingKey)).toEqual(['2'])
    expect(index.search('amelie').map((i) => i.ratingKey)).toEqual(['3'])
    expect(index.search('   ')).toEqual([])
  })

  // Shelves of the watchlist: the server's titles and watched ones leave; what is not out yet
  // goes soonest first, undated last.
  it('watchlist shelves', () => {
    const item = (key: string, fields: Partial<DiscoverItem> = {}): DiscoverItem =>
      makeDiscoverItem({ ratingKey: key, kind: 'movie', title: key, year: 2020, ...fields })
    const index = new LibraryIndex([library('10', 'Дюна', 'plex://movie/onServer')])
    const watchlist = [
      item('later', { year: 2028 }),
      item('wanted1'),
      item('onServer'),
      item('announced', { year: undefined }),
      item('watched', { viewCount: 1 }),
      item('soon', { year: 2027, originallyAvailableAt: '2027-02-01' }),
      item('wanted2', { year: 2026, originallyAvailableAt: '2026-11-22' }),
      item('sameYear', { year: 2027 }),
    ]
    const shelves = makeWatchlistShelves(watchlist, index, '2026-11-22')
    expect(shelves.wanted.map((i) => i.ratingKey)).toEqual(['wanted1', 'wanted2'])
    expect(shelves.upcoming.map((i) => i.ratingKey)).toEqual(['soon', 'sameYear', 'later', 'announced'])
    expect(shelvesAreEmpty(makeWatchlistShelves([item('onServer')], index, '2026-11-22'))).toBe(true)
  })

  it('upcoming ties keep the watchlist order', () => {
    const a = makeDiscoverItem({ ratingKey: 'a', kind: 'show', title: 'A', year: 2028 })
    const b = makeDiscoverItem({ ratingKey: 'b', kind: 'movie', title: 'B', year: 2028 })
    expect(makeWatchlistShelves([b, a], LibraryIndex.empty, '2026-11-22').upcoming.map((i) => i.ratingKey)).toEqual(['b', 'a'])
  })

  it('catalog entry of a library item', () => {
    const entry = discoverItemFromLibrary(library('10', 'Дюна', 'plex://movie/m2021'))
    expect(entry?.ratingKey).toBe('m2021')
    expect(entry?.kind).toBe('movie')
    expect(discoverItemFromLibrary(library('12', 'X', 'com.plexapp.agents.imdb://tt1'))).toBeUndefined()
    expect(discoverItemFromLibrary(library('14', 'S', 'plex://season/x', 'season'))).toBeUndefined()
  })

  it('catalog texts', () => {
    expect([1, 3, 5, 11, 12, 21, 22, 25].map(CatalogText.seasons)).toEqual([
      '1 сезон',
      '3 сезона',
      '5 сезонов',
      '11 сезонов',
      '12 сезонов',
      '21 сезон',
      '22 сезона',
      '25 сезонов',
    ])
    expect(CatalogText.notOnServer('Дом')).toBe('На сервере «Дом» этого нет. Список общий с приложениями Plex.')
    expect(CatalogText.notOnServer(undefined)).toBe('На сервере этого нет. Список общий с приложениями Plex.')
  })
})
