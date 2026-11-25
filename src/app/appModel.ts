import { PLEX_AUTH_URL, PLEX_DISCOVER_URL, PLEX_IMAGES_URL, PLEX_TV_URL, TMDB_PROXY_TOKEN, TMDB_PROXY_URL } from '../config'
import { CatalogTitles, type TitleEntry } from '../core/catalogTitles'
import { DetectorClient, normalizeDetectorURL } from '../core/detectorClient'
import { HTTPError } from '../core/http'
import { PlexAccountAPI, usableCandidateURLs, type PlexClientInfo, type PlexServer } from '../core/plexAccount'
import { PlexDiscoverAPI } from '../core/plexDiscover'
import { sectionKind, type PlexItem, type PlexLibrarySection } from '../core/plexModels'
import { PlexServerAPI } from '../core/plexServerAPI'
import { ShowPreferencesStore, ShowPreferencesSync } from '../core/showPreferences'
import { TMDBClient } from '../core/tmdbClient'
import { makeClientInfo } from '../platform'
import { settingsStore } from '../settings'
import { readJSON, readString, storage, StorageKey, writeJSON, writeString } from '../storage'
import { DeletionText } from '../core/deletion'
import { Explore } from './explore'
import { Recommendations } from './recommendations'
import { Watchlist } from './watchlist'

export type Phase =
  | { kind: 'starting' }
  | { kind: 'login'; error?: string; waiting?: boolean }
  | { kind: 'choosingServer'; servers: PlexServer[] }
  | { kind: 'connecting'; text: string }
  | { kind: 'failed'; message: string }
  | { kind: 'ready' }

export interface AppSnapshot {
  phase: Phase
  server?: PlexServer
  api?: PlexServerAPI
  sections: PlexLibrarySection[]
  /** Bumped after playback and watch-state changes so screens reload. */
  refreshKey: number
}

interface PendingPin {
  id: number
  code: string
  createdAt: number
}

function errorText(error: unknown): string {
  if (error instanceof HTTPError) return `ошибка ${error.status}`
  if (error instanceof Error) return error.message === 'Failed to fetch' ? 'нет связи или доступ запрещён (CORS)' : error.message
  return String(error)
}

/** Session state of the app: sign-in, server, connection, shared clients. */
export class AppModel {
  readonly client: PlexClientInfo = makeClientInfo()
  readonly account = new PlexAccountAPI(this.client, undefined, PLEX_TV_URL, PLEX_AUTH_URL)
  readonly preferences = new ShowPreferencesStore(storage)
  readonly preferencesSync = new ShowPreferencesSync(this.preferences, () => this.detector())
  /** Plex Watchlist and which catalog titles the server has. */
  readonly watchlist = new Watchlist()
  readonly recommendations = new Recommendations()
  readonly explore = new Explore()

  private state: AppSnapshot = { phase: { kind: 'starting' }, sections: [], refreshKey: 0 }
  private listeners = new Set<() => void>()
  private userToken: string | undefined = readString(StorageKey.userToken)
  private started = false

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.state

  private set(change: Partial<AppSnapshot>) {
    this.state = { ...this.state, ...change }
    this.listeners.forEach((l) => l())
  }

  /** The TMDB proxy: titles, trailers and recommendations, Sepia Server or not. One client: a 429 holds them all. */
  readonly tmdb = new TMDBClient(TMDB_PROXY_URL, TMDB_PROXY_TOKEN)
  /** Russian names of catalog titles, kept in storage. */
  readonly catalogTitles = new CatalogTitles((queries) => this.tmdb.titles(queries), {
    load: () => readJSON<Record<string, TitleEntry>>(StorageKey.catalogTitles),
    save: (entries) => writeJSON(StorageKey.catalogTitles, entries),
  })

  /** Sepia Server bound to the server token; null until connected or when no address is set. */
  detector(): DetectorClient | null {
    const api = this.state.api
    const url = normalizeDetectorURL(settingsStore.get().detectorURL)
    if (!api || !url) return null
    return new DetectorClient(url, api.token)
  }

