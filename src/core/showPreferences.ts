import { Language, type MediaTrack } from './mediaTrack'
import type { PlexItem } from './plexModels'
import { correctionsEqual, decodeCorrection, isZeroCorrection, NO_CORRECTION, type SkipCorrection } from './skipCorrection'

/**
 * An audio track chosen by the user, described so it can be found again in other
 * episodes, where track ids and order may differ. The dub studio is usually in the title.
 */
export interface AudioPreference {
  language?: string
  title?: string
  codec?: string
  channels?: number
  /** Position among the file's tracks of the same language (files without titles). */
  indexInLanguage: number
}

/** What the user chose for one show; applies to every episode. Same JSON as the tvOS app. */
export interface ShowPreferences {
  correction: SkipCorrection
  audio?: AudioPreference
}

export function emptyPreferences(): ShowPreferences {
  return { correction: { ...NO_CORRECTION } }
}

export function isEmptyPreferences(p: ShowPreferences): boolean {
  return isZeroCorrection(p.correction) && !p.audio
}

function optionalString(value: unknown): { ok: boolean; value?: string } {
  if (value === undefined || value === null) return { ok: true }
  return typeof value === 'string' ? { ok: true, value } : { ok: false }
}

/** Like Swift's Decodable: a broken audio object is dropped as a whole. */
export function decodeAudioPreference(raw: unknown): AudioPreference | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.indexInLanguage !== 'number' || !Number.isInteger(r.indexInLanguage)) return undefined
  const language = optionalString(r.language)
  const title = optionalString(r.title)
  const codec = optionalString(r.codec)
  if (!language.ok || !title.ok || !codec.ok) return undefined
  let channels: number | undefined
  if (r.channels !== undefined && r.channels !== null) {
    if (typeof r.channels !== 'number' || !Number.isInteger(r.channels)) return undefined
    channels = r.channels
  }
  const result: AudioPreference = { indexInLanguage: r.indexInLanguage }
  if (language.value !== undefined) result.language = language.value
  if (title.value !== undefined) result.title = title.value
  if (codec.value !== undefined) result.codec = codec.value
  if (channels !== undefined) result.channels = channels
  return result
}

/** Lenient: the detector keeps whatever another app version wrote. */
export function decodePreferences(raw: unknown): ShowPreferences {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const result: ShowPreferences = { correction: decodeCorrection(r.correction) }
  const audio = decodeAudioPreference(r.audio)
  if (audio) result.audio = audio
  return result
}

/** JSON the tvOS app writes: all four correction fields, optional audio fields omitted. */
export function encodePreferences(p: ShowPreferences): Record<string, unknown> {
  const out: Record<string, unknown> = {
    correction: {
      introStart: p.correction.introStart,
      introEnd: p.correction.introEnd,
      creditsStart: p.correction.creditsStart,
      creditsEnd: p.correction.creditsEnd,
    },
  }
  if (p.audio) {
    const audio: Record<string, unknown> = {}
    if (p.audio.language !== undefined) audio.language = p.audio.language
    if (p.audio.title !== undefined) audio.title = p.audio.title
    if (p.audio.codec !== undefined) audio.codec = p.audio.codec
    if (p.audio.channels !== undefined) audio.channels = p.audio.channels
    audio.indexInLanguage = Math.trunc(p.audio.indexInLanguage)
    out.audio = audio
  }
  return out
}

/** Body of a PUT: `{}` deletes the detector's copy. */
export function preferencesBody(p: ShowPreferences): string {
  return isEmptyPreferences(p) ? '{}' : JSON.stringify(encodePreferences(p))
}

export function audioPreferencesEqual(a: AudioPreference | undefined, b: AudioPreference | undefined): boolean {
  if (!a || !b) return !a && !b
  return (
    a.language === b.language &&
    a.title === b.title &&
    a.codec === b.codec &&
    a.channels === b.channels &&
    a.indexInLanguage === b.indexInLanguage
  )
}

export function preferencesEqual(a: ShowPreferences, b: ShowPreferences): boolean {
  return correctionsEqual(a.correction, b.correction) && audioPreferencesEqual(a.audio, b.audio)
}

