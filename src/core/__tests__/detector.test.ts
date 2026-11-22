import { describe, expect, it } from 'vitest'
import { DEFAULT_DETECTOR_URL, DetectorClient, isYouTubeID, normalizeDetectorURL, trailerWatchURL } from '../detectorClient'
import { discoverTmdbID, parseDiscoverItem } from '../plexDiscover'
import { fixture, MockFetch } from './support'

// Port of DetectorClientTests.swift.

const base = 'https://detector.test'

describe('DetectorClient', () => {
  it('segments are sanitized and sorted', async () => {
    const mock = new MockFetch()
    mock.stub('/v1/segments/12345', fixture('segments'))
    const client = new DetectorClient(base, 'tok', mock.fetch)
    expect(await client.segments('12345')).toEqual([
      { type: 'intro', start: 17.5, end: 61.7 },
      { type: 'credits', start: 2909.1, end: 2987.9 },
    ]) // unknown type and inverted segment are dropped
    expect(mock.requests[0].headers.get('X-Plex-Token')).toBe('tok')
    // Only headers the detector's CORS allows.
    expect([...mock.requests[0].headers.keys()].sort()).toEqual(['accept', 'x-plex-token'])
  })

  it('file URL of a part, token in the query for <video src>', () => {
    const client = new DetectorClient(base, 'tok')
    const part = { id: '1178507', key: '/library/parts/1178507/1794754192/file.mkv', streams: [] }
    expect(client.fileURL('55549', part)).toBe('https://detector.test/v1/files/55549/1178507/file.mkv?X-Plex-Token=tok')
    // No extension in the key: the container.
    expect(client.fileURL('1', { id: '7', key: '/library/parts/7/1/file', container: 'mp4', streams: [] })).toBe(
      'https://detector.test/v1/files/1/7/file.mp4?X-Plex-Token=tok',
    )
    expect(client.fileURL('1', { id: '', key: '/x.mkv', streams: [] })).toBeUndefined()
  })

  it('an unavailable detector gives no segments', async () => {
    const mock = new MockFetch()
    mock.fail('/v1/segments/1')
    const client = new DetectorClient(base, 'tok', mock.fetch)
    expect(await client.segments('1')).toEqual([])

    mock.stub('/v1/segments/2', '{"error":"not found"}', 404)
    expect(await client.segments('2')).toEqual([])

    mock.stub('/v1/segments/3', '<html>')
    expect(await client.segments('3')).toEqual([])
  })

  it('batch: bare array', async () => {
    const mock = new MockFetch()
    mock.stub('/v1/segments', fixture('segments_batch'))
    const client = new DetectorClient(base, 'tok', mock.fetch)
    const result = await client.segmentsBatch(['1', '2'])
    expect(result['1']).toEqual([{ type: 'intro', start: 0, end: 45 }])
    expect(result['2']).toEqual([])
    expect(mock.requests[0].url.searchParams.get('ratingKeys')).toBe('1,2')
  })

  it('batch: items object', async () => {
    const mock = new MockFetch()
    mock.stub('/v1/segments', fixture('segments_batch_items'))
    const client = new DetectorClient(base, 'tok', mock.fetch)
    const result = await client.segmentsBatch(['1', '2'])
    expect(result['1']).toEqual([
      { type: 'intro', start: 0, end: 45 },
      { type: 'credits', start: 2900, end: 2990 },
    ])
    expect(result['2']).toEqual([])
  })

  it('batch: empty items', async () => {
    const mock = new MockFetch()
    mock.stub('/v1/segments', '{"items":[]}')
    const client = new DetectorClient(base, 'tok', mock.fetch)
    expect(await client.segmentsBatch(['1'])).toEqual({})
  })

  it('a slow detector times out into no segments', async () => {
    const hanging = (_: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    const client = new DetectorClient(base, 'tok', hanging, 20)
    expect(await client.segments('1')).toEqual([])
  })

  it('normalizes the configured URL', () => {
    expect(normalizeDetectorURL(' https://d.test/ ')).toBe('https://d.test')
    expect(normalizeDetectorURL('ftp://x')).toBe(DEFAULT_DETECTOR_URL)
    expect(normalizeDetectorURL('')).toBe(DEFAULT_DETECTOR_URL)
  })

  it('videos: TMDB trailers of a title, null without a TMDB key', async () => {
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
    const client = new DetectorClient(base, 'tok', mock.fetch)
    const videos = await client.videos('movie:603', 'ru')
    expect(videos?.map((v) => v.key)).toEqual(['abc', 'def'])
    expect(videos?.[1]).toEqual({ key: 'def', name: 'Teaser', type: 'Teaser', language: 'en', official: false })
    expect(trailerWatchURL(videos![0])).toBe('https://www.youtube.com/watch?v=abc')
    expect(mock.last.url.searchParams.get('item')).toBe('movie:603')
    expect(mock.last.url.searchParams.get('language')).toBe('ru')
    expect(mock.last.headers.get('X-Plex-Token')).toBe('tok')

    const none = new MockFetch()
    none.stub('/v1/videos', JSON.stringify({ configured: false }), 404)
    expect(await new DetectorClient(base, 'tok', none.fetch).videos('tv:1')).toBeNull()
  })

  it('only YouTube ids go into the player URL', () => {
    expect(isYouTubeID('dQw4w9WgXcQ')).toBe(true)
    expect(isYouTubeID('a-b_c')).toBe(true)
    expect(isYouTubeID('')).toBe(false)
    expect(isYouTubeID('x?autoplay=0')).toBe(false)
    expect(isYouTubeID('../evil')).toBe(false)
    expect(isYouTubeID('a'.repeat(33))).toBe(false)
  })

  it('a catalog title has its TMDB id in the details', () => {
    const item = parseDiscoverItem({ ratingKey: '5d77', type: 'movie', title: 'X', Guid: [{ id: 'imdb://tt1' }, { id: 'tmdb://603' }] })
    expect(item && discoverTmdbID(item)).toBe(603)
  })
})
