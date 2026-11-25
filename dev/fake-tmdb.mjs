// A stand-in for the TMDB proxy (loge-tv/tmdb-proxy): `/v1/videos`, `/v1/recommendations` and
// `/v1/titles` with the proxy's CORS and refusals. A Plex token is refused (400), a wrong or
// missing builds' token too (401); `state.tmdbStatus` makes every `/v1` answer that status
// (429 with `Retry-After: state.tmdbRetryAfter`).
//
// The smoke's fakes (dev/fake-server.mjs) start it with their TMDB data; the snapshot tests and
// the site's rig (landing's shots-raw/harness/tools/web) with the rig's.
//
//   const tmdb = await startFakeTMDB({ videos, recommendations, titles })
//
// Port: FAKE_TMDB_PORT, 5185 by default (the fake build's VITE_TMDB_PROXY_URL).
import { createServer } from 'node:http'

/** The fake build's VITE_TMDB_PROXY_TOKEN (vite.config.ts). */
export const CLIENT_TOKEN = 'fake-client-token'

/**
 * `videos`: item (`tv:1100`) → TMDB's videos; `recommendations`: seed → titles; `titles`:
 * `<kind>:<Plex's title>` (`movie:Soulm8te`) → `{ tmdbId, title }` in Russian. `log(req, url, res)`
 * sees every request but the preflights; `state` may be shared with the caller's fakes.
 */
export async function startFakeTMDB(options = {}) {
  const port = Number(options.port ?? process.env.FAKE_TMDB_PORT ?? 5185)
  const host = '127.0.0.1'
  const url = `http://${host}:${port}`
  const videos = options.videos ?? {}
  const recommendations = options.recommendations ?? {}
  const titles = options.titles ?? {}
  const state = options.state ?? {}
  state.tmdbStatus ??= 0
  state.tmdbRetryAfter ??= 30

  const json = (res, value, status = 200, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
    res.end(JSON.stringify(value))
  }

  const server = createServer((req, res) => {
    const u = new URL(req.url, url)
    // Like the proxy: CORS on everything, refusals included.
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type, X-Client-Token')
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After')
    res.setHeader('Access-Control-Max-Age', '600')
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    options.log?.(req, u, res)
    const p = decodeURIComponent(u.pathname)
    if (p === '/healthz') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok\n')
    if (!p.startsWith('/v1/')) return json(res, { error: 'not found' }, 404)
    if (req.method !== 'GET') return json(res, { error: 'method not allowed' }, 405)
    if (req.headers['x-plex-token'] !== undefined) return json(res, { error: 'X-Plex-Token is not accepted here' }, 400)
    if (req.headers['x-client-token'] !== CLIENT_TOKEN) return json(res, { error: 'unauthorized' }, 401)
    if (state.tmdbStatus === 429) return json(res, { error: 'too many requests' }, 429, { 'Retry-After': String(state.tmdbRetryAfter) })
    if (state.tmdbStatus) return json(res, { error: `status ${state.tmdbStatus}` }, state.tmdbStatus)
    const language = u.searchParams.get('language') ?? ''
    if (language && !/^[a-z]{2}(-[A-Z]{2})?$/.test(language)) return json(res, { error: 'bad language' }, 400)
    if (p === '/v1/videos') {
      const item = u.searchParams.get('item') ?? ''
      if (!/^(movie|tv):\d+$/.test(item)) return json(res, { error: 'bad item' }, 400)
      // Like the proxy: the asked language first.
      const lang = language.slice(0, 2) || 'ru'
      const list = [...(videos[item] ?? [])].sort((a, b) => Number(b.language === lang) - Number(a.language === lang))
      return json(res, { item, videos: list })
    }
    if (p === '/v1/recommendations') {
      const seeds = (u.searchParams.get('seeds') ?? '').split(',').filter(Boolean)
      if (seeds.length === 0 || seeds.length > 5) return json(res, { error: 'seeds: 1 to 5' }, 400)
      return json(res, { items: seeds.map((seed) => (recommendations[seed] ? { seed, titles: recommendations[seed] } : { seed, failed: true })) })
    }
    if (p === '/v1/titles') {
      const items = u.searchParams.getAll('item')
      if (items.length === 0 || items.length > 60) return json(res, { error: 'item: 1 to 60' }, 400)
      const answers = []
      for (const item of items) {
        // `<movie|tv>:<year>:<tmdbId>:<title>`; the title may hold `:`.
        const m = /^(movie|tv):(\d+):(\d+):(.+)$/s.exec(item)
        if (!m) return json(res, { error: 'bad item' }, 400)
        answers.push(titles[`${m[1]}:${m[4]}`] ?? {})
      }
      return json(res, { items: answers })
    }
    json(res, { error: 'not found' }, 404)
  })
  await new Promise((ok, fail) => server.once('error', fail).listen(port, host, ok))
  return {
    url,
    state,
    close: () => new Promise((ok) => (server.closeAllConnections?.(), server.close(ok))),
  }
}
