import { describe, expect, it } from 'vitest'
import { HTTPError, joinURL } from '../http'
import { candidateURLs, parseConnection, PlexAccountAPI, usableCandidateURLs, type PlexServer } from '../plexAccount'
import {
  collapseRecentlyAdded,
  displaySubtitle,
  displayTitle,
  dynamicRangeBadge,
  episodeLabel,
  isWatched,
  landscapePath,
  makeItem,
  orderContinueWatching,
  showsToLookUp,
  parseMetadata,
  parseSections,
  posterPath,
  primaryPart,
  progress,
  sectionKind,
  showRatingKey,
  unwatchedLeafCount,
} from '../plexModels'
import { PlexServerAPI } from '../plexServerAPI'
import { fixture, fixtureJSON, hostFetch, MockFetch, testClient } from './support'

// Port of PlexParsingTests.swift plus web-only parts (query auth, home ordering).

describe('Plex parsing', () => {
  it('sections', () => {
    const sections = parseSections(fixtureJSON('sections'))
    expect(sections.map((s) => s.title)).toEqual(['Фильмы', 'Сериалы', 'Музыка'])
    expect(sections.map(sectionKind)).toEqual(['movie', 'show', 'artist'])
  })

  it('episode with media', () => {
    const [item] = parseMetadata(fixtureJSON('episode'))
    expect(item.ratingKey).toBe('12345')
    expect(item.type).toBe('episode')
    expect(item.index).toBe(3)
    expect(item.parentIndex).toBe(2)
    expect(item.viewCount).toBe(1) // string number must be accepted
    expect(item.lastViewedAt).toBe(1700000500)
    expect(episodeLabel(item)).toBe('S2 · E3')
    expect(displayTitle(item)).toBe('Тестовый сериал')
    expect(displaySubtitle(item)).toBe('S2 · E3 — Пилот')
    expect(showRatingKey(item)).toBe('12200')
    expect(posterPath(item)).toBe('/library/metadata/12200/thumb/1700000000')
    expect(landscapePath(item)).toBe('/library/metadata/12345/thumb/1700000000')
    expect(progress(item)).toBeCloseTo(615 / 2990, 4)
    expect(isWatched(item)).toBe(false)

    const part = primaryPart(item)!
    expect(part.key).toBe('/library/parts/777/1690000000/file.mkv')
    expect(part.size).toBe(25_123_456_789)
    expect(part.streams).toHaveLength(5)
    expect(part.streams.filter((s) => s.streamType === 2).map((s) => s.languageCode)).toEqual(['eng', 'rus'])
    expect(part.streams[part.streams.length - 1].key).toBe('/library/streams/5')
    expect(item.media[0].videoCodec).toBe('hevc')
    expect(dynamicRangeBadge(item.media[0])).toBe('DOLBY VISION')
  })

  it('seasons watched counts', () => {
    const seasons = parseMetadata(fixtureJSON('seasons'))
    expect(seasons.map((s) => s.type)).toEqual(['season', 'season'])
    expect(isWatched(seasons[0])).toBe(true)
    expect(isWatched(seasons[1])).toBe(false)
    expect(unwatchedLeafCount(seasons[1])).toBe(5)
  })

  it('empty container', () => {
    expect(parseMetadata({ MediaContainer: { size: 0 } })).toEqual([])
  })

  it('watched movie', () => {
    const [item] = parseMetadata({ MediaContainer: { Metadata: [{ ratingKey: 5, type: 'movie', title: 'M', viewCount: 2 }] } })
    expect(item.ratingKey).toBe('5') // numeric ratingKey is accepted
    expect(isWatched(item)).toBe(true)
    expect(progress(item)).toBeUndefined()
  })
})

