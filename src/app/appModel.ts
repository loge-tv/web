import { PLEX_AUTH_URL, PLEX_TV_URL } from '../config'
import { DetectorClient, normalizeDetectorURL } from '../core/detectorClient'
import { HTTPError } from '../core/http'
import { PlexAccountAPI, usableCandidateURLs, type PlexClientInfo, type PlexServer } from '../core/plexAccount'
import { sectionKind, type PlexItem, type PlexLibrarySection } from '../core/plexModels'
import { PlexServerAPI } from '../core/plexServerAPI'
import { ShowPreferencesStore, ShowPreferencesSync } from '../core/showPreferences'
import { makeClientInfo } from '../platform'
import { settingsStore } from '../settings'
import { readJSON, readString, storage, StorageKey, writeJSON, writeString } from '../storage'

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
  /** Item waiting for the "Resume / From the beginning" choice. */
  resumeCandidate?: PlexItem
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

  /** Detector bound to the server token; null until connected. */
  detector(): DetectorClient | null {
    const api = this.state.api
    if (!api) return null
    return new DetectorClient(normalizeDetectorURL(settingsStore.get().detectorURL), api.token)
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
    this.set({ server: undefined, api: undefined, sections: [] })
    await this.loadServers()
  }

  logout() {
    writeString(StorageKey.userToken, undefined)
    writeJSON(StorageKey.server, undefined)
    writeJSON(StorageKey.pendingPin, undefined)
    this.userToken = undefined
    this.set({ server: undefined, api: undefined, sections: [], phase: { kind: 'login' } })
  }

  // MARK: Playback and watch state

  setResumeCandidate(item: PlexItem | undefined) {
    this.set({ resumeCandidate: item })
  }

  refresh() {
    this.set({ refreshKey: this.state.refreshKey + 1 })
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
