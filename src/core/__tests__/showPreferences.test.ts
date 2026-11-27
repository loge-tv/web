import { describe, expect, it } from 'vitest'
import { SepiaServerClient } from '../sepiaServerClient'
import { track, type MediaTrack } from '../mediaTrack'
import { makeItem } from '../plexModels'
import {
  audioPreferenceFor,
  decodePreferences,
  emptyPreferences,
  encodePreferences,
  MemoryStorage,
  preferencesKey,
  preferredAudio,
  ShowPreferencesStore,
  ShowPreferencesSync,
  type ShowPreferences,
} from '../showPreferences'
import { adjustCorrection, correction } from '../skipCorrection'
import { MockFetch } from './support'

// Port of ShowPreferencesTests.swift.

function audio(id: number, lang: string | undefined, title: string | undefined, codec = 'ac3', channels = 6): MediaTrack {
  return track({ id, kind: 'audio', language: lang, title, codec, channels })
}

describe('remembered dub', () => {
  it('finds the same dub by title in another order', () => {
    const episode1 = [audio(1, 'rus', 'LostFilm'), audio(2, 'rus', 'HDrezka'), audio(3, 'eng', undefined)]
    const preference = audioPreferenceFor(episode1[1], episode1)
    expect(preference.indexInLanguage).toBe(1)

    const episode2 = [audio(1, 'rus', 'HDrezka Studio'), audio(2, 'ru', 'LostFilm'), audio(3, 'eng', undefined)]
    expect(preferredAudio(episode2, preference)?.id).toBe(1) // partial title match

    const episode3 = [audio(1, 'eng', undefined), audio(2, 'rus', 'hdrezka'), audio(3, 'rus', 'LostFilm')]
    expect(preferredAudio(episode3, preference)?.id).toBe(2) // case-insensitive
  })

  it('a format title does not switch language', () => {
    const preference = { language: 'rus', title: 'AC3 5.1', codec: 'ac3', channels: 6, indexInLanguage: 0 }
    const tracks = [audio(1, 'rus', 'DTS 5.1', 'dts'), audio(2, 'eng', 'AC3 5.1')]
    expect(preferredAudio(tracks, preference)?.id).toBe(1)
  })

  it('the original language is remembered', () => {
    const tracks = [audio(1, 'rus', 'Дубляж'), audio(2, 'eng', 'Original', 'eac3')]
    const preference = audioPreferenceFor(tracks[1], tracks)
    const next = [audio(1, 'rus', 'Дубляж'), audio(2, 'eng', undefined, 'eac3')]
    expect(preferredAudio(next, preference)?.id).toBe(2)
  })

  it('untitled files use the position within the language', () => {
    const tracks = [audio(1, 'rus', undefined), audio(2, 'rus', undefined), audio(3, 'eng', undefined)]
    const preference = audioPreferenceFor(tracks[1], tracks)
    const next = [audio(5, 'eng', undefined), audio(6, 'rus', undefined), audio(7, 'rus', undefined)]
    expect(preferredAudio(next, preference)?.id).toBe(7)
  })

  it('a missing dub falls back to the default', () => {
    const preference = { language: 'rus', title: 'LostFilm', codec: 'ac3', channels: 6, indexInLanguage: 0 }
    const other = [audio(1, 'rus', 'HDrezka'), audio(2, 'rus', 'Кубик в Кубе'), audio(3, 'eng', undefined)]
    expect(preferredAudio(other, preference)).toBeUndefined() // two other Russian dubs: don't guess

    const single = [audio(1, 'rus', 'Дубляж'), audio(2, 'eng', undefined)]
    expect(preferredAudio(single, preference)?.id).toBe(1) // the only track in that language

    expect(preferredAudio([audio(1, 'eng', undefined)], preference)).toBeUndefined()
  })
})