describe('plex.tv account', () => {
  it('servers from resources', async () => {
    const mock = new MockFetch()
    mock.stub('/api/v2/resources', fixture('resources'))
    const api = new PlexAccountAPI(testClient, mock.fetch)
    const servers = await api.servers('user-token')
    expect(servers).toHaveLength(1) // players are not servers
    expect(servers[0].name).toBe('Home')
    expect(servers[0].accessToken).toBe('server-token')

    const request = mock.requests[0]
    expect(request.url.searchParams.get('X-Plex-Token')).toBe('user-token')
    expect(request.url.searchParams.get('X-Plex-Client-Identifier')).toBe('test-client')
    expect(request.url.searchParams.get('includeHttps')).toBe('1')
    expect(request.headers.get('Accept')).toBe('application/json')
    expect([...request.headers.keys()]).toEqual(['accept']) // no custom headers: no CORS preflight
  })

  it('candidate URL order', () => {
    const raw = (fixtureJSON('resources') as { name: string; clientIdentifier: string; connections: unknown[] }[])[0]
    const server: PlexServer = {
      name: raw.name,
      clientIdentifier: raw.clientIdentifier,
      accessToken: 't',
      owned: true,
      connections: raw.connections.map(parseConnection).filter((c) => c !== null),
    }
    expect(candidateURLs(server)).toEqual([
      'https://192-168-0-10.abc.plex.direct:32400',
      'http://192.168.0.10:32400',
      'https://203-0-113-10.abc.plex.direct:32400',
      'https://plex.example.com',
      'https://198-51-100-1.abc.plex.direct:8443',
    ])
    expect(usableCandidateURLs(server, true)).not.toContain('http://192.168.0.10:32400') // mixed content
    expect(usableCandidateURLs(server, false)).toContain('http://192.168.0.10:32400')
  })

  it('PIN flow', async () => {
    const mock = new MockFetch()
    mock.stub('/api/v2/pins', '{"id":42,"code":"AB12xy","authToken":null,"expiresIn":900}', 201)
    mock.stub('/api/v2/pins/42', '{"id":42,"code":"AB12xy","authToken":"secret"}')
    const api = new PlexAccountAPI(testClient, mock.fetch)

    const pin = await api.createPin()
    expect(pin).toEqual({ id: 42, code: 'AB12xy', authToken: undefined, expiresIn: 900 })
    expect(mock.requests[0].method).toBe('POST')
    expect(mock.requests[0].url.searchParams.get('strong')).toBe('true')
    expect(mock.requests[0].url.searchParams.get('X-Plex-Product')).toBe('SkipTV')

    const checked = await api.checkPin(pin)
    expect(checked.authToken).toBe('secret')
    expect(mock.last.url.searchParams.get('code')).toBe('AB12xy')

    const auth = new URL(api.authURL(pin, 'https://skiptv.example/app/'))
    expect(auth.origin + auth.pathname).toBe('https://app.plex.tv/auth')
    const params = new URLSearchParams(auth.hash.slice(2))
    expect(params.get('clientID')).toBe('test-client')
    expect(params.get('code')).toBe('AB12xy')
    expect(params.get('forwardUrl')).toBe('https://skiptv.example/app/')
    expect(params.get('context[device][product]')).toBe('SkipTV')
  })
})

