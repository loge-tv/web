/** Minimal HTTP helpers shared by the Plex and Sepia Server clients. */

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export class HTTPError extends Error {
  readonly status: number

  constructor(status: number, url?: string) {
    super(`HTTP ${status}${url ? ` (${redactToken(url)})` : ''}`)
    this.status = status
  }
}

/** Never show tokens in error messages. */
export function redactToken(url: string): string {
  return url.replace(/(X-Plex-Token=)[^&]+/gi, '$1…')
}

/**
 * Percent-encodes everything except RFC 3986 unreserved characters,
 * so nested URLs (`url=/a?b=1&c=2`) survive as a single query value.
 */
export function strictEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

export type Query = Record<string, string | number | undefined | null> | [string, string][]

function queryPairs(query: Query | undefined): [string, string][] {
  if (!query) return []
  if (Array.isArray(query)) return query
  return Object.entries(query)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== null)
    .map(([k, v]) => [k, String(v)])
}

/**
 * Appends a path that may already contain a query string (Plex keys like `/library/x?y=1`)
 * and extra query items to a base URL.
 */
export function joinURL(base: string, path: string, query?: Query): string {
  let root = base
  while (root.endsWith('/')) root = root.slice(0, -1)
  let url = path.startsWith('/') ? root + path : root + '/' + path
  const pairs = queryPairs(query)
  if (pairs.length > 0) {
    const encoded = pairs.map(([k, v]) => `${strictEncode(k)}=${strictEncode(v)}`).join('&')
    url += (url.includes('?') ? (url.endsWith('?') || url.endsWith('&') ? '' : '&') : '?') + encoded
  }
  return url
}

/** fetch with a timeout; rejects on network errors and timeouts. */
export async function fetchWithTimeout(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const outer = init.signal
  const onAbort = () => controller.abort()
  outer?.addEventListener('abort', onAbort)
  try {
    return await fetchFn(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onAbort)
  }
}

/** Fails on non-2xx status codes. */
export async function fetchChecked(fetchFn: FetchFn, url: string, init?: RequestInit, timeoutMs?: number): Promise<Response> {
  const response = await fetchWithTimeout(fetchFn, url, init, timeoutMs)
  if (!response.ok) throw new HTTPError(response.status, url)
  return response
}

export async function fetchJSON<T = unknown>(fetchFn: FetchFn, url: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const response = await fetchChecked(fetchFn, url, init, timeoutMs)
  const text = await response.text()
  return JSON.parse(text) as T
}

// MARK: Lossy decoding (Plex is inconsistent about numbers vs strings)

export function lossyString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

export function lossyInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && /^\s*[-+]?\d+\s*$/.test(value)) return parseInt(value, 10)
  if (typeof value === 'boolean') return value ? 1 : 0
  return undefined
}

export function lossyDouble(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

export function lossyBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true'
  return false
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
