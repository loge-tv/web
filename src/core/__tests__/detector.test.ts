import { describe, expect, it } from 'vitest'
import { DEFAULT_DETECTOR_URL, DetectorClient, normalizeDetectorURL } from '../detectorClient'
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
})