describe('Plex server API', () => {
  const base = 'http://server.test:32400'

  it('first reachable prefers order', async () => {
    const mock = new MockFetch()
    mock.fail('/identity')
    const local = 'http://local.test:32400'
    const remote = 'https://remote.test'
    expect(await PlexServerAPI.firstReachable([local, remote], 't', testClient, mock.fetch)).toBeUndefined()
    expect(await PlexServerAPI.firstReachable([local, remote], 't', testClient, hostFetch(['remote.test', 'local.test']))).toBe(local)
    expect(await PlexServerAPI.firstReachable([local, remote], 't', testClient, hostFetch(['remote.test']))).toBe(remote)
  })

  it('timeline and scrobble', async () => {
    const mock = new MockFetch()
    mock.stub('/:/timeline', '')
    mock.stub('/:/scrobble', '')
    const api = new PlexServerAPI(base, 'tok', testClient, mock.fetch)
    const item = makeItem({ ratingKey: '12345', type: 'episode', title: 'x' })

    await api.reportTimeline(item, 'paused', 61.7, 2990)
    const q = mock.last.url.searchParams
    expect(q.get('ratingKey')).toBe('12345')
    expect(q.get('key')).toBe('/library/metadata/12345')
    expect(q.get('state')).toBe('paused')
    expect(q.get('time')).toBe('61700')
    expect(q.get('duration')).toBe('2990000')
    expect(q.get('X-Plex-Token')).toBe('tok')
    expect(q.get('X-Plex-Client-Identifier')).toBe('test-client')

    await api.markWatched('12345')
    expect(decodeURIComponent(mock.last.url.pathname)).toBe('/:/scrobble')
    expect(mock.last.url.searchParams.get('key')).toBe('12345')
    expect(mock.last.url.searchParams.get('identifier')).toBe('com.plexapp.plugins.library')
  })

  it('URLs', () => {
    const api = new PlexServerAPI('https://plex.example/', 'tok', testClient)
    expect(api.directPlayURL({ id: '1', key: '/library/parts/777/1690000000/file.mkv', streams: [] })).toBe(
      'https://plex.example/library/parts/777/1690000000/file.mkv?X-Plex-Token=tok',
    )
    const image = new URL(api.imageURL('/library/metadata/1/thumb/2?a=1&b=2', 300, 450)!)
    expect(image.pathname).toBe('/photo/:/transcode')
    expect(image.searchParams.get('url')).toBe('/library/metadata/1/thumb/2?a=1&b=2')
    expect(image.searchParams.get('width')).toBe('300')
    expect(api.imageURL(undefined, 1, 1)).toBeUndefined()
    expect(api.bifURL({ id: '9', key: '', indexes: 'sd', streams: [] })).toBe('https://plex.example/library/parts/9/indexes/sd?X-Plex-Token=tok')
    expect(api.bifURL({ id: '9', key: '', streams: [] })).toBeUndefined()
  })

  it('transcode URL keeps as close to direct stream as possible', () => {
    const api = new PlexServerAPI('https://plex.example', 'tok', testClient)
    const url = new URL(
      api.transcodeURL({ item: makeItem({ ratingKey: '55', type: 'movie' }), session: 's1', offset: 61.7, local: true, burnSubtitles: false }),
    )
    expect(decodeURIComponent(url.pathname)).toBe('/video/:/transcode/universal/start.m3u8')
    const q = url.searchParams
    expect(q.get('path')).toBe('/library/metadata/55')
    expect(q.get('protocol')).toBe('hls')
    expect(q.get('directStream')).toBe('1')
    expect(q.get('directStreamAudio')).toBe('1')
    expect(q.get('offset')).toBe('61')
    expect(q.get('subtitles')).toBe('none')
    expect(q.get('location')).toBe('lan')
    expect(q.get('session')).toBe('s1')
    expect(q.get('X-Plex-Token')).toBe('tok')
  })

  it('stream selection is a PUT on the part', async () => {
    const mock = new MockFetch()
    mock.stub('/library/parts/777', '')
    const api = new PlexServerAPI(base, 'tok', testClient, mock.fetch)
    await api.selectStreams({ id: '777', key: '', streams: [] }, { audioStreamID: 3, subtitleStreamID: 0 })
    expect(mock.last.method).toBe('PUT')
    expect(mock.last.url.searchParams.get('audioStreamID')).toBe('3')
    expect(mock.last.url.searchParams.get('subtitleStreamID')).toBe('0')
    expect(mock.last.url.searchParams.get('allParts')).toBe('1')
  })

  it('items query', async () => {
    const mock = new MockFetch()
    mock.stub('/library/sections/2/all', fixture('seasons'))
    const api = new PlexServerAPI(base, 'tok', testClient, mock.fetch)
    await api.items({ key: '2', title: 'Сериалы', type: 'show' })
    expect(mock.last.url.searchParams.get('type')).toBe('2')
    expect(mock.last.url.searchParams.get('sort')).toBe('titleSort')
  })

  it('server error throws', async () => {
    const mock = new MockFetch()
    mock.stub('/library/onDeck', '', 401)
    const api = new PlexServerAPI(base, 'tok', testClient, mock.fetch)
    await expect(api.onDeck()).rejects.toBeInstanceOf(HTTPError)
    await expect(api.onDeck()).rejects.toMatchObject({ status: 401 })
  })
})

