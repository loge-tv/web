import { afterEach, describe, expect, it } from 'vitest'
import { emptyShelves } from '../core/catalogMatch'
import { makeDiscoverItem } from '../core/plexDiscover'
import {
  defaultShelfOrder,
  exploreHubOrder,
  hasDefaultHubOrder,
  hasDefaultShelfOrder,
  homeShelfOrder,
  hubShown,
  parseSettings,
  settingsStore,
  shelfInfo,
  shelfShown,
  showsExplore,
  visibleHomeShelves,
  visibleShelves,
  wantsRecommendations,
  withShelfShown,
} from '../settings'
import { readJSON, StorageKey } from '../storage'

describe('home shelves in settings', () => {
  afterEach(() => settingsStore.update({ hiddenShelves: [] }))

  it('both shelves are on by default', () => {
    const settings = parseSettings(undefined)
    expect(settings.hiddenShelves).toEqual([])
    expect(shelfShown(settings, 'wanted')).toBe(true)
    expect(shelfShown(settings, 'upcoming')).toBe(true)
    // Settings saved before the shelves existed.
    expect(parseSettings({ skipMode: 'auto' }).hiddenShelves).toEqual([])
  })

  it('stored hidden shelves are cleaned up', () => {
    expect(parseSettings({ hiddenShelves: ['upcoming', 'junk', 'upcoming'] }).hiddenShelves).toEqual(['upcoming'])
    expect(parseSettings({ hiddenShelves: 'upcoming' }).hiddenShelves).toEqual([])
    expect(parseSettings({ hiddenShelves: ['upcoming', 'wanted'] }).hiddenShelves).toEqual(['wanted', 'upcoming'])
  })

  it('turning a shelf off and on', () => {
    expect(withShelfShown([], 'upcoming', false)).toEqual(['upcoming'])
    expect(withShelfShown(['upcoming'], 'wanted', false)).toEqual(['wanted', 'upcoming'])
    expect(withShelfShown(['wanted', 'upcoming'], 'wanted', true)).toEqual(['upcoming'])
    expect(withShelfShown(['upcoming'], 'upcoming', false)).toEqual(['upcoming'])
  })

  it('is persisted with the other settings and read back', () => {
    settingsStore.setShelfShown('upcoming', false)
    const stored = readJSON<Record<string, unknown>>(StorageKey.settings)
    expect(stored?.hiddenShelves).toEqual(['upcoming'])
    const reloaded = parseSettings(stored)
    expect(shelfShown(reloaded, 'upcoming')).toBe(false)
    expect(shelfShown(reloaded, 'wanted')).toBe(true)
    settingsStore.setShelfShown('upcoming', true)
    expect(readJSON<Record<string, unknown>>(StorageKey.settings)?.hiddenShelves).toEqual([])
  })

  it('home shows only the shelves turned on', () => {
    const entry = makeDiscoverItem({ ratingKey: 'k', kind: 'movie', title: 'K' })
    const shelves = { wanted: [entry], upcoming: [entry] }
    expect(visibleShelves(shelves, parseSettings({ hiddenShelves: ['upcoming'] }))).toEqual({ wanted: [entry], upcoming: [] })
    expect(visibleShelves(shelves, parseSettings({ hiddenShelves: ['wanted', 'upcoming'] }))).toEqual(emptyShelves)
    expect(visibleShelves(shelves, parseSettings({}))).toEqual(shelves)
  })
})

