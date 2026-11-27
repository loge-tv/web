import { describe, expect, it } from 'vitest'
import { ChapterSegments, FallbackSegments } from '../chapterSegments'
import { SepiaServerClient } from '../sepiaServerClient'
import { externalID, makeItem, parseMetadata, type PlexChapter, type PlexItem } from '../plexModels'
import { PlexServerAPI } from '../plexServerAPI'
import type { Segment, SegmentType } from '../segment'
import { FoundSegments, SegmentFinder, ServerAvailability } from '../segmentFinder'
import { DEFAULT_THEINTRODB_URL, parseTheIntroDBMedia, TheIntroDBCache, TheIntroDBClient, type TheIntroDBLookup } from '../theIntroDB'
import { MockFetch, testClient } from './support'

// Port of SegmentFallbackTests.swift: segments without Sepia Server, chapters of the file and
// TheIntroDB. The JSON is what the real Plex and TheIntroDB answered for «Дипломатка» S4E1
// (2026-11-23).

const episodeJSON = `
{"MediaContainer":{"Metadata":[{"ratingKey":"55736","type":"episode","title":"Серия 1","index":1,"parentIndex":4,
"grandparentRatingKey":"55734","duration":2932576,
"Guid":[{"id":"imdb://tt36958116"},{"id":"tmdb://7695378"},{"id":"tvdb://11401609"}],
"Chapter":[{"id":38763,"tag":"Part 01","index":1,"startTimeOffset":0,"endTimeOffset":2655450},
           {"id":160,"tag":"Credits","index":2,"startTimeOffset":2655450,"endTimeOffset":2932580}]}]}}
`
const showJSON = `
{"MediaContainer":{"Metadata":[{"ratingKey":"55734","type":"show","title":"Дипломатка",
"Guid":[{"id":"imdb://tt17491088"},{"id":"tmdb://203857"},{"id":"tvdb://415239"}]}]}}
`
const introDBJSON = '{"tvdb_id":415239,"type":"tv","season":4,"episode":1,"credits":[{"start_ms":2655450,"end_ms":null}]}'

function item(json: string): PlexItem {
  return parseMetadata(JSON.parse(json))[0]
}

const seg = (type: SegmentType, start: number, end: number): Segment => ({ type, start, end })

/** A TheIntroDB client on the mock, with a cache of its own. */
const introDB = (mock: MockFetch) => new TheIntroDBClient(DEFAULT_THEINTRODB_URL, mock.fetch, 4000, new TheIntroDBCache())

/** Requests to TheIntroDB among those recorded. */
const introDBRequests = (mock: MockFetch) => mock.requests.filter((r) => r.url.pathname === '/v4/media')

describe('Plex', () => {
  it('decodes chapters and guids', () => {
    const episode = item(episodeJSON)
    expect(episode.chapters).toEqual<PlexChapter[]>([
      { tag: 'Part 01', index: 1, start: 0, end: 2655.45 },
      { tag: 'Credits', index: 2, start: 2655.45, end: 2932.58 },
    ])
    expect(externalID(episode, 'tvdb')).toBe('11401609')
    expect(externalID(item(showJSON), 'tmdb')).toBe('203857')
    expect(externalID(episode, 'anidb')).toBeUndefined()
  })

  it('the full item asks for chapters', async () => {
    const mock = new MockFetch()
    mock.stub('/library/metadata/55736', episodeJSON)
    const api = new PlexServerAPI('http://plex.test', 'tok', testClient, mock.fetch)
    await api.item('55736')
    expect(mock.requests[0].url.searchParams.get('includeChapters')).toBe('1')
  })
})

