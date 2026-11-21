import { fetchJSON, isRecord, joinURL, lossyBool, lossyInt, lossyString, type FetchFn } from './http'

/** Identifies this app to plex.tv and the media server (`X-Plex-*`). */
export interface PlexClientInfo {
  clientIdentifier: string
  product: string
  version: string
  platform: string
  platformVersion: string
  device: string
  deviceName: string
}

/**
 * `X-Plex-*` as query parameters: with no custom headers, GET requests to Plex are
 * "simple" CORS requests and need no preflight (this is what Plex Web does too).
 */
export function plexParams(client: PlexClientInfo, token?: string): Record<string, string> {
  const params: Record<string, string> = {
    'X-Plex-Product': client.product,
    'X-Plex-Version': client.version,
    'X-Plex-Client-Identifier': client.clientIdentifier,
    'X-Plex-Platform': client.platform,
    'X-Plex-Platform-Version': client.platformVersion,
    'X-Plex-Device': client.device,
    'X-Plex-Device-Name': client.deviceName,
    'X-Plex-Provides': 'player',
  }
  if (token) params['X-Plex-Token'] = token
  return params
}

export const jsonInit: RequestInit = { headers: { Accept: 'application/json' } }

/** PIN created on plex.tv; the user approves it on app.plex.tv. */
export interface PlexPin {
  id: number
  code: string
  authToken?: string
  expiresIn?: number
}

export interface PlexConnection {
  uri: string
  local: boolean
  relay: boolean
  address?: string
  port?: number
  protocol?: string
}

/** A Plex Media Server the account has access to. */
export interface PlexServer {
  name: string
  clientIdentifier: string
  accessToken: string
  owned: boolean
  connections: PlexConnection[]
}

export function parseConnection(raw: unknown): PlexConnection | null {
  if (!isRecord(raw) || typeof raw.uri !== 'string') return null
  return {
    uri: raw.uri,
    local: lossyBool(raw.local),
    relay: lossyBool(raw.relay),
    address: lossyString(raw.address),
    port: lossyInt(raw.port),
    protocol: lossyString(raw.protocol),
  }
}

function parsePin(raw: unknown): PlexPin {
  if (!isRecord(raw)) throw new Error('unexpected pin response')
  const id = lossyInt(raw.id)
  const code = lossyString(raw.code)
  if (id === undefined || code === undefined) throw new Error('unexpected pin response')
  const token = lossyString(raw.authToken)
  return { id, code, authToken: token || undefined, expiresIn: lossyInt(raw.expiresIn) }
}

/**
 * Candidate base URLs in order of preference: local, remote, relay.
 * For local connections a plain `http://address:port` is added after the
 * `plex.direct` one, because routers often block DNS rebinding of plex.direct.
 */
export function candidateURLs(server: PlexServer): string[] {
  const rank = (c: PlexConnection) => (c.relay ? 2 : c.local ? 0 : 1)
  const sorted = server.connections
    .map((connection, offset) => ({ connection, offset }))
    .sort((a, b) => rank(a.connection) - rank(b.connection) || a.offset - b.offset)
  const result: string[] = []
  for (const { connection } of sorted) {
    result.push(connection.uri)
    if (connection.local && !connection.relay && connection.address && !connection.address.includes(':')) {
      result.push(`http://${connection.address}:${connection.port ?? 32400}`)
    }
  }
  return [...new Set(result)].filter((u) => {
    try {
      new URL(u)
      return true
    } catch {
      return false
    }
  })
}

/**
 * Candidates a page can actually reach: an HTTPS page can't call `http://` servers
 * (mixed content), an HTTP page (local dev, LAN) can call both.
 */
export function usableCandidateURLs(server: PlexServer, pageIsHTTPS: boolean): string[] {
  const all = candidateURLs(server)
  return pageIsHTTPS ? all.filter((u) => u.startsWith('https://')) : all
}

/** Whether a base URL is one of the server's local connections. */
export function isLocalConnection(server: PlexServer, url: string): boolean {
  const connection = server.connections.find((c) => c.uri === url)
  if (connection) return connection.local
  return server.connections.some((c) => c.local && c.address !== undefined && url.includes(c.address))
}

/** plex.tv account API: PIN login and server discovery. */
export class PlexAccountAPI {
  static readonly defaultBase = 'https://plex.tv'
  static readonly defaultAuthBase = 'https://app.plex.tv/auth'

  constructor(
    readonly client: PlexClientInfo,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
    readonly base = PlexAccountAPI.defaultBase,
    readonly authBase = PlexAccountAPI.defaultAuthBase,
  ) {}

  /** Creates a strong PIN for the app.plex.tv sign-in page. */
  async createPin(): Promise<PlexPin> {
    const url = joinURL(this.base, '/api/v2/pins', { strong: 'true', ...plexParams(this.client) })
    return parsePin(await fetchJSON(this.fetchFn, url, { ...jsonInit, method: 'POST' }))
  }

  /** Returns the PIN; `authToken` is set once the user has signed in. */
  async checkPin(pin: { id: number; code: string }): Promise<PlexPin> {
    const url = joinURL(this.base, `/api/v2/pins/${pin.id}`, { code: pin.code, ...plexParams(this.client) })
    return parsePin(await fetchJSON(this.fetchFn, url, jsonInit))
  }

  /** The app.plex.tv page where the user signs in and approves the PIN, then returns to `forwardUrl`. */
  authURL(pin: PlexPin, forwardUrl: string): string {
    const params: [string, string][] = [
      ['clientID', this.client.clientIdentifier],
      ['code', pin.code],
      ['forwardUrl', forwardUrl],
      ['context[device][product]', this.client.product],
      ['context[device][version]', this.client.version],
      ['context[device][platform]', this.client.platform],
      ['context[device][platformVersion]', this.client.platformVersion],
      ['context[device][device]', this.client.device],
      ['context[device][deviceName]', this.client.deviceName],
      ['context[device][layout]', 'desktop'],
    ]
    const query = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    return `${this.authBase}#?${query}`
  }

  /** Media servers available to the account. */
  async servers(token: string): Promise<PlexServer[]> {
    const url = joinURL(this.base, '/api/v2/resources', {
      includeHttps: '1',
      includeRelay: '1',
      ...plexParams(this.client, token),
    })
    const json = await fetchJSON(this.fetchFn, url, jsonInit)
    if (!Array.isArray(json)) return []
    return json
      .filter(isRecord)
      .filter((r) => (lossyString(r.provides) ?? '').split(',').includes('server'))
      .map((r) => ({
        name: lossyString(r.name) ?? '',
        clientIdentifier: lossyString(r.clientIdentifier) ?? '',
        accessToken: lossyString(r.accessToken) ?? token,
        owned: lossyBool(r.owned),
        connections: Array.isArray(r.connections)
          ? r.connections.map(parseConnection).filter((c): c is PlexConnection => c !== null)
          : [],
      }))
  }
}