describe('every home shelf in settings: off, order, «Обзор»', () => {
  const sections = [
    { key: '1', title: 'Фильмы', type: 'movie' },
    { key: '2', title: 'Сериалы', type: 'show' },
  ]
  afterEach(() => settingsStore.update({ hiddenShelves: [], shelfOrder: [], hiddenHubs: [], hubOrder: [] }))

  it('the default order: continue, the list, a «Недавно добавлено» per library, recommendations', () => {
    expect(defaultShelfOrder(sections)).toEqual([
      'continue',
      'wanted',
      'upcoming',
      'recent:1',
      'recent:2',
      'similarOnServer',
      'because',
      'moreWithCast',
    ])
    expect(shelfInfo('recent:2', sections).title).toBe('Недавно добавлено · Сериалы')
    expect(shelfInfo('recent:9', sections).title).toBe('Недавно добавлено')
  })

  it('stored ids are cleaned up; libraries of other servers are kept', () => {
    const settings = parseSettings({
      hiddenShelves: ['moreWithCast', 'recent:7', 'continue', 'junk', 'recent:'],
      shelfOrder: ['recent:7', 'because', 'because', 7, 'junk'],
      hiddenHubs: ['coming-soon', 'junk', 'trending-plex'],
      hubOrder: ['coming-soon', 'junk', 'coming-soon', 3, 'trending-plex'],
      preferredLanguage: 'xx',
    })
    expect(settings.hiddenShelves).toEqual(['continue', 'recent:7', 'moreWithCast'])
    expect(settings.shelfOrder).toEqual(['recent:7', 'because'])
    expect(settings.hiddenHubs).toEqual(['trending-plex', 'coming-soon'])
    expect(settings.hubOrder).toEqual(['coming-soon', 'trending-plex'])
    expect(parseSettings({ hubOrder: 'coming-soon' }).hubOrder).toEqual([])
    expect(parseSettings(undefined).hubOrder).toEqual([])
    expect(settings.preferredLanguage).toBe('ru')
    expect(parseSettings({ preferredLanguage: 'en' }).preferredLanguage).toBe('en')
  })

  it('moving a shelf saves the order; reset goes back to the default', () => {
    settingsStore.moveShelf('moreWithCast', -1, sections)
    const moved = homeShelfOrder(settingsStore.get(), sections)
    expect(moved.slice(-2)).toEqual(['moreWithCast', 'because'])
    expect(hasDefaultShelfOrder(settingsStore.get(), sections)).toBe(false)
    // Another server's library keeps its place in what is saved.
    settingsStore.update({ shelfOrder: ['recent:7', ...moved] })
    settingsStore.moveShelf('continue', 1, sections)
    expect(settingsStore.get().shelfOrder.slice(0, 3)).toEqual(['recent:7', 'wanted', 'continue'])
    settingsStore.resetShelfOrder()
    expect(hasDefaultShelfOrder(settingsStore.get(), sections)).toBe(true)
  })

  it('Home shows the shelves turned on, in order; TMDB only while a recommendation shelf is on', () => {
    settingsStore.update({ shelfOrder: ['similarOnServer', 'continue'], hiddenShelves: ['wanted', 'recent:2'] })
    // Shelves missing from the saved order follow their default predecessor.
    expect(visibleHomeShelves(settingsStore.get(), sections)).toEqual(['similarOnServer', 'because', 'moreWithCast', 'continue', 'upcoming', 'recent:1'])
    expect(wantsRecommendations(settingsStore.get())).toBe(true)
    settingsStore.update({ hiddenShelves: ['similarOnServer', 'because', 'moreWithCast'] })
    expect(wantsRecommendations(settingsStore.get())).toBe(false)
  })

  it('«Обзор» is there while any collection is on', () => {
    expect(showsExplore(settingsStore.get())).toBe(true)
    settingsStore.setHubShown('coming-soon', false)
    expect(hubShown(settingsStore.get(), 'coming-soon')).toBe(false)
    for (const id of ['trending-plex', 'top_watchlisted', 'highly-anticipated-movies'] as const) settingsStore.setHubShown(id, false)
    expect(showsExplore(settingsStore.get())).toBe(false)
    settingsStore.setHubShown('trending-plex', true)
    expect(settingsStore.get().hiddenHubs).toEqual(['top_watchlisted', 'coming-soon', 'highly-anticipated-movies'])
  })

  it('«Обзор» collections: the default order, moved, a saved order with gaps, reset', () => {
    const all = ['trending-plex', 'top_watchlisted', 'coming-soon', 'highly-anticipated-movies']
    expect(exploreHubOrder(settingsStore.get())).toEqual(all)
    expect(hasDefaultHubOrder(settingsStore.get())).toBe(true)
    settingsStore.moveHub('coming-soon', -1)
    settingsStore.moveHub('coming-soon', -1)
    settingsStore.moveHub('coming-soon', -1) // already first: stays
    expect(exploreHubOrder(settingsStore.get())).toEqual(['coming-soon', 'trending-plex', 'top_watchlisted', 'highly-anticipated-movies'])
    expect(readJSON<{ hubOrder: string[] }>(StorageKey.settings)?.hubOrder).toEqual(exploreHubOrder(settingsStore.get()))
    expect(hasDefaultHubOrder(settingsStore.get())).toBe(false)
    // The shelves' order is a list of its own.
    expect(settingsStore.get().shelfOrder).toEqual([])
    // A collection missing from the saved order follows its default predecessor.
    settingsStore.update({ hubOrder: ['highly-anticipated-movies', 'trending-plex'] })
    expect(exploreHubOrder(settingsStore.get())).toEqual(['highly-anticipated-movies', 'trending-plex', 'top_watchlisted', 'coming-soon'])
    settingsStore.resetHubOrder()
    expect(exploreHubOrder(settingsStore.get())).toEqual(all)
    expect(hasDefaultHubOrder(settingsStore.get())).toBe(true)
  })
})

describe('Sepia Server address in settings', () => {
  it('the old key is carried over and dropped', () => {
    const s = parseSettings({ detectorURL: 'http://192.168.1.5:32420', skipMode: 'auto' })
    expect(s.sepiaServerURL).toBe('http://192.168.1.5:32420')
    expect('detectorURL' in s).toBe(false)
  })

  it('the new key wins over the old one', () => {
    expect(parseSettings({ detectorURL: 'http://old', sepiaServerURL: 'http://new' }).sepiaServerURL).toBe('http://new')
  })
})
