import { DEFAULT_DETECTOR, PLEX_AUTH_URL, PLEX_DISCOVER_URL, PLEX_IMAGES_URL, PLEX_TV_URL, SEPIA_SERVER_PORT, TMDB_PROXY_TOKEN, TMDB_PROXY_URL } from '../config'
import { CatalogTitles, type TitleEntry } from '../core/catalogTitles'
import { DetectorClient, normalizeDetectorURL } from '../core/detectorClient'
import { HTTPError } from '../core/http'
import { PlexAccountAPI, usableCandidateURLs, type PlexClientInfo, type PlexServer } from '../core/plexAccount'
import { PlexDiscoverAPI } from '../core/plexDiscover'
import { sectionKind, type PlexItem, type PlexLibrarySection } from '../core/plexModels'
import { PlexServerAPI } from '../core/plexServerAPI'
import { blockedOnPage, checkAddress, discover, fetchInfo, identityOf, type Discovery, type Verdict } from '../core/sepiaServer'
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
  /**
   * `waiting`: the app.plex.tv page is opening or has sent the browser back and the PIN is being
   * checked. `byCode`: the spare way is open (`code` once plex.tv gave it).
   */
  | { kind: 'login'; error?: string; waiting?: boolean; byCode?: boolean; code?: string }
  | { kind: 'choosingServer'; servers: PlexServer[] }
  | { kind: 'connecting'; text: string }
  | { kind: 'failed'; message: string }
  /** Connected; the Plex server has no Sepia Server yet: «Подключите Sepia Server» or skip. */
  | { kind: 'sepiaServer' }
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
  /** Bumped to stop the code sign-in's polling (another way chosen, signed in, signed out). */
  private codeLoginRun = 0

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
    // Another Plex server's Sepia Server: its segments are of other items (rating keys are per server).
    if (!api || !url || url === this.foreignSepiaServer) return null
    return new DetectorClient(url, api.token)
  }

  // MARK: Sepia Server

  /** An address whose /v1/info names another Plex server: not used until it changes. */
  private foreignSepiaServer: string | undefined

  private get pageIsHTTPS(): boolean {
    return window.location.protocol === 'https:'
  }

  /** The address kept for `server`: a URL, "" when skipped, undefined when never decided. */
  sepiaServerOf(server: PlexServer): string | undefined {
    const known = readJSON<Record<string, string>>(StorageKey.sepiaServers)?.[server.clientIdentifier]
    return typeof known === 'string' ? known : undefined
  }

  /**
   * The one writer of Sepia Server's address: kept for the current Plex server and used now. ""
   * skips it (the step isn't offered again; the settings can still set one).
   */
  setSepiaServer(url: string) {
    const server = this.state.server
    if (server) writeJSON(StorageKey.sepiaServers, { ...readJSON<Record<string, string>>(StorageKey.sepiaServers), [server.clientIdentifier]: url })
    settingsStore.update({ detectorURL: url })
    this.foreignSepiaServer = undefined
    if (this.state.phase.kind === 'sepiaServer') this.set({ phase: { kind: 'ready' } })
    this.preferencesSync.schedulePush(0)
  }

  /** Looks for the current Plex server's Sepia Server on its hosts. */
  async findSepiaServer(): Promise<Discovery> {
    const server = this.state.server
    if (!server) return { kind: 'none' }
    return discover(server, { port: SEPIA_SERVER_PORT, pageIsHTTPS: this.pageIsHTTPS })
  }

  /** Whether `url` is the current Plex server's Sepia Server and takes its token. */
  async checkSepiaServer(url: string, consented = false): Promise<Verdict> {
    const server = this.state.server
    const api = this.state.api
    if (!server || !api) return { kind: 'down' }
    return checkAddress(url, server, api.token, { pageIsHTTPS: this.pageIsHTTPS, consented })
  }

  /**
   * After connecting: the address kept for this Plex server, used without waiting. A Plex server
   * not seen yet takes the address set before addresses were kept per server (none kept at all
   * yet), or the build's default; otherwise the «Подключите Sepia Server» step. Another Plex
   * server's address is never carried over to it.
   */
  private sepiaServerOnConnect(server: PlexServer): Phase {
    const kept = readJSON<Record<string, string>>(StorageKey.sepiaServers) ?? {}
    const known = this.sepiaServerOf(server)
    const current = normalizeDetectorURL(settingsStore.get().detectorURL)
    const byDefault = normalizeDetectorURL(DEFAULT_DETECTOR ?? '')
    let url: string
    if (known !== undefined) url = normalizeDetectorURL(known)
    else if (current && (Object.keys(kept).length === 0 || current === byDefault)) url = current
    else {
      // Not this Plex server's: unused while the step is open.
      if (current) settingsStore.update({ detectorURL: '' })
      return { kind: 'sepiaServer' }
    }
    if (known === undefined) writeJSON(StorageKey.sepiaServers, { ...kept, [server.clientIdentifier]: url })
    if (url !== current) settingsStore.update({ detectorURL: url })
    // The build's default is the fakes' (no token-less /v1/info there): taken as it is. An http
    // address from an https page can't be asked at all.
    if (url && url !== byDefault && !blockedOnPage(url, this.pageIsHTTPS)) void this.verifySepiaServer(server, url)
    return { kind: 'ready' }
  }

  /**
   * The kept address, checked in the background with /v1/info (no token). Another Plex server's
   * stops being used; one that doesn't answer is looked for again on Plex's hosts. Found there,
   * this Plex server's Sepia Server (its machineIdentifier) takes the address' place.
   */
  private async verifySepiaServer(server: PlexServer, url: string) {
    const info = await fetchInfo(url)
    if (this.state.server?.clientIdentifier !== server.clientIdentifier) return
    const foreign = info.kind === 'sepia' && identityOf(info, server) === 'foreign'
    if (foreign) this.foreignSepiaServer = url
    if (!foreign && info.kind !== 'unreachable') return
    const found = await this.findSepiaServer()
    if (this.state.server?.clientIdentifier !== server.clientIdentifier) return
    if (found.kind === 'found' && found.url !== url && normalizeDetectorURL(settingsStore.get().detectorURL) === url) this.setSepiaServer(found.url)
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
    this.codeLoginRun += 1
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
    this.codeLoginRun += 1
    writeJSON(StorageKey.pendingPin, undefined)
    this.set({ phase: { kind: 'login' } })
  }

  /**
   * The spare way to sign in: a short PIN the user types at plex.tv/link on any device (handy when
   * Plex is signed in elsewhere, or the sign-in page can't come back here). Polled every 2 s and
   * renewed when it expires, until signed in or another way is chosen.
   */
  async beginCodeLogin() {
    const run = ++this.codeLoginRun
    const current = () => run === this.codeLoginRun
    this.set({ phase: { kind: 'login', byCode: true } })
    try {
      while (current()) {
        const pin = await this.account.createPin(false)
        if (!current()) return
        this.set({ phase: { kind: 'login', byCode: true, code: pin.code } })
        const deadline = Date.now() + Math.max(30, (pin.expiresIn ?? 900) - 10) * 1000
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000))
          if (!current()) return
          const checked = await this.account.checkPin(pin)
          if (!current()) return
          if (checked.authToken) {
            await this.didLogin(checked.authToken)
            return
          }
        }
      }
    } catch (error) {
      if (current()) this.set({ phase: { kind: 'login', byCode: true, error: `Не удалось связаться с plex.tv: ${errorText(error)}` } })
    }
  }

  async didLogin(token: string) {
    this.codeLoginRun += 1
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
      this.set({ server: current, api, sections })
      this.set({ phase: this.sepiaServerOnConnect(current) })
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
    this.codeLoginRun += 1
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