describe('Chapters', () => {
  it('chapter names', () => {
    const cases: [string, SegmentType | undefined][] = [
      ['Intro', 'intro'], ['Opening', 'intro'], ['OP', 'intro'], ['Opening Credits', 'intro'],
      ['Заставка', 'intro'], ['Начальные титры', 'intro'],
      ['Credits', 'credits'], ['End Credits', 'credits'], ['Ending', 'credits'], ['ED', 'credits'],
      ['End titles/Somewhere in My Memory Reprise', 'credits'], ['Титры', 'credits'],
      ['Финальные  титры.', 'credits'], ['Credits 2', 'credits'],
      ['Recap', 'recap'], ['Previously on Lost', 'recap'], ['В предыдущих сериях', 'recap'],
      ['Preview', 'preview'], ['Next Episode', 'preview'], ['Анонс', 'preview'],
      ['Post-credits', undefined], ['End credits scene', undefined], ['Ending scene', undefined], ['Part 01', undefined],
      ['Chapter 3', undefined], ['Studio logo', undefined], ['Main', undefined], ['', undefined],
    ]
    for (const [name, type] of cases) {
      expect(ChapterSegments.type(name), name).toBe(type)
    }
  })

  it('the credits chapter of an episode', () => {
    const episode = item(episodeJSON)
    expect(ChapterSegments.segments(episode.chapters, false, 2932.576)).toEqual([seg('credits', 2655.45, 2932.576)])
  })

  it('a chapter without an end runs to the next one', () => {
    const chapters: PlexChapter[] = [
      { tag: 'Recap', start: 0, end: undefined },
      { tag: 'Opening', start: 40, end: undefined },
      { tag: 'Part A', start: 130, end: undefined },
      { tag: 'Ending', start: 1300, end: undefined },
    ]
    expect(ChapterSegments.segments(chapters, false, 1420)).toEqual([
      seg('recap', 0, 40),
      seg('intro', 40, 130),
      seg('credits', 1300, 1420),
    ])
  })

  it('a movie keeps only credits', () => {
    const chapters: PlexChapter[] = [
      { tag: 'Main Titles', start: 0, end: 180 },
      { tag: 'Old Man Marley', start: 180, end: 5800 },
      { tag: 'End titles/Somewhere in My Memory', start: 5800, end: 6200 },
    ]
    expect(ChapterSegments.segments(chapters, true, 6200)).toEqual([seg('credits', 5800, 6200)])
  })

  it('plausibility', () => {
    const duration = 3000
    const segments = [
      seg('intro', 1600, 1700), // intro in the second half
      seg('credits', 100, 200), // credits in the first half
      seg('credits', 2900, 3200), // runs past the end: clamped
      seg('preview', 3100, 3200), // starts after the end
      seg('recap', 0, 0), // 0/0: confirmed absent
      seg('intro', 60, 50), // inverted
      seg('intro', -2, 45), // before the start: clamped
    ]
    expect(FallbackSegments.plausible(segments, false, duration)).toEqual([seg('intro', 0, 45), seg('credits', 2900, 3000)])
  })
})

