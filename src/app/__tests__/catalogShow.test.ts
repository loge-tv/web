import { describe, expect, it } from 'vitest'
import { PlexDiscoverAPI } from '../../core/plexDiscover'
import { entryWatched, mergeShowCatalog } from '../../core/showCatalog'
import { MockFetch, testClient } from '../../core/__tests__/support'
import { CatalogShow, CatalogShowText } from '../catalogShow'

const container = (items: object[]) => JSON.stringify({ MediaContainer: { size: items.length, Metadata: items } })
const userStates = (items: object[]) => JSON.stringify({ MediaContainer: { UserState: items } })

function setUp() {
  const mock = new MockFetch()
  mock.stub('/library/metadata/show/children', container([{ ratingKey: 's1', type: 'season', title: 'Сезон 1', index: 1, leafCount: 2 }]))
  mock.stub('/library/metadata/s1/userState', userStates([{ ratingKey: 's1', viewedLeafCount: 1 }]))
  mock.stub(
    '/library/metadata/s1/children',
    container([
      { ratingKey: 'e1', type: 'episode', title: 'Серия 1', index: 1 },
      { ratingKey: 'e2', type: 'episode', title: 'Серия 2', index: 2 },
    ]),
  )
  mock.stub('/library/metadata/e1,e2/userState', userStates([{ ratingKey: 'e1', viewCount: 1, viewState: 'complete' }]))
  mock.stub('/actions/scrobble', '')
  mock.stub('/actions/unscrobble', '')
  const show = new CatalogShow()
  return { mock, show, discover: new PlexDiscoverAPI('t', testClient, mock.fetch) }
}

describe('CatalogShow', () => {
  it('loads seasons, then a season\'s episodes, each with the account\'s marks, once', async () => {
    const { mock, show, discover } = setUp()
    await show.load('show', discover)
    await show.load('show', discover)
    expect(show.getSnapshot().seasons.map((s) => s.ratingKey)).toEqual(['s1'])
    expect(show.getSnapshot().states.get('s1')?.viewedLeafCount).toBe(1)
    await show.loadEpisodes('s1', discover)
    await show.loadEpisodes('s1', discover)
    const entries = mergeShowCatalog([], show.getSnapshot().episodes.s1, show.getSnapshot().states)
    expect(entries.map(entryWatched)).toEqual([true, false])
    expect(mock.requests.filter((r) => r.url.pathname.endsWith('/children'))).toHaveLength(2)
  })

  it('a season mark takes its episodes along; an episode\'s asks the seasons again', async () => {
    const { mock, show, discover } = setUp()
    await show.load('show', discover)
    await show.loadEpisodes('s1', discover)
    const season = show.getSnapshot().seasons[0]
    await show.setWatched(season, true, discover)
    expect(mock.last.url.pathname).toBe('/actions/scrobble')
    expect(mock.last.url.searchParams.get('key')).toBe('s1')
    const states = show.getSnapshot().states
    expect(['s1', 'e1', 'e2'].map((k) => states.get(k)?.viewState)).toEqual(['complete', 'complete', 'complete'])
    const asked = mock.requests.length
    await show.setWatched(show.getSnapshot().episodes.s1[1], false, discover)
    expect(mock.requests[asked].url.pathname).toBe('/actions/unscrobble')
    expect(mock.requests.at(-1)?.url.pathname).toBe('/library/metadata/s1/userState')
  })

  it('a refused mark goes back and says so', async () => {
    const { mock, show, discover } = setUp()
    await show.load('show', discover)
    await show.loadEpisodes('s1', discover)
    mock.stub('/actions/scrobble', 'no', 500)
    const episode = show.getSnapshot().episodes.s1[1]
    await show.setWatched(episode, true, discover)
    expect(show.getSnapshot().states.get('e2')).toBeUndefined()
    expect(show.getSnapshot().failure).toBe(CatalogShowText.failed('Серия 2'))
    show.dismissFailure()
    expect(show.getSnapshot().failure).toBeUndefined()
  })
})
