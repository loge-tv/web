import { fetchWithTimeout, isRecord, joinURL, lossyString, type FetchFn } from './http'
import type { PlexServer } from './plexAccount'

/**
 * Finding and checking Sepia Server for a Plex server, after the contract of sepiatv/server
 * (v1, v1.1; server 0.7.0):
 *
 * - `GET /v1/info` without a token, with CORS: `{"product":"Sepia Server","version":…,
 *   "machineIdentifier":…}`. `machineIdentifier` is the Plex server's (`clientIdentifier` in
 *   plex.tv resources); it is missing until Sepia Server has reached Plex ("try later", not
 *   "another server"). Servers before 0.7.0 answer 404 (with CORS: their middleware covers /v1/*):
 *   only the token tells them, `GET /v1/stats` → 200.
 * - The standard port is 32420, plain http. The browser has no Bonjour, so the candidates are the
 *   hosts of the Plex server's connections on that port. A page on https can't ask an http address
 *   (mixed content) unless it is loopback, so there only loopback hosts are tried.
 * - The Plex token goes over plain http only inside the home network: an external http address
 *   is used only after the user says yes, and nothing with the token goes there before that.
 * - 401 on /v1/* says why in `code`: `token_missing` or `token_rejected` (none before 0.7.0).
 */

export const SEPIA_SERVER_PRODUCT = 'Sepia Server'
export const SEPIA_SERVER_PORT = 32420

/** What `GET /v1/info` (no token) says about an address. */
export type InfoAnswer =
  /** A Sepia Server; `machineIdentifier` missing: it hasn't reached Plex yet. */
  | { kind: 'sepia'; version?: string; machineIdentifier?: string }
  /** 404: Sepia Server before 0.7.0, or something else. Only the token tells. */
  | { kind: 'old' }
  /** Answers, but not as Sepia Server's /v1/info. */
  | { kind: 'other'; status: number }
  /** Network error, timeout or blocked by the browser. */
  | { kind: 'unreachable' }

export async function fetchInfo(base: string, fetchFn: FetchFn = defaultFetch, timeoutMs = 2000): Promise<InfoAnswer> {
  let response: Response
  try {
    // Only Accept: a "simple" request, no preflight.
    response = await fetchWithTimeout(fetchFn, joinURL(base, '/v1/info'), { headers: { Accept: 'application/json' } }, timeoutMs)
  } catch {
    return { kind: 'unreachable' }
  }
  if (response.status === 404) return { kind: 'old' }
  if (!response.ok) return { kind: 'other', status: response.status }
  try {
    const json: unknown = JSON.parse(await response.text())
    if (isRecord(json) && json.product === SEPIA_SERVER_PRODUCT) {
      return { kind: 'sepia', version: lossyString(json.version), machineIdentifier: lossyString(json.machineIdentifier) || undefined }
    }
  } catch {
    // not JSON
  }
  return { kind: 'other', status: response.status }
}

export type Identity = 'match' | 'pending' | 'foreign'

/** Whose Sepia Server it is: this Plex server's, not known yet, or another one's. */
export function identityOf(info: { machineIdentifier?: string }, server: Pick<PlexServer, 'clientIdentifier'>): Identity {
  if (!info.machineIdentifier) return 'pending'
  return info.machineIdentifier === server.clientIdentifier ? 'match' : 'foreign'
}

// MARK: Addresses

/** `URL.hostname` without IPv6 brackets, lower case. */
function bareHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

function ipv4(host: string): number[] | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return undefined
  const parts = m.slice(1).map(Number)
  return parts.every((p) => p <= 255) ? parts : undefined
}

export function isLoopbackHost(hostname: string): boolean {
  const host = bareHost(hostname)
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true
  return ipv4(host)?.[0] === 127
}