describe('preferences JSON', () => {
  it('round-trips', () => {
    let c = adjustCorrection(correction(), 'introStart', -2)
    c = adjustCorrection(c, 'creditsEnd', 9)
    const prefs: ShowPreferences = { correction: c, audio: { language: 'rus', title: 'LostFilm', indexInLanguage: 0 } }
    expect(prefs.correction.creditsEnd).toBe(9) // no limit on the size
    const decoded = decodePreferences(JSON.parse(JSON.stringify(encodePreferences(prefs))))
    expect(decoded).toEqual(prefs)
  })

  it('writes what the tvOS app writes', () => {
    const json = encodePreferences({ correction: correction({ introEnd: 2 }), audio: { language: 'rus', indexInLanguage: 1 } })
    expect(JSON.stringify(json)).toBe(
      '{"correction":{"introStart":0,"introEnd":2,"creditsStart":0,"creditsEnd":0},"audio":{"language":"rus","indexInLanguage":1}}',
    )
  })

  it('a broken audio object is dropped, unknown fields ignored', () => {
    expect(decodePreferences({ correction: { introEnd: 2, future: 1 }, audio: { language: 'eng' } })).toEqual({
      correction: correction({ introEnd: 2 }),
    })
    expect(decodePreferences({ audio: { language: 3, indexInLanguage: 0 } }).audio).toBeUndefined()
    expect(decodePreferences({ correction: { introStart: 'x', creditsEnd: -40 } }).correction).toEqual(correction({ creditsEnd: -40 }))
  })
})

describe('ShowPreferencesStore', () => {
  it('keeps shows apart', () => {
    const storage = new MemoryStorage()
    const store = new ShowPreferencesStore(storage)
    store.update('10', (p) => ({ ...p, correction: adjustCorrection(p.correction, 'introEnd', 2) }))
    store.update('20', (p) => ({ ...p, audio: { language: 'eng', indexInLanguage: 0 } }))
    expect(store.preferences('10').correction.introEnd).toBe(2)
    expect(store.preferences('10').audio).toBeUndefined()
    expect(store.preferences('20').audio?.language).toBe('eng')
    expect(store.preferences('30')).toEqual(emptyPreferences())

    const reopened = new ShowPreferencesStore(storage)
    expect(reopened.preferences('10').correction.introEnd).toBe(2)
    reopened.update('10', (p) => ({ ...p, correction: correction() }))
    expect(storage.getItem(ShowPreferencesStore.storageKey)).not.toContain('"10"') // empty entries are dropped
  })

  it('is dirty until uploaded and the server never overwrites unsent changes', () => {
    const store = new ShowPreferencesStore(new MemoryStorage())
    store.update('10', (p) => ({ ...p, correction: correction({ introStart: 2 }) }))
    expect([...store.dirtyKeys]).toEqual(['10'])
    store.replace('10', emptyPreferences())
    expect(store.preferences('10').correction.introStart).toBe(2) // unsent change wins

    const sent = store.preferences('10')
    store.update('10', (p) => ({ ...p, correction: correction({ introStart: 3 }) }))
    store.markClean('10', sent)
    expect([...store.dirtyKeys]).toEqual(['10']) // changed again while uploading
    store.markClean('10', store.preferences('10'))
    expect([...store.dirtyKeys]).toEqual([])

    store.replace('10', { correction: correction({ introEnd: -1 }) })
    expect(store.preferences('10').correction).toEqual(correction({ introEnd: -1 }))
    store.replace('10', null)
    expect(store.preferences('10')).toEqual(emptyPreferences()) // deleted on Sepia Server
  })

  it('entries from before sync are uploaded, not dropped', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      ShowPreferencesStore.storageKey,
      '{"10":{"correction":{"introStart":2,"introEnd":0,"creditsStart":0,"creditsEnd":0}}}',
    )
    const store = new ShowPreferencesStore(storage)
    expect([...store.dirtyKeys]).toEqual(['10'])
    store.replace('10', null)
    expect(store.preferences('10').correction.introStart).toBe(2)
    store.markClean('10', store.preferences('10'))
    expect([...new ShowPreferencesStore(storage).dirtyKeys]).toEqual([]) // migration runs once
  })

  it('notifies subscribers on changes', () => {
    const store = new ShowPreferencesStore(new MemoryStorage())
    let calls = 0
    const unsubscribe = store.subscribe(() => calls++)
    store.update('1', (p) => ({ ...p, correction: correction({ introEnd: 1 }) }))
    store.replace('2', null)
    unsubscribe()
    store.update('1', (p) => ({ ...p, correction: correction({ introEnd: 2 }) }))
    expect(calls).toBe(1)
  })

  it('episodes share the show key', () => {
    const episode = makeItem({ ratingKey: '101', type: 'episode', title: 'Pilot', grandparentRatingKey: '10' })
    expect(preferencesKey(episode)).toBe('10')
    expect(preferencesKey(makeItem({ ratingKey: '7', type: 'movie', title: 'Film' }))).toBe('7')
  })
})