describe('TheIntroDB', () => {
  it("the lookup uses the show's TVDB id and Plex's numbers", () => {
    const lookup = TheIntroDBClient.lookup(item(episodeJSON), item(showJSON))
    expect(lookup).toEqual<TheIntroDBLookup>({ idName: 'tvdb_id', id: '415239', season: 4, episode: 1, durationMs: 2932576 })
    expect(new TheIntroDBClient().url(lookup!)).toBe(
      'https://api.theintrodb.org/v4/media?tvdb_id=415239&season=4&episode=1&duration_ms=2932576',
    )
  })

  it('the lookup falls back to TMDB, then IMDb', () => {
    const movie = makeItem({ ratingKey: '1', type: 'movie', title: 'M', duration: 6000_000, guids: ['imdb://tt0099785'] })
    expect(TheIntroDBClient.lookup(movie, undefined)).toEqual<TheIntroDBLookup>({
      idName: 'imdb_id',
      id: 'tt0099785',
      season: undefined,
      episode: undefined,
      durationMs: 6000_000,
    })
    const show = makeItem({ ratingKey: '2', type: 'show', title: 'S', guids: ['tmdb://203857', 'imdb://tt17491088'] })
    const episode = makeItem({ ratingKey: '3', type: 'episode', title: 'E', index: 2, parentIndex: 1, grandparentRatingKey: '2' })
    expect(TheIntroDBClient.lookup(episode, show)?.idName).toBe('tmdb_id')
    expect(TheIntroDBClient.lookup(episode, undefined), 'an episode needs its show').toBeNull()
    expect(TheIntroDBClient.lookup(movie, undefined)?.season).toBeUndefined()
    const bare = makeItem({ ratingKey: '4', type: 'movie', title: 'M', guids: ['plex://movie/5d77'] })
    expect(TheIntroDBClient.lookup(bare, undefined)).toBeNull()
  })

  it('segments from TheIntroDB, without Plex headers', async () => {
    const mock = new MockFetch()
    mock.stub('/v4/media', introDBJSON)
    const client = introDB(mock)
    const lookup: TheIntroDBLookup = { idName: 'tvdb_id', id: '415239', season: 4, episode: 1, durationMs: 2932576 }
    const segments = await client.segments(lookup, false, 2932.576)
    expect(segments).toEqual([seg('credits', 2655.45, 2932.576)])
    const request = mock.requests[0]
    expect([...request.headers.keys()].some((name) => name.toLowerCase().startsWith('x-plex'))).toBe(false)
    expect(request.url.href).not.toContain('tok')
    // A "simple" CORS GET of its own: Accept only, no token anywhere, no cookies.
    expect([...request.headers.keys()]).toEqual(['accept'])
    expect(request.headers.get('Accept')).toBe('application/json')
    expect(request.method).toBe('GET')
    expect(request.credentials).toBe('omit')
    expect([...request.url.searchParams.keys()]).toEqual(['tvdb_id', 'season', 'episode', 'duration_ms'])
  })

  it('bounds of TheIntroDB entries', () => {
    const json = `
    {"type":"tv","intro":[{"start_ms":null,"end_ms":38000},{"start_ms":0,"end_ms":0}],
     "recap":[{"start_ms":0,"end_ms":null}],
     "credits":[{"start_ms":null,"end_ms":3000000},{"start_ms":2800000,"end_ms":null}],
     "preview":[{"start_ms":2950000,"end_ms":2990000}]}
    `
    const media = parseTheIntroDBMedia(JSON.parse(json))!
    expect(TheIntroDBClient.segmentsOf(media, 3000)).toEqual([
      seg('intro', 0, 38),
      seg('credits', 2800, 3000),
      seg('preview', 2950, 2990),
    ])
    expect(
      TheIntroDBClient.segmentsOf(media, undefined).filter((s) => s.type === 'credits'),
      'credits without an end need the duration',
    ).toEqual([])
  })

  it('not found is cached, failures are not', async () => {
    const lookup: TheIntroDBLookup = { idName: 'tvdb_id', id: '1', season: 1, episode: 1, durationMs: undefined }

    const missing = new MockFetch() // unstubbed path → 404
    const client = introDB(missing)
    await client.segments(lookup, false, 1000)
    await client.segments(lookup, false, 1000)
    expect(missing.requests.length, '404 is an answer').toBe(1)

    const limited = new MockFetch()
    limited.stub('/v4/media', '{"code":"usage_limit_exceeded"}', 429)
    const limitedClient = introDB(limited)
    const none = await limitedClient.segments(lookup, false, 1000)
    await limitedClient.segments(lookup, false, 1000)
    expect(none).toEqual([])
    expect(limited.requests.length, '429 is asked again later').toBe(2)
  })
})

