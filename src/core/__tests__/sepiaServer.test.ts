import { describe, expect, it } from 'vitest'
import type { PlexConnection } from '../plexAccount'
import { checkAddress, discover, fetchInfo, identityOf, isHomeHost, needsConsent, probeURLs, statusText, verdictText } from '../sepiaServer'

const server = { clientIdentifier: 'plex-1' }
const info = (extra: Record<string, unknown> = {}) => JSON.stringify({ product: 'Sepia Server', version: '0.7.0', machineIdentifier: 'plex-1', ...extra })

/** Answers by `host + path`; unknown ones never answer (rejected like a timeout). */
function sites(answers: Record<string, [number, string] | 'hang'>) {
  const asked: { url: string; token: string | null }[] = []
  const fetchFn = async (input: string, init?: RequestInit) => {
    const u = new URL(input)
    asked.push({ url: u.host + u.pathname, token: new Headers(init?.headers).get('X-Plex-Token') })
    const answer = answers[u.host + u.pathname]
    if (!answer || answer === 'hang') {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    }
    return new Response(answer[1], { status: answer[0] })
  }
  return { fetchFn, asked }
}

const conn = (address: string, local: boolean, relay = false): PlexConnection => ({ uri: `https://${address}.plex.direct:32400`, local, relay, address, port: 32400 })