export function audioPreferenceFor(t: MediaTrack, tracks: MediaTrack[]): AudioPreference {
  const sameLanguage = tracks.filter((x) => x.kind === 'audio' && Language.same(x.language, t.language))
  const index = sameLanguage.findIndex((x) => x.id === t.id)
  const result: AudioPreference = { indexInLanguage: index >= 0 ? index : 0 }
  if (t.language !== undefined) result.language = t.language
  if (t.title !== undefined) result.title = t.title
  if (t.codec !== undefined) result.codec = t.codec
  if (t.channels !== undefined) result.channels = t.channels
  return result
}

function isUnknownLanguage(language: string | undefined): boolean {
  const code = language?.toLowerCase() ?? ''
  return code === '' || code === 'und'
}

function normalizedTitle(title: string | undefined): string | undefined {
  const value = title?.trim().toLowerCase() ?? ''
  return value === '' ? undefined : value
}

function score(t: MediaTrack, p: AudioPreference): number {
  let s = 0
  if (Language.same(t.language, p.language)) s += 4
  if (p.codec !== undefined && t.codec?.toLowerCase() === p.codec.toLowerCase()) s += 2
  if (p.channels !== undefined && t.channels === p.channels) s += 1
  return s
}

/** First of the best-scoring candidates (Swift's `max(by:)`). */
function bestMatch(candidates: MediaTrack[], p: AudioPreference): MediaTrack | undefined {
  let best: MediaTrack | undefined
  for (const c of candidates) {
    if (!best || score(best, p) < score(c, p)) best = c
  }
  return best
}

/**
 * The track matching a remembered choice, or undefined when nothing matches well enough
 * (then the usual default applies). Title (dub name) wins, then language + position.
 */
export function preferredAudio(tracks: MediaTrack[], preference: AudioPreference): MediaTrack | undefined {
  // Never switch language because of a title: remuxes often title tracks by
  // format ("AC3 5.1") in every language. Unknown language on either side is lenient.
  const audio = tracks.filter(
    (t) =>
      t.kind === 'audio' &&
      (Language.same(t.language, preference.language) || isUnknownLanguage(t.language) || isUnknownLanguage(preference.language)),
  )
  const wanted = normalizedTitle(preference.title)

  if (wanted !== undefined) {
    const exact = audio.filter((t) => normalizedTitle(t.title) === wanted)
    const partial = audio.filter((t) => {
      const title = normalizedTitle(t.title)
      if (title === undefined || Math.min(title.length, wanted.length) < 3) return false
      return title.includes(wanted) || wanted.includes(title)
    })
    const best = bestMatch(exact.length === 0 ? partial : exact, preference)
    if (best) return best
  }

  const sameLanguage = audio.filter((t) => Language.same(t.language, preference.language))
  if (sameLanguage.length === 0) return undefined
  // Without titles in the file the position is all we have; with titles that
  // didn't match, the dub is not here: only take the language if it's unambiguous.
  const titled = sameLanguage.some((t) => normalizedTitle(t.title) !== undefined)
  if (wanted !== undefined && titled && sameLanguage.length > 1) return undefined
  if (preference.indexInLanguage < sameLanguage.length && !titled) {
    return sameLanguage[preference.indexInLanguage]
  }
  return bestMatch(sameLanguage, preference)
}

// MARK: Store

/** localStorage-like storage. */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export class MemoryStorage implements KeyValueStorage {
  private data = new Map<string, string>()
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.data.set(key, value)
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
}

/** Episodes share the show's preferences; anything else has its own. */
export function preferencesKey(item: PlexItem): string {
  if (item.type === 'episode' && item.grandparentRatingKey) return item.grandparentRatingKey
  return item.ratingKey
}

/**
 * Per-show preferences, cached locally (one JSON string keyed by show).
 * The detector holds the shared copy (see `ShowPreferencesSync`): local changes are
 * marked dirty until saved there, and a dirty entry is never overwritten by the server.
 */
export class ShowPreferencesStore {
  static readonly storageKey = 'showPreferences'
  static readonly dirtyKey = 'showPreferencesDirty'
  static readonly syncVersionKey = 'showPreferencesSyncVersion'
  private listeners = new Set<() => void>()