describe('SegmentFinder', () => {
  function finder(mock: MockFetch, { chaptersOnly = false, availability = new ServerAvailability() } = {}): SegmentFinder {
    const show = item(showJSON)
    return new SegmentFinder({
      sepiaServer: new SepiaServerClient('https://server.test', 'tok', mock.fetch),
      theIntroDB: chaptersOnly ? null : introDB(mock),
      availability,
      show: async () => show,
    })
  }

  it('the server answer wins, even when empty', async () => {
    const mock = new MockFetch()
    mock.stub('/v1/segments/55736', '{"ratingKey":"55736","segments":[],"analyzed":false}')
    mock.stub('/v4/media', introDBJSON)
    const found = await finder(mock).find(item(episodeJSON))
    expect(found).toEqual<FoundSegments>({ segments: [], sources: ['server'] })
    expect(FoundSegments.note(found)).toBeUndefined()
    expect(introDBRequests(mock), 'no third party when the server answers').toEqual([])
  })

  it('without the server: chapters, then TheIntroDB', async () => {
    const mock = new MockFetch()
    mock.fail('/v1/segments/55736')
    mock.stub('/v4/media', '{"type":"tv","intro":[{"start_ms":60000,"end_ms":95000}],"credits":[{"start_ms":2600000,"end_ms":null}]}')
    const found = await finder(mock).find(item(episodeJSON))
    // Credits from the file's chapter (exact for this release), the intro from TheIntroDB.
    expect(found.segments).toEqual([seg('intro', 60, 95), seg('credits', 2655.45, 2932.576)])
    expect(found.sources).toEqual(['chapters', 'theIntroDB'])
    expect(FoundSegments.note(found)).toBe('из глав файла и TheIntroDB')
    // Sepia Server's token stays with Sepia Server.
    const [request] = introDBRequests(mock)
    expect([...request.headers.keys()]).toEqual(['accept'])
    expect(request.credentials).toBe('omit')
    expect(request.url.href).not.toContain('tok')
    expect(request.url.href).not.toMatch(/x-plex/i)
  })

  it('a refused token counts as no server', async () => {
    const mock = new MockFetch()
    mock.stub('/v1/segments/55736', '', 401)
    mock.stub('/v4/media', introDBJSON)
    const found = await finder(mock, { chaptersOnly: true }).find(item(episodeJSON))
    expect(found.sources).toEqual(['chapters'])
    expect(FoundSegments.note(found)).toBe('из глав файла')
  })

  it('chapters covering everything skip TheIntroDB', async () => {
    const mock = new MockFetch()
    mock.fail('/v1/segments/7')
    const movie = makeItem({
      ratingKey: '7',
      type: 'movie',
      title: 'M',
      duration: 6200_000,
      chapters: [{ tag: 'End Credits', start: 5900, end: 6200 }],
      guids: ['tmdb://1'],
    })
    const found = await finder(mock).find(movie)
    expect(found.segments).toEqual([seg('credits', 5900, 6200)])
    expect(introDBRequests(mock)).toEqual([])
  })

  it('a down server is not asked again for a while', async () => {
    const mock = new MockFetch()
    mock.fail('/v1/segments/55736')
    const availability = new ServerAvailability()
    const f = finder(mock, { chaptersOnly: true, availability })
    const episode = item(episodeJSON)
    await f.find(episode)
    await f.find(episode)
    expect(mock.requests.filter((r) => r.url.pathname === '/v1/segments/55736').length).toBe(1)
  })

  it('nothing anywhere', async () => {
    const mock = new MockFetch()
    mock.fail('/v1/segments/9')
    const episode = makeItem({
      ratingKey: '9',
      type: 'episode',
      title: 'E',
      index: 1,
      parentIndex: 1,
      grandparentRatingKey: '55734',
      duration: 1_500_000,
    })
    const found = await finder(mock).find(episode)
    expect(found).toEqual<FoundSegments>({ segments: [], sources: [] })
    expect(FoundSegments.note(found)).toBe('Sepia Server недоступен, а в главах файла и TheIntroDB разметки нет')
  })

  // Web only.

  it('a down server is asked again after five minutes', async () => {
    let now = 1_000_000
    const availability = new ServerAvailability(300_000, () => now)
    const down = new MockFetch()
    down.fail('/v1/segments/55736')
    const f = finder(down, { chaptersOnly: true, availability })
    const episode = item(episodeJSON)
    const asked = () => down.requests.filter((r) => r.url.pathname === '/v1/segments/55736').length
    await f.find(episode)
    now += 299_000
    await f.find(episode)
    expect(asked()).toBe(1)
    now += 2_000
    await f.find(episode)
    expect(asked()).toBe(2)

    now += 301_000
    const up = new MockFetch()
    up.stub('/v1/segments/55736', '{"ratingKey":"55736","segments":[{"type":"intro","start":10,"end":40}],"analyzed":true}')
    const found = await finder(up, { chaptersOnly: true, availability }).find(episode)
    expect(found).toEqual<FoundSegments>({ segments: [seg('intro', 10, 40)], sources: ['server'] })
  })

  it('undecodable JSON or a timeout means unavailable, not empty', async () => {
    const mock = new MockFetch()
    mock.stub('/v1/segments/1', '<html>')
    mock.stub('/v1/segments/2', '[]')
    mock.stub('/v1/segments/3', '{}')
    const client = new SepiaServerClient('https://server.test', 'tok', mock.fetch)
    expect(await client.segmentsIfAvailable('1')).toBeNull()
    expect(await client.segmentsIfAvailable('2')).toBeNull()
    expect(await client.segmentsIfAvailable('3')).toEqual([])
    expect(await client.segmentsIfAvailable('4'), '404').toBeNull()
    const hanging = (_: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    expect(await new SepiaServerClient('https://server.test', 'tok', hanging, 20).segmentsIfAvailable('1')).toBeNull()
  })

  it('without a Sepia Server at all: straight to the fallback', async () => {
    const found = await new SegmentFinder({ sepiaServer: null, theIntroDB: null, availability: new ServerAvailability(), show: async () => undefined }).find(
      item(episodeJSON),
    )
    expect(found).toEqual<FoundSegments>({ segments: [seg('credits', 2655.45, 2932.576)], sources: ['chapters'] })
  })
})