/**
 * Inside the home network for sure: private IPv4 (10/8, 172.16/12, 192.168/16), link-local
 * (169.254/16, fe80::/10), IPv6 ULA (fc00::/7), loopback and `.local` names. Everything else is
 * external, `.home.arpa` and single-label names included: the browser can't tell where they
 * resolve, and a mistake sends the token in the clear (server-7f, 2026-11-26).
 */
export function isHomeHost(hostname: string): boolean {
  const host = bareHost(hostname)
  if (isLoopbackHost(host) || host.endsWith('.local')) return true
  const v4 = ipv4(host)
  if (v4) {
    const [a, b] = v4
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  }
  if (host.includes(':')) return /^fe[89ab]/.test(host) || /^f[cd]/.test(host)
  return false
}

/** An http address the browser won't let this page ask: http from an https page, not loopback. */
export function blockedOnPage(url: string, pageIsHTTPS: boolean): boolean {
  const u = new URL(url)
  return pageIsHTTPS && u.protocol === 'http:' && !isLoopbackHost(u.hostname)
}

/** Plain http outside the home network: the token would go in the clear, so the user must agree. */
export function needsConsent(url: string): boolean {
  const u = new URL(url)
  return u.protocol === 'http:' && !isHomeHost(u.hostname)
}

// MARK: Discovery

/**
 * Candidates on Plex's hosts: the `address` of each direct connection (not the plex.direct name in
 * `uri`: routers that guard against DNS rebinding don't resolve it to a private address), local
 * ones first, on `port`. From an https page only loopback hosts (mixed content).
 */
export function probeURLs(server: Pick<PlexServer, 'connections'>, port: number, pageIsHTTPS: boolean): string[] {
  const ordered = [...server.connections.filter((c) => c.local), ...server.connections.filter((c) => !c.local)]
  const urls: string[] = []
  for (const c of ordered) {
    if (c.relay || !c.address) continue
    const host = c.address.includes(':') ? `[${c.address}]` : c.address
    const url = `http://${host}:${port}`
    if (pageIsHTTPS && !isLoopbackHost(host)) continue
    if (!urls.includes(url)) urls.push(url)
  }
  return urls
}

export type Discovery =
  /** This Plex server's Sepia Server inside the home network: offer it. */
  | { kind: 'found'; url: string }
  /** On Plex's host, but it hasn't reached Plex yet: try again a bit later. */
  | { kind: 'pending'; url: string }
  /** This Plex server's, but only on an external http address: it needs https (a reverse proxy). */
  | { kind: 'external'; url: string }
  | { kind: 'none' }

/** Asks every candidate at once (2 s each) and picks the best answer. */
export async function discover(
  server: Pick<PlexServer, 'clientIdentifier' | 'connections'>,
  options: { port?: number; pageIsHTTPS: boolean; fetchFn?: FetchFn; timeoutMs?: number },
): Promise<Discovery> {
  const urls = probeURLs(server, options.port ?? SEPIA_SERVER_PORT, options.pageIsHTTPS)
  const answers = await Promise.all(urls.map((url) => fetchInfo(url, options.fetchFn, options.timeoutMs)))
  const seen = urls.map((url, i) => {
    const answer = answers[i]
    return { url, home: !needsConsent(url), identity: answer.kind === 'sepia' ? identityOf(answer, server) : undefined }
  })
  const found = seen.find((s) => s.identity === 'match' && s.home)
  if (found) return { kind: 'found', url: found.url }
  const pending = seen.find((s) => s.identity === 'pending')
  if (pending) return { kind: 'pending', url: pending.url }
  const external = seen.find((s) => s.identity === 'match')
  if (external) return { kind: 'external', url: external.url }
  return { kind: 'none' }
}

// MARK: Checking an address

export type Verdict =
  | { kind: 'ok'; version?: string; old: boolean }
  /** http from an https page: the browser won't ask it. */
  | { kind: 'blocked' }
  /** External http: ask the user before the token goes there. */
  | { kind: 'consent' }
  | { kind: 'pending' }
  | { kind: 'foreign' }
  | { kind: 'tokenMissing' }
  | { kind: 'tokenRejected' }
  | { kind: 'down' }

