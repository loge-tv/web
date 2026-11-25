import { describe, expect, it } from 'vitest'
import { HTTPError } from '../http'
import { isYouTubeID, TMDBClient, titleParameter, trailerWatchURL } from '../tmdbClient'
import { MockFetch } from './support'

const base = 'https://tmdb.test'

describe('TMDBClient', () => {
  it('videos: TMDB trailers of a title, best first; only Accept and the builds’ token go out', async () => {
    const mock = new MockFetch()
    mock.stub(
      '/v1/videos',
      JSON.stringify({
        videos: [
          { key: 'abc', name: 'Трейлер', type: 'Trailer', language: 'ru', official: true, size: 1080 },
          { key: 'def', name: 'Teaser', type: 'Teaser', language: 'en', official: false },
        ],
      }),
    )
    const videos = await new TMDBClient(base, 'client', mock.fetch).videos('movie:603', 'ru')
    expect(videos.map((v) => v.key)).toEqual(['abc', 'def'])
    expect(videos[1]).toEqual({ key: 'def', name: 'Teaser', type: 'Teaser', language: 'en', official: false })
    expect(trailerWatchURL(videos[0])).toBe('https://www.youtube.com/watch?v=abc')
    expect(mock.last.url.searchParams.get('item')).toBe('movie:603')
    expect(mock.last.url.searchParams.get('language')).toBe('ru')
    // What the proxy's CORS allows; never a Plex token (the proxy answers 400 to one).
    expect([...mock.last.headers.keys()].sort()).toEqual(['accept', 'x-client-token'])
    expect(mock.last.headers.get('X-Client-Token')).toBe('client')
    // No token in the build: no header (a proxy without CLIENT_TOKEN takes that).
    await new TMDBClient(base, '', mock.fetch).videos('tv:1')
    expect([...mock.last.headers.keys()]).toEqual(['accept'])
    expect(mock.last.url.search).not.toContain('client')
  })

  it('every refusal throws: 404 is not «no TMDB key», 401 is a wrong builds’ token', async () => {
    for (const status of [400, 401, 404, 502]) {
      const mock = new MockFetch()
      mock.stub('/v1/videos', '{"error":"x"}', status)
      await expect(new TMDBClient(base, 'client', mock.fetch).videos('movie:1')).rejects.toMatchObject({ status })
    }
  })

  it('429 holds every route until Retry-After', async () => {
    let now = 1_000_000
    const requests: string[] = []
    let answer: Response = new Response('{"error":"too many requests"}', { status: 429, headers: { 'Retry-After': '30' } })
    const fetchFn = async (input: string) => {
      requests.push(new URL(input).pathname)
      return answer
    }
    const client = new TMDBClient(base, 'client', fetchFn, 20_000, () => now)
    await expect(client.videos('movie:1')).rejects.toBeInstanceOf(HTTPError)
    expect(requests).toHaveLength(1)
    // Held: nothing goes out, on any route.
    await expect(client.recommendations(['movie:1'])).rejects.toMatchObject({ status: 429 })
    await expect(client.titles([{ kind: 'movie', year: 2001, title: 'X' }])).rejects.toMatchObject({ status: 429 })
    expect(requests).toHaveLength(1)
    now += 30_000
    answer = new Response('{"videos":[]}')
    expect(await client.videos('movie:1')).toEqual([])
    expect(requests).toHaveLength(2)
  })

  it('titles: one item parameter each, answers in the order asked, `failed` kept', async () => {
    const mock = new MockFetch()
    mock.stub(
      '/v1/titles',
      JSON.stringify({ items: [{ tmdbId: 1307118, title: 'СОУЛМ8ЙТ' }, {}, { failed: true }] }),
    )
    const queries = [
      { kind: 'movie' as const, year: 2026, title: 'Soulm8te' },
      { kind: 'tv' as const, tmdbId: 70523, title: 'Dark: Origins' },
      { kind: 'movie' as const, year: 1999, title: 'Gone' },
      { kind: 'movie' as const, year: 2000, title: 'Missing from the answer' },
    ]
    const names = await new TMDBClient(base, 'client', mock.fetch).titles(queries)
    expect(mock.last.url.searchParams.getAll('item')).toEqual(['movie:2026:0:Soulm8te', 'tv:0:70523:Dark: Origins', 'movie:1999:0:Gone', 'movie:2000:0:Missing from the answer'])
    expect(mock.last.url.searchParams.get('language')).toBe('ru-RU')
    expect(names).toEqual([
      { tmdbId: 1307118, title: 'СОУЛМ8ЙТ', failed: false },
      { tmdbId: undefined, title: undefined, failed: false },
      { tmdbId: undefined, title: undefined, failed: true },
      { failed: true },
    ])
    expect(titleParameter({ kind: 'tv', title: 'A' })).toBe('tv:0:0:A')
    // Nothing to ask: no request.
    expect(await new TMDBClient(base, 'client', mock.fetch).titles([])).toEqual([])
    expect(mock.requests).toHaveLength(1)
  })

  it('only YouTube ids go into the player URL', () => {
    expect(isYouTubeID('dQw4w9WgXcQ')).toBe(true)
    expect(isYouTubeID('a-b_c')).toBe(true)
    expect(isYouTubeID('')).toBe(false)
    expect(isYouTubeID('x?autoplay=0')).toBe(false)
    expect(isYouTubeID('../evil')).toBe(false)
    expect(isYouTubeID('a'.repeat(33))).toBe(false)
  })
})