describe('items by keys', () => {
  it('one request with comma-separated keys, none when empty', async () => {
    const mock = new MockFetch()
    mock.stub('/library/metadata/20,30', JSON.stringify({ MediaContainer: { Metadata: [{ ratingKey: '20', type: 'show', title: 'A', lastViewedAt: 5 }] } }))
    const api = new PlexServerAPI('http://server.test:32400', 'tok', testClient, mock.fetch)
    expect((await api.itemsByKeys(['20', '30'])).map((i) => i.lastViewedAt)).toEqual([5])
    expect(await api.itemsByKeys([])).toEqual([])
    expect(mock.requests.length).toBe(1)
  })
})

describe('home', () => {
  it('continue watching: one list by last viewed, untimed items last in Plex order', () => {
    const items = [
      makeItem({ ratingKey: 'next1', type: 'episode' }),
      makeItem({ ratingKey: 'old', type: 'episode', viewOffset: 1000, lastViewedAt: 100 }),
      makeItem({ ratingKey: 'next2', type: 'episode', viewOffset: 0 }),
      makeItem({ ratingKey: 'recent', type: 'movie', viewOffset: 5000, lastViewedAt: 300 }),
      makeItem({ ratingKey: 'middle', type: 'episode', viewOffset: 5000, lastViewedAt: 200 }),
    ]
    expect(orderContinueWatching(items).map((i) => i.ratingKey)).toEqual(['recent', 'middle', 'old', 'next1', 'next2'])
  })

  it('continue watching: next-up by when the show was last watched, no priority for in progress', () => {
    const next = (key: string, show: string, lastViewedAt?: number) =>
      makeItem({ ratingKey: key, type: 'episode', grandparentRatingKey: show, lastViewedAt })
    const items = [
      next('a', 'show-a'),
      makeItem({ ratingKey: 'started', type: 'episode', viewOffset: 1000, lastViewedAt: 50, grandparentRatingKey: 'show-a' }),
      next('b', 'show-b'),
      next('c', 'show-c', 250),
      next('d', 'show-d'),
    ]
    const showLastViewed = { 'show-a': 100, 'show-b': 300 }
    // c has no show entry and falls back to its own lastViewedAt; d has nothing and stays last;
    // the half-watched episode was watched before the shows of a, b and c.
    expect(orderContinueWatching(items, showLastViewed).map((i) => i.ratingKey)).toEqual(['b', 'c', 'a', 'started', 'd'])
  })

  it('shows to look up: next-up episodes only, once per show', () => {
    const items = [
      makeItem({ ratingKey: '1', type: 'episode', grandparentRatingKey: 's1' }),
      makeItem({ ratingKey: '2', type: 'episode', grandparentRatingKey: 's1' }),
      makeItem({ ratingKey: '3', type: 'episode', grandparentRatingKey: 's2', viewOffset: 10 }),
      makeItem({ ratingKey: '4', type: 'movie' }),
      makeItem({ ratingKey: '5', type: 'episode', grandparentRatingKey: 's3' }),
    ]
    expect(showsToLookUp(items)).toEqual(['s1', 's3'])
  })

  it('recently added episodes collapse to one card per season', () => {
    const ep = (key: string, season: string) =>
      makeItem({
        ratingKey: key,
        type: 'episode',
        parentRatingKey: season,
        parentTitle: `Сезон ${season}`,
        parentIndex: Number(season),
        grandparentRatingKey: 'show',
        grandparentTitle: 'Сериал',
        parentThumb: `/s${season}`,
      })
    const result = collapseRecentlyAdded([ep('1', '1'), ep('2', '1'), makeItem({ ratingKey: 'm', type: 'movie' }), ep('3', '2')])
    expect(result.map((i) => [i.type, i.ratingKey])).toEqual([
      ['season', '1'],
      ['movie', 'm'],
      ['season', '2'],
    ])
    expect(result[0].title).toBe('Сезон 1')
    expect(result[0].parentRatingKey).toBe('show')
    expect(result[0].thumb).toBe('/s1')
    expect(displayTitle(result[0])).toBe('Сериал')
  })
})

describe('joinURL', () => {
  it('keeps existing queries and encodes nested URLs', () => {
    expect(joinURL('https://a.test/', '/x?y=1', { url: '/a?b=1&c=2' })).toBe('https://a.test/x?y=1&url=%2Fa%3Fb%3D1%26c%3D2')
    expect(joinURL('https://a.test', 'p', { "k(1)": "v'!" })).toBe('https://a.test/p?k%281%29=v%27%21')
  })
})