  /** Plex's catalog for the signed-in account (the account token, not the server's). */
  private discoverAPI(): PlexDiscoverAPI | undefined {
    if (!this.userToken) return undefined
    const language = navigator.language?.slice(0, 2) || 'ru'
    return new PlexDiscoverAPI(this.userToken, this.client, undefined, PLEX_DISCOVER_URL, PLEX_IMAGES_URL, language, this.catalogTitles)
  }

  // MARK: Session

  async start() {
    if (this.started) return
    this.started = true
    if (readJSON<PendingPin>(StorageKey.pendingPin)) {
      await this.finishLogin()
      return
    }
    if (!this.userToken) {
      this.set({ phase: { kind: 'login' } })
      return
    }
    const server = readJSON<PlexServer>(StorageKey.server)
    if (server) await this.connect(server)
    else await this.loadServers()
  }

  /** Creates a PIN and sends the browser to app.plex.tv; it comes back to this page. */
  async beginLogin() {
    try {
      this.set({ phase: { kind: 'login', waiting: true } })
      const pin = await this.account.createPin()
      writeJSON(StorageKey.pendingPin, { id: pin.id, code: pin.code, createdAt: Date.now() } satisfies PendingPin)
      const forward = window.location.origin + window.location.pathname + window.location.search
      window.location.assign(this.account.authURL(pin, forward))
    } catch (error) {
      this.set({ phase: { kind: 'login', error: `Не удалось связаться с plex.tv: ${errorText(error)}` } })
    }
  }

  /** Back from app.plex.tv: waits for the PIN to get its token. */
  private async finishLogin() {
    const pending = readJSON<PendingPin>(StorageKey.pendingPin)
    if (!pending) return
    this.set({ phase: { kind: 'login', waiting: true } })
    const deadline = Date.now() + 90_000
    try {
      while (Date.now() < deadline) {
        const pin = await this.account.checkPin(pending)
        if (pin.authToken) {
          writeJSON(StorageKey.pendingPin, undefined)
          await this.didLogin(pin.authToken)
          return
        }
        await new Promise((r) => setTimeout(r, 1000))
      }
      writeJSON(StorageKey.pendingPin, undefined)
      this.set({ phase: { kind: 'login', error: 'Вход не подтверждён. Попробуйте ещё раз.' } })
    } catch (error) {
      writeJSON(StorageKey.pendingPin, undefined)
      this.set({ phase: { kind: 'login', error: `Не удалось войти: ${errorText(error)}` } })
    }
  }

  cancelLogin() {
    writeJSON(StorageKey.pendingPin, undefined)
    this.set({ phase: { kind: 'login' } })
  }

  async didLogin(token: string) {
    this.userToken = token
    writeString(StorageKey.userToken, token)
    await this.loadServers()
  }

  async loadServers() {
    if (!this.userToken) {
      this.set({ phase: { kind: 'login' } })
      return
    }
    this.set({ phase: { kind: 'connecting', text: 'Ищу серверы…' } })
    try {
      const servers = await this.account.servers(this.userToken)
      if (servers.length === 1) await this.choose(servers[0])
      else this.set({ phase: { kind: 'choosingServer', servers } })
    } catch (error) {
      if (error instanceof HTTPError && error.status === 401) {
        this.logout()
        return
      }
      this.set({ phase: { kind: 'failed', message: `Не удалось получить список серверов: ${errorText(error)}` } })
    }
  }

  async choose(server: PlexServer) {
    writeJSON(StorageKey.server, server)
    this.set({ server })
    await this.connect(server)
  }

  candidates(server: PlexServer): string[] {
    const list = usableCandidateURLs(server, window.location.protocol === 'https:')
    const preferred = settingsStore.get().preferredConnection
    if (preferred && list.includes(preferred)) return [preferred, ...list.filter((u) => u !== preferred)]
    return list
  }