describe('Sepia Server', () => {
  it('/v1/info: Sepia Server, before 0.7.0 (404), something else, nothing', async () => {
    const { fetchFn } = sites({
      'a:32420/v1/info': [200, info()],
      'b:32420/v1/info': [404, '{"error":"not found"}'],
      'c:32420/v1/info': [200, '{"product":"Other"}'],
      'd:32420/v1/info': [401, '{"error":"unauthorized"}'],
    })
    expect(await fetchInfo('http://a:32420', fetchFn)).toEqual({ kind: 'sepia', version: '0.7.0', machineIdentifier: 'plex-1' })
    expect(await fetchInfo('http://b:32420', fetchFn)).toEqual({ kind: 'old' })
    expect(await fetchInfo('http://c:32420', fetchFn)).toEqual({ kind: 'other', status: 200 })
    expect(await fetchInfo('http://d:32420', fetchFn)).toEqual({ kind: 'other', status: 401 })
    expect(await fetchInfo('http://e:32420', fetchFn, 10)).toEqual({ kind: 'unreachable' })
  })

  it('whose it is: no machineIdentifier yet is «later», not «another server»', () => {
    expect(identityOf({ machineIdentifier: 'plex-1' }, server)).toBe('match')
    expect(identityOf({}, server)).toBe('pending')
    expect(identityOf({ machineIdentifier: 'plex-2' }, server)).toBe('foreign')
  })

  it('home network: private, link-local, ULA, loopback, .local; the rest is external', () => {
    for (const h of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.5', '169.254.1.1', '127.0.0.1', 'localhost', '[::1]', '[fe80::1]', '[fd12::5]', 'nas.local'])
      expect(isHomeHost(h), h).toBe(true)
    for (const h of ['172.32.0.1', '8.8.8.8', 'example.com', 'nas', 'nas.home.arpa', '[2001:db8::1]', '1-2-3-4.abc.plex.direct'])
      expect(isHomeHost(h), h).toBe(false)
    expect(needsConsent('http://example.com:32420')).toBe(true)
    expect(needsConsent('https://example.com')).toBe(false)
    expect(needsConsent('http://192.168.1.5:32420')).toBe(false)
  })

  it('candidates: the addresses of direct connections, local first; from https only loopback', () => {
    const plex = { connections: [conn('203.0.113.7', false), conn('192.168.1.5', true), conn('192.168.1.5', true), conn('44.1.1.1', false, true), conn('fe80::5', true)] }
    expect(probeURLs(plex, 32420, false)).toEqual(['http://192.168.1.5:32420', 'http://[fe80::5]:32420', 'http://203.0.113.7:32420'])
    expect(probeURLs(plex, 32420, true)).toEqual([])
    expect(probeURLs({ connections: [conn('127.0.0.1', true)] }, 32420, true)).toEqual(['http://127.0.0.1:32420'])
  })

  it('discovery: this Plex server’s at home; a slow host doesn’t hold it up; another server’s is skipped', async () => {
    const plex = { ...server, connections: [conn('10.255.255.1', false), conn('192.168.1.9', true), conn('192.168.1.5', true)] }
    const { fetchFn } = sites({
      '192.168.1.9:32420/v1/info': [200, info({ machineIdentifier: 'plex-2' })],
      '192.168.1.5:32420/v1/info': [200, info()],
      '10.255.255.1:32420/v1/info': 'hang',
    })
    const started = Date.now()
    expect(await discover(plex, { pageIsHTTPS: false, fetchFn, timeoutMs: 50 })).toEqual({ kind: 'found', url: 'http://192.168.1.5:32420' })
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('discovery: not reached Plex yet; only on an external http address; nothing', async () => {
    const plex = { ...server, connections: [conn('192.168.1.5', true), conn('203.0.113.7', false)] }
    let s = sites({ '192.168.1.5:32420/v1/info': [200, info({ machineIdentifier: undefined })] })
    expect(await discover(plex, { pageIsHTTPS: false, fetchFn: s.fetchFn, timeoutMs: 20 })).toEqual({ kind: 'pending', url: 'http://192.168.1.5:32420' })
    s = sites({ '203.0.113.7:32420/v1/info': [200, info()] })
    expect(await discover(plex, { pageIsHTTPS: false, fetchFn: s.fetchFn, timeoutMs: 20 })).toEqual({ kind: 'external', url: 'http://203.0.113.7:32420' })
    s = sites({ '192.168.1.5:32420/v1/info': [404, ''] })
    expect(await discover(plex, { pageIsHTTPS: false, fetchFn: s.fetchFn, timeoutMs: 20 })).toEqual({ kind: 'none' })
    // From an https page nothing is asked.
    expect(await discover(plex, { pageIsHTTPS: true, fetchFn: s.fetchFn, timeoutMs: 20 })).toEqual({ kind: 'none' })
  })

  it('checking an address: the token only after /v1/info, and not to external http without consent', async () => {
    const { fetchFn, asked } = sites({
      'home:1/v1/info': [200, info()],
      'home:1/v1/stats': [200, '{}'],
      'sepia.example.com:32420/v1/info': [200, info()],
      'sepia.example.com:32420/v1/stats': [200, '{}'],
    })
    const opts = { pageIsHTTPS: false, fetchFn, timeoutMs: 20 }
    // `home` is a single-label name: external.
    expect(await checkAddress('http://sepia.example.com:32420', server, 'tok', opts)).toEqual({ kind: 'consent' })
    expect(asked.map((a) => a.url)).toEqual(['sepia.example.com:32420/v1/info'])
    expect(asked[0].token).toBeNull()
    expect(await checkAddress('http://sepia.example.com:32420', server, 'tok', { ...opts, consented: true })).toEqual({ kind: 'ok', version: '0.7.0', old: false })
    expect(asked.at(-1)).toEqual({ url: 'sepia.example.com:32420/v1/stats', token: 'tok' })
    // An http address from an https page: nothing asked.
    const before = asked.length
    expect(await checkAddress('http://192.168.1.5:32420', server, 'tok', { ...opts, pageIsHTTPS: true })).toEqual({ kind: 'blocked' })
    expect(asked).toHaveLength(before)
  })

  it('checking an address: before 0.7.0, another server, not yet, refused tokens, down', async () => {
    const { fetchFn } = sites({
      '192.168.1.5:8080/v1/info': [404, '{"error":"not found"}'],
      '192.168.1.5:8080/v1/stats': [200, '{}'],
      '192.168.1.6:32420/v1/info': [200, info({ machineIdentifier: 'plex-2' })],
      '192.168.1.7:32420/v1/info': [200, info({ machineIdentifier: '' })],
      '192.168.1.8:32420/v1/info': [200, info()],
      '192.168.1.8:32420/v1/stats': [401, '{"error":"token has no access to this plex server","code":"token_rejected"}'],
      '192.168.1.9:32420/v1/info': [200, info()],
      '192.168.1.9:32420/v1/stats': [401, '{"error":"X-Plex-Token header is required","code":"token_missing"}'],
      '192.168.1.10:8080/v1/info': [404, ''],
      '192.168.1.10:8080/v1/stats': [401, '{"error":"X-Plex-Token header is required"}'],
      '192.168.1.12:8080/v1/info': [404, ''],
      '192.168.1.12:8080/v1/stats': [401, '{"error":"unauthorized"}'],
    })
    const check = (url: string) => checkAddress(url, server, 'tok', { pageIsHTTPS: false, fetchFn, timeoutMs: 20 })
    expect(await check('http://192.168.1.5:8080')).toEqual({ kind: 'ok', version: undefined, old: true })
    expect(await check('http://192.168.1.6:32420')).toEqual({ kind: 'foreign' })
    expect(await check('http://192.168.1.7:32420')).toEqual({ kind: 'pending' })
    expect(await check('http://192.168.1.8:32420')).toEqual({ kind: 'tokenRejected' })
    expect(await check('http://192.168.1.9:32420')).toEqual({ kind: 'tokenMissing' })
    expect(await check('http://192.168.1.10:8080')).toEqual({ kind: 'tokenMissing' })
    // Before 0.7.0 a refused token has no code: reads as another Plex server's.
    expect(await check('http://192.168.1.12:8080')).toEqual({ kind: 'foreign' })
    expect(await check('http://192.168.1.11:32420')).toEqual({ kind: 'down' })
    expect(verdictText({ kind: 'foreign' })).toBe('Этот Sepia Server работает с другим сервером Plex.')
  })

  it('the settings’ connection state', () => {
    expect(statusText(undefined, 'Дом')).toBe('Проверяем…')
    expect(statusText({ kind: 'ok', version: '0.7.0', old: false }, 'Дом')).toBe('Подключён · Дом · 0.7.0')
    expect(statusText({ kind: 'ok', old: true }, 'Дом')).toBe('Подключён · Дом')
    expect(statusText({ kind: 'foreign' }, 'Дом')).toBe('Нет доступа: этот Sepia Server от другого сервера Plex')
    expect(statusText({ kind: 'down' }, 'Дом')).toBe('Не отвечает')
    expect(statusText({ kind: 'blocked' }, 'Дом')).toBe('Нужен https-адрес')
    expect(statusText({ kind: 'pending' }, 'Дом')).toBe('Sepia Server ещё запускается. Повторите чуть позже.')
  })
})