/**
 * Whether `url` is this Plex server's Sepia Server and takes this token. `/v1/info` first (no
 * token); the token goes (`/v1/stats`) only to an address inside the home network, over https,
 * or one the user agreed to (`consented`).
 */
export async function checkAddress(
  url: string,
  server: Pick<PlexServer, 'clientIdentifier'>,
  token: string,
  options: { pageIsHTTPS: boolean; consented?: boolean; fetchFn?: FetchFn; timeoutMs?: number },
): Promise<Verdict> {
  const fetchFn = options.fetchFn ?? defaultFetch
  const timeoutMs = options.timeoutMs ?? 4000
  if (blockedOnPage(url, options.pageIsHTTPS)) return { kind: 'blocked' }
  const info = await fetchInfo(url, fetchFn, timeoutMs)
  if (info.kind === 'unreachable' || info.kind === 'other') return { kind: 'down' }
  if (info.kind === 'sepia') {
    const identity = identityOf(info, server)
    if (identity !== 'match') return { kind: identity }
  }
  if (needsConsent(url) && !options.consented) return { kind: 'consent' }
  let response: Response
  try {
    response = await fetchWithTimeout(fetchFn, joinURL(url, '/v1/stats'), { headers: { 'X-Plex-Token': token, Accept: 'application/json' } }, timeoutMs)
  } catch {
    return { kind: 'down' }
  }
  if (response.ok) return { kind: 'ok', version: info.kind === 'sepia' ? info.version : undefined, old: info.kind === 'old' }
  if (response.status === 401) {
    let code: string | undefined
    let error: string | undefined
    try {
      const json: unknown = JSON.parse(await response.text())
      if (isRecord(json)) {
        code = lossyString(json.code)
        error = lossyString(json.error)
      }
    } catch {
      // no body
    }
    // Before 0.7.0 there is no code, only the error text.
    if (code === 'token_missing' || (!code && /required/i.test(error ?? ''))) return { kind: 'tokenMissing' }
    return { kind: 'tokenRejected' }
  }
  return { kind: 'down' }
}

/**
 * The settings' connection state of the kept address («Вывод в прод», 2026-11-26): short, with
 * the Plex server's name and Sepia Server's version when connected.
 */
export function statusText(verdict: Verdict | undefined, plexName: string): string {
  if (!verdict) return 'Проверяем…'
  switch (verdict.kind) {
    case 'ok':
      return ['Подключён', plexName, verdict.version].filter(Boolean).join(' · ')
    case 'foreign':
      return 'Нет доступа: этот Sepia Server от другого сервера Plex'
    case 'down':
      return 'Не отвечает'
    case 'blocked':
      return 'Нужен https-адрес'
    default:
      return verdictText(verdict)
  }
}

/** What the user reads about a verdict (the strings the Apple and Android apps use). */
export function verdictText(verdict: Verdict): string {
  switch (verdict.kind) {
    case 'ok':
      return 'Sepia Server отвечает'
    case 'blocked':
      return 'Страница открыта по HTTPS, а адрес — http://: браузер его не пускает. Нужен адрес https://.'
    case 'consent':
      return 'Адрес не из домашней сети и без https: токен Plex пойдёт по сети открытым текстом. Всё равно подключить?'
    case 'pending':
      return 'Sepia Server ещё запускается. Повторите чуть позже.'
    case 'foreign':
      return 'Этот Sepia Server работает с другим сервером Plex.'
    case 'tokenMissing':
      return 'Sepia Server не получил токен Plex.'
    case 'tokenRejected':
      return 'У этого аккаунта Plex нет доступа к серверу, с которым работает Sepia Server.'
    case 'down':
      return 'По этому адресу Sepia Server не отвечает.'
  }
}

const defaultFetch: FetchFn = (input, init) => fetch(input, init)