describe('Sepia Server preferences', () => {
  const base = 'https://sepia.test'

  it('endpoints', async () => {
    const mock = new MockFetch()
    const client = new SepiaServerClient(base, 'tok', mock.fetch)
    mock.stub(
      '/v1/preferences/10',
      '{"key":"10","preferences":{"correction":{"introEnd":2,"future":1},"audio":{"language":"eng","indexInLanguage":0},"newField":true},"updatedAt":"2026-11-21T20:00:00Z"}',
    )
    const fetched = await client.fetchPreferences('10')
    expect(fetched?.correction).toEqual(correction({ introEnd: 2 })) // missing fields are 0, unknown ignored
    expect(fetched?.audio?.language).toBe('eng')

    mock.stub('/v1/preferences/20', '{"key":"20","preferences":null}')
    expect(await client.fetchPreferences('20')).toBeNull()

    mock.stub('/v1/preferences/30', '', 404)
    // An old Sepia Server must not look like "no preferences".
    await expect(client.fetchPreferences('30')).rejects.toThrow()

    mock.stub('/v1/preferences/10', '{"key":"10","preferences":{}}')
    await client.savePreferences({ correction: correction({ creditsEnd: -3 }) }, '10')
    const put = mock.last
    expect(put.method).toBe('PUT')
    expect(put.headers.get('X-Plex-Token')).toBe('tok')
    expect(put.headers.get('Content-Type')).toBe('application/json')
    expect(decodePreferences(JSON.parse(put.body!)).correction.creditsEnd).toBe(-3)
    await client.savePreferences(emptyPreferences(), '10')
    expect(mock.last.body).toBe('{}')
  })

  it('sync pushes unsent changes and pulls when clean', async () => {
    const offline = new MockFetch()
    const store = new ShowPreferencesStore(new MemoryStorage())
    const sync = new ShowPreferencesSync(store, () => new SepiaServerClient(base, 'tok', offline.fetch))

    store.update('10', (p) => ({ ...p, correction: correction({ introStart: 1 }) }))
    offline.fail('/v1/preferences/10')
    await sync.push()
    expect([...store.dirtyKeys]).toEqual(['10']) // offline: kept for later

    const online = new MockFetch()
    online.stub('/v1/preferences/10', '{"key":"10","preferences":{"correction":{"introStart":4}}}')
    const onlineSync = new ShowPreferencesSync(store, () => new SepiaServerClient(base, 'tok', online.fetch))
    await onlineSync.pull('10')
    expect(store.preferences('10').correction.introStart).toBe(1) // unsent local change is not overwritten
    await onlineSync.push()
    expect([...store.dirtyKeys]).toEqual([])
    expect(online.last.method).toBe('PUT')
    await onlineSync.pull('10')
    expect(store.preferences('10').correction.introStart).toBe(4) // clean: Sepia Server's copy wins
  })

  it('no Sepia Server: nothing happens', async () => {
    const store = new ShowPreferencesStore(new MemoryStorage())
    const sync = new ShowPreferencesSync(store, () => null)
    store.update('1', (p) => ({ ...p, correction: correction({ introEnd: 1 }) }))
    await sync.push()
    await sync.pull('1')
    expect([...store.dirtyKeys]).toEqual(['1'])
  })
})