  async connect(server: PlexServer) {
    this.set({ server, api: undefined, phase: { kind: 'connecting', text: `Подключаюсь к «${server.name}»…` } })
    let url = await PlexServerAPI.firstReachable(this.candidates(server), server.accessToken, this.client)
    let current = server
    if (!url && this.userToken) {
      // The server list may be stale (new address): refresh it once.
      try {
        const fresh = (await this.account.servers(this.userToken)).find((s) => s.clientIdentifier === server.clientIdentifier)
        if (fresh && JSON.stringify(fresh.connections) !== JSON.stringify(server.connections)) {
          current = fresh
          writeJSON(StorageKey.server, fresh)
          url = await PlexServerAPI.firstReachable(this.candidates(fresh), fresh.accessToken, this.client)
        }
      } catch {
        // keep the old list
      }
    }
    if (!url) {
      const https = window.location.protocol === 'https:'
      this.set({
        server: current,
        phase: {
          kind: 'failed',
          message: `Сервер «${current.name}» недоступен. Проверьте, что он включён${https ? ' и доступен по HTTPS (plex.direct)' : ''}.`,
        },
      })
      return
    }
    const api = new PlexServerAPI(url, current.accessToken, this.client)
    try {
      const sections = (await api.sections()).filter((s) => sectionKind(s) === 'movie' || sectionKind(s) === 'show')
      const discover = this.discoverAPI()
      this.watchlist.configure(discover, api, sections)
      this.recommendations.configure(discover, api, current.owned, this.tmdb)
      this.explore.configure(discover)
      this.set({ server: current, api, sections, phase: { kind: 'ready' } })
      // Changes made while the detector was unreachable.
      this.preferencesSync.schedulePush(0)
    } catch (error) {
      if (error instanceof HTTPError && error.status === 401) {
        this.logout()
        return
      }
      this.set({ phase: { kind: 'failed', message: `Не удалось загрузить медиатеку: ${errorText(error)}` } })
    }
  }

  async retry() {
    const server = this.state.server ?? readJSON<PlexServer>(StorageKey.server)
    if (server) await this.connect(server)
    else await this.loadServers()
  }

  async switchServer() {
    writeJSON(StorageKey.server, undefined)
    settingsStore.update({ preferredConnection: '' })
    this.unconfigure()
    this.set({ server: undefined, api: undefined, sections: [] })
    await this.loadServers()
  }

  logout() {
    writeString(StorageKey.userToken, undefined)
    writeJSON(StorageKey.server, undefined)
    writeJSON(StorageKey.pendingPin, undefined)
    this.userToken = undefined
    this.unconfigure()
    this.set({ server: undefined, api: undefined, sections: [], phase: { kind: 'login' } })
  }

  private unconfigure() {
    this.watchlist.configure(undefined, undefined, [])
    this.recommendations.configure(undefined, undefined, true, this.tmdb)
    this.explore.configure(undefined)
  }

  /** Plex's online catalog for the signed-in account (undefined without one). */
  get discover(): PlexDiscoverAPI | undefined {
    return this.watchlist.getSnapshot().api
  }

  // MARK: Playback and watch state

  refresh() {
    this.set({ refreshKey: this.state.refreshKey + 1 })
  }

  /**
   * Deletes titles with their files from the server, one by one (a failure doesn't stop the
   * rest). Undefined when all went; otherwise what to tell the user.
   */
  async delete(items: PlexItem[]): Promise<string | undefined> {
    const api = this.state.api
    if (!api) return DeletionText.failed(undefined)
    let failed = 0
    let firstError: unknown
    const gone = new Set<string>()
    for (const item of items) {
      try {
        await api.delete(item.ratingKey)
        gone.add(item.ratingKey)
      } catch (error) {
        console.warn('delete', item.ratingKey, error)
        failed += 1
        firstError ??= error
      }
    }
    if (gone.size > 0) {
      this.watchlist.forget(gone)
      this.recommendations.forget(gone)
      this.recommendations.expire()
    }
    this.refresh()
    if (failed === 0) return undefined
    const reason = DeletionText.failed(firstError)
    return failed === items.length ? reason : `${DeletionText.partly(failed, items.length)} ${reason}`
  }

  async setWatched(item: PlexItem, watched: boolean) {
    const api = this.state.api
    if (!api) return
    try {
      if (watched) await api.markWatched(item.ratingKey)
      else await api.markUnwatched(item.ratingKey)
    } catch (error) {
      console.warn('watch state', error)
    }
    this.refresh()
  }
}

export const appModel = new AppModel()