  constructor(private readonly storage: KeyValueStorage) {
    // Entries saved before the detector kept them exist only here: upload, don't drop.
    const version = Number(storage.getItem(ShowPreferencesStore.syncVersionKey) ?? '0')
    if (!(version >= 1)) {
      this.setDirty(new Set([...this.dirtyKeys, ...Object.keys(this.all())]))
      storage.setItem(ShowPreferencesStore.syncVersionKey, '1')
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  preferences(key: string): ShowPreferences {
    return this.all()[key] ?? emptyPreferences()
  }

  /** A change by the user: saved here and marked for upload. */
  update(key: string, change: (p: ShowPreferences) => ShowPreferences) {
    const value = change(this.preferences(key))
    this.write(key, value)
    this.setDirty(new Set([...this.dirtyKeys, key]))
  }

  /** The detector's copy (null: it has none). Ignored while a local change is unsent. */
  replace(key: string, remote: ShowPreferences | null) {
    if (this.dirtyKeys.has(key)) return
    this.write(key, remote ?? emptyPreferences())
  }

  get dirtyKeys(): Set<string> {
    try {
      const parsed: unknown = JSON.parse(this.storage.getItem(ShowPreferencesStore.dirtyKey) ?? '[]')
      return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [])
    } catch {
      return new Set()
    }
  }

  /** Uploaded `sent`; stays dirty if the user changed it again meanwhile. */
  markClean(key: string, sent: ShowPreferences) {
    if (!preferencesEqual(this.preferences(key), sent)) return
    const keys = this.dirtyKeys
    keys.delete(key)
    this.setDirty(keys)
  }

  /** Raw JSON as stored (for tests and debugging). */
  get rawJSON(): string | null {
    return this.storage.getItem(ShowPreferencesStore.storageKey)
  }

  private setDirty(keys: Set<string>) {
    this.storage.setItem(ShowPreferencesStore.dirtyKey, JSON.stringify([...keys].sort()))
  }

  private write(key: string, value: ShowPreferences) {
    const all = this.all()
    const before = all[key] ?? emptyPreferences()
    if (isEmptyPreferences(value)) delete all[key]
    else all[key] = value
    const encoded: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(all)) encoded[k] = encodePreferences(v)
    this.storage.setItem(ShowPreferencesStore.storageKey, JSON.stringify(encoded))
    if (!preferencesEqual(before, value)) this.listeners.forEach((l) => l())
  }

  private all(): Record<string, ShowPreferences> {
    const json = this.storage.getItem(ShowPreferencesStore.storageKey)
    if (!json) return {}
    try {
      const parsed: unknown = JSON.parse(json)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
      const result: Record<string, ShowPreferences> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) result[k] = decodePreferences(v)
      return result
    } catch {
      return {}
    }
  }
}

/** What the sync needs from the detector. */
export interface PreferencesRemote {
  fetchPreferences(key: string): Promise<ShowPreferences | null>
  savePreferences(p: ShowPreferences, key: string): Promise<void>
}

/**
 * Keeps the local cache and the detector in step: `pull` before playing a show,
 * `schedulePush` after a change. Offline, everything keeps working from the cache.
 */
export class ShowPreferencesSync {
  private timer: ReturnType<typeof setTimeout> | undefined
  private pushing = false
  /** A push was asked for while one was running: run once more after it. */
  private pushAgain = false

  constructor(
    readonly store: ShowPreferencesStore,
    private readonly client: () => PreferencesRemote | null,
  ) {}

  /** Takes the detector's copy of one show (unless a local change is unsent). */
  async pull(key: string): Promise<void> {
    const client = this.client()
    if (!client) return
    try {
      const remote = await client.fetchPreferences(key)
      this.store.replace(key, remote)
    } catch {
      // Detector down or too old: the cache stays.
    }
  }

  /** Uploads unsent changes after `delayMs` (changes in a row become one upload). */
  schedulePush(delayMs = 1000) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.push(), delayMs)
  }

  /** Uploads every unsent show; stops at the first failure (retried on the next change or launch). */
  async push(): Promise<void> {
    if (this.pushing) {
      this.pushAgain = true
      return
    }
    const client = this.client()
    if (!client) return
    this.pushing = true
    try {
      do {
        this.pushAgain = false
        for (const key of [...this.store.dirtyKeys].sort()) {
          const value = this.store.preferences(key)
          try {
            await client.savePreferences(value, key)
            this.store.markClean(key, value)
          } catch {
            return
          }
        }
      } while (this.pushAgain)
    } finally {
      this.pushing = false
    }
  }
}
