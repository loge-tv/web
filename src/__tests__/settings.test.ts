import { afterEach, describe, expect, it } from 'vitest'
import { emptyShelves } from '../core/catalogMatch'
import { makeDiscoverItem } from '../core/plexDiscover'
import { parseSettings, settingsStore, shelfShown, visibleShelves, withShelfShown } from '../settings'
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
