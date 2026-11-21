// Fake plex.tv, Plex Media Server and detector for local development and the smoke test.
// Nothing here talks to the real Plex. Media is generated with ffmpeg into dev/.media.
//
//   node dev/fake-server.mjs            # serves dev/.out/dist (build with `npm run build:fake`)
//   FAKE_HLS=absolute node dev/fake-server.mjs
//
// Ports (env): FAKE_APP_PORT 5180, FAKE_PLEXTV_PORT 5181, FAKE_PMS_PORT 5182, FAKE_DETECTOR_PORT 5183.

import { execFile } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))

export const USER_TOKEN = 'fake-user-token'
export const SERVER_TOKEN = 'fake-server-token'
const DURATION = 90 // seconds of every fake file

// MARK: Media

/** One H.264/AAC test clip (a counter on screen, a tone), its BIF thumbnails and SRT. */
export async function ensureMedia(dir = join(here, '.media')) {
  mkdirSync(dir, { recursive: true })
  const clip = join(dir, 'clip.mp4')
  if (!existsSync(clip)) {
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc=duration=${DURATION}:size=640x360:rate=25`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${DURATION}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-profile:v', 'main',
      '-g', '25', '-keyint_min', '25', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
      '-shortest', '-movflags', '+faststart', clip,
    ])
  }
  const thumbs = join(dir, 'thumbs')
  const bif = join(dir, 'clip.bif')
  if (!existsSync(bif)) {
    mkdirSync(thumbs, { recursive: true })
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', clip, '-vf', 'fps=1/5,scale=240:-2', '-q:v', '6', join(thumbs, '%04d.jpg')])
    const images = readdirSync(thumbs)
      .filter((f) => f.endsWith('.jpg'))
      .sort()
      .map((f) => readFileSync(join(thumbs, f)))
    writeFileSync(bif, buildBif(images, 5000))
  }
  return { dir, clip, bif }
}

/** Roku BIF: what Plex serves at /library/parts/{id}/indexes/sd. */
function buildBif(images, intervalMs) {
  const header = 64 + (images.length + 1) * 8
  const total = header + images.reduce((n, img) => n + img.length, 0)
  const out = Buffer.alloc(total)
  Buffer.from([0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]).copy(out, 0)
  out.writeUInt32LE(0, 8)
  out.writeUInt32LE(images.length, 12)
  out.writeUInt32LE(intervalMs, 16)
  let offset = header
  images.forEach((img, i) => {
    out.writeUInt32LE(i, 64 + i * 8)
    out.writeUInt32LE(offset, 64 + i * 8 + 4)
    img.copy(out, offset)
    offset += img.length
  })
  out.writeUInt32LE(0xffffffff, 64 + images.length * 8)
  out.writeUInt32LE(offset, 64 + images.length * 8 + 4)
  return out
}

/** Windows-1251, as many Russian .srt files are. */
function cp1251(text) {
  const out = []
  for (const ch of text) {
    const c = ch.codePointAt(0)
    if (c < 0x80) out.push(c)
    else if (c >= 0x410 && c <= 0x44f) out.push(c - 0x410 + 0xc0)
    else if (c === 0x401) out.push(0xa8)
    else if (c === 0x451) out.push(0xb8)
    else out.push(0x3f)
  }
  return Buffer.from(out)
}

const SRT = `1
00:00:01,000 --> 00:00:04,000
Привет из субтитров

2
00:00:16,000 --> 00:00:22,000
Заставка позади

3
00:00:40,000 --> 00:00:50,000
Середина серии
`

// MARK: Library

function now() {
  return Math.floor(Date.now() / 1000)
}

function videoMedia(id, container, audio, subs = [], indexes = 'sd') {
  return {
    id,
    duration: DURATION * 1000,
    container,
    videoCodec: 'h264',
    videoProfile: 'main',
    videoResolution: '360',
    audioCodec: 'aac',
    audioChannels: 2,
    Part: [
      {
        id,
        key: `/library/parts/${id}/1700000000/file.${container}`,
        duration: DURATION * 1000,
        size: 1500000,
        container,
        indexes,
        Stream: [
          { id: id * 10, streamType: 1, codec: 'h264', index: 0, default: true },
          ...audio.map((a, i) => ({ streamType: 2, codec: 'aac', channels: 2, index: i + 1, ...a })),
          ...subs.map((s) => ({ streamType: 3, ...s })),
        ],
      },
    ],
  }
}

/** Fresh library state (watch state changes with timeline/scrobble calls). */
export function makeLibrary() {
  const t = now()
  const show = {
    ratingKey: '100',
    key: '/library/metadata/100/children',
    type: 'show',
    title: 'Тестовый сериал',
    summary: 'Сериал из генератора тестового сигнала: счётчик на экране и ровный тон.',
    year: 2025,
    contentRating: '16+',
    thumb: '/library/metadata/100/thumb/1',
    art: '/library/metadata/100/art/1',
    leafCount: 3,
    viewedLeafCount: 1,
    childCount: 1,
    addedAt: t - 9000,
  }
  const season = {
    ratingKey: '110',
    key: '/library/metadata/110/children',
    type: 'season',
    title: 'Сезон 1',
    index: 1,
    parentRatingKey: '100',
    parentTitle: show.title,
    thumb: '/library/metadata/110/thumb/1',
    parentThumb: show.thumb,
    art: show.art,
    leafCount: 3,
    viewedLeafCount: 1,
    addedAt: t - 9000,
  }
  const episode = (ratingKey, index, title, extra, media) => ({
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    type: 'episode',
    title,
    index,
    parentIndex: 1,
    parentRatingKey: '110',
    parentTitle: 'Сезон 1',
    grandparentRatingKey: '100',
    grandparentTitle: show.title,
    summary: `Серия ${index}: ${title.toLowerCase()}.`,
    duration: DURATION * 1000,
    thumb: `/library/metadata/${ratingKey}/thumb/1`,
    parentThumb: season.thumb,
    grandparentThumb: show.thumb,
    grandparentArt: show.art,
    art: show.art,
    originallyAvailableAt: `2025-01-0${index}`,
    addedAt: t - 9000 + index,
    Media: [media],
    ...extra,
  })
  const episodes = [
    episode('111', 1, 'Начало', { viewCount: 1, lastViewedAt: t - 5000 }, videoMedia(1110, 'mp4', [{ id: 11101, languageCode: 'rus', title: 'Дубляж', default: true }])),
    episode(
      '112',
      2,
      'Продолжение',
      {},
      videoMedia(
        1120,
        'mp4',
        [{ id: 11201, languageCode: 'eng', title: 'English', default: true }],
        [{ id: 11202, codec: 'srt', languageCode: 'rus', title: 'Русские', key: '/library/streams/11202' }],
      ),
    ),
    // MKV: the browser can't play it, so it goes through the (fake) transcoder.
    episode(
      '113',
      3,
      'Финал',
      { viewOffset: 40000, lastViewedAt: t - 50 },
      videoMedia(1130, 'mkv', [
        { id: 11301, languageCode: 'eng', title: 'English', default: true },
        { id: 11302, languageCode: 'rus', title: 'Многоголосый' },
      ]),
    ),
  ]
  const movie = {
    ratingKey: '200',
    key: '/library/metadata/200',
    type: 'movie',
    title: 'Тестовый фильм',
    summary: 'Полтора часа? Нет, полторы минуты тестовой таблицы.',
    year: 2024,
    contentRating: '12+',
    audienceRating: 7.9,
    duration: DURATION * 1000,
    viewOffset: 30000,
    lastViewedAt: t - 100,
    thumb: '/library/metadata/200/thumb/1',
    art: '/library/metadata/200/art/1',
    addedAt: t - 3000,
    Media: [videoMedia(2000, 'mp4', [{ id: 20001, languageCode: 'rus', title: 'Дубляж', default: true }], [], '')],
  }
  return { show, season, episodes, movie }
}

// Next-up episodes of two other shows that the smoke never opens. Plex lists them before the
// test show's next episode; the app looks the shows up (/library/metadata/300,400,100) and puts
// the most recently watched show first: test show, then «Третий сериал», then «Второй сериал».
function otherShows(t) {
  const next = (show, title, episodeTitle) => ({
    ratingKey: `${show}1`,
    key: `/library/metadata/${show}1`,
    type: 'episode',
    title: episodeTitle,
    index: 1,
    parentIndex: 1,
    parentRatingKey: `${show}0`,
    grandparentRatingKey: show,
    grandparentTitle: title,
    duration: 90000,
  })
  return {
    deck: [next('300', 'Второй сериал', 'Пилот'), next('400', 'Третий сериал', 'Начало')],
    shows: {
      300: { ratingKey: '300', type: 'show', title: 'Второй сериал', lastViewedAt: t - 900000 },
      400: { ratingKey: '400', type: 'show', title: 'Третий сериал', lastViewedAt: t - 600000 },
    },
  }
}

const defaultSegments = {
  112: [
    { type: 'intro', start: 5, end: 15 },
    { type: 'credits', start: 70, end: 90 },
  ],
  113: [
    { type: 'intro', start: 5, end: 15 },
    { type: 'credits', start: 72, end: 90 },
  ],
  200: [{ type: 'credits', start: 80, end: 90 }],
}

// MARK: HTTP helpers

function cors(res, methods = 'GET, PUT, POST, DELETE, OPTIONS', headers = '*') {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', methods)
  res.setHeader('Access-Control-Allow-Headers', headers)
  res.setHeader('Access-Control-Max-Age', '600')
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

function text(res, body, status = 200, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type })
  res.end(body)
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

function serveFile(req, res, file, type) {
  const size = statSync(file).size
  const range = req.headers.range
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes' }
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    let start = m && m[1] ? Number(m[1]) : 0
    let end = m && m[2] ? Number(m[2]) : size - 1
    if (m && !m[1] && m[2]) {
      start = size - Number(m[2])
      end = size - 1
    }
    if (start >= size || end >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      res.end()
      return
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    if (req.method === 'HEAD') return res.end()
    createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { ...headers, 'Content-Length': size })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

function hue(textValue) {
  let h = 0
  for (const ch of textValue) h = (h * 31 + ch.codePointAt(0)) % 360
  return h
}

function escapeXML(s) {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])
}

/** Artwork: a gradient with the item's title. */
function artwork(label, w, h) {
  const a = hue(label)
  const size = Math.max(14, Math.round(Math.min(w, h) / 9))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a},45%,34%)"/><stop offset="1" stop-color="hsl(${(a + 50) % 360},40%,10%)"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="50%" y="50%" fill="rgba(255,255,255,0.82)" font-family="-apple-system,Helvetica,Arial,sans-serif" font-weight="700" font-size="${size}" text-anchor="middle" dominant-baseline="middle">${escapeXML(label)}</text>
</svg>`
}

// MARK: Servers

/**
 * Starts the fakes. Returns their URLs, the request log and `close()`.
 * `hls`: 'relative' (stream starts at the offset, times from 0) or 'absolute' (whole file).
 */
export async function startFake(options = {}) {
  const ports = {
    app: Number(options.appPort ?? process.env.FAKE_APP_PORT ?? 5180),
    plextv: Number(options.plextvPort ?? process.env.FAKE_PLEXTV_PORT ?? 5181),
    pms: Number(options.pmsPort ?? process.env.FAKE_PMS_PORT ?? 5182),
    detector: Number(options.detectorPort ?? process.env.FAKE_DETECTOR_PORT ?? 5183),
  }
  const host = '127.0.0.1'
  const urls = Object.fromEntries(Object.entries(ports).map(([k, p]) => [k, `http://${host}:${p}`]))
  const hlsMode = options.hls ?? process.env.FAKE_HLS ?? 'relative'
  const appDir = resolve(options.appDir ?? join(here, '.out', 'dist'))
  const media = await ensureMedia(options.mediaDir)
  const hlsRoot = join(media.dir, 'hls')
  rmSync(hlsRoot, { recursive: true, force: true })
  mkdirSync(hlsRoot, { recursive: true })

  const library = makeLibrary()
  const others = otherShows(now())
  const segments = { ...defaultSegments, ...(options.segments ?? {}) }
  const preferences = new Map()
  const pins = new Map()
  const requests = []
  const state = { detectorDown: !!options.detectorDown, detectorDelayMs: 0, preferences, pins, library }

  const log = (server, req, url, body, res) => {
    const entry = {
      server,
      method: req.method,
      path: decodeURIComponent(url.pathname),
      query: Object.fromEntries(url.searchParams),
      headers: { 'x-plex-token': req.headers['x-plex-token'], 'content-type': req.headers['content-type'] },
      body,
      at: Date.now(),
    }
    requests.push(entry)
    res?.on('finish', () => (entry.status = res.statusCode))
  }

  // plex.tv: PINs, the sign-in page and the server list.
  const plextv = createServer(async (req, res) => {
    const url = new URL(req.url, urls.plextv)
    cors(res)
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    log('plextv', req, url, undefined, res)
    const p = url.pathname
    if (req.method === 'POST' && p === '/api/v2/pins') {
      if (!url.searchParams.get('X-Plex-Client-Identifier')) return json(res, { error: 'no client id' }, 400)
      const id = pins.size + 1000
      const pin = { id, code: `FAKE${id}`, approved: false, clientId: url.searchParams.get('X-Plex-Client-Identifier') }
      pins.set(id, pin)
      return json(res, { id, code: pin.code, authToken: null, expiresIn: 1800 }, 201)
    }
    const pinMatch = /^\/api\/v2\/pins\/(\d+)$/.exec(p)
    if (req.method === 'GET' && pinMatch) {
      const pin = pins.get(Number(pinMatch[1]))
      if (!pin || pin.code !== url.searchParams.get('code')) return json(res, { error: 'not found' }, 404)
      return json(res, { id: pin.id, code: pin.code, authToken: pin.approved ? USER_TOKEN : null, expiresIn: 1700 })
    }
    if (p === '/auth') {
      // Stands in for app.plex.tv/auth: approves the PIN from the hash and goes back.
      return text(
        res,
        `<!doctype html><meta charset="utf-8"><title>Fake Plex sign-in</title><body style="background:#111;color:#eee;font-family:sans-serif">
<p id="s">Fake Plex: approving…</p>
<script>
const params = new URLSearchParams(location.hash.replace(/^#\\??/, ''));
fetch('/approve?code=' + encodeURIComponent(params.get('code')) + '&clientID=' + encodeURIComponent(params.get('clientID')))
  .then(() => setTimeout(() => location.href = params.get('forwardUrl'), 300));
</script></body>`,
        200,
        'text/html; charset=utf-8',
      )
    }
    if (p === '/approve') {
      const code = url.searchParams.get('code')
      for (const pin of pins.values()) if (pin.code === code && pin.clientId === url.searchParams.get('clientID')) pin.approved = true
      return text(res, 'ok')
    }
    if (p === '/api/v2/resources') {
      if (url.searchParams.get('X-Plex-Token') !== USER_TOKEN) return json(res, { error: 'unauthorized' }, 401)
      return json(res, [
        {
          name: 'Фейковый сервер',
          product: 'Plex Media Server',
          provides: 'server',
          clientIdentifier: 'fake-server',
          owned: true,
          accessToken: SERVER_TOKEN,
          connections: [
            // A remote address that never answers: probed in parallel, must not hold up the local one.
            { protocol: 'https', address: '10.255.255.1', port: 32400, uri: 'https://10-255-255-1.fake.plex.direct:32400', local: false, relay: false },
            { protocol: 'http', address: host, port: ports.pms, uri: urls.pms, local: true, relay: false },
          ],
        },
        { name: 'Плеер', provides: 'player', clientIdentifier: 'some-player', connections: [] },
      ])
    }
    json(res, { error: 'not found' }, 404)
  })

  const findItem = (ratingKey) => {
    const { show, season, episodes, movie } = library
    return [show, season, movie, ...episodes].find((i) => i.ratingKey === ratingKey)
  }
  const container = (Metadata, extra = {}) => ({ MediaContainer: { size: Metadata.length, Metadata, ...extra } })
  const recountShow = () => {
    const watched = library.episodes.filter((e) => (e.viewCount ?? 0) > 0).length
    library.show.viewedLeafCount = watched
    library.season.viewedLeafCount = watched
  }
  const sessions = new Map()

  async function startTranscode(url) {
    const session = url.searchParams.get('session')
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0))
    const dir = join(hlsRoot, session.replace(/[^\w-]/g, '_'))
    mkdirSync(dir, { recursive: true })
    const seek = hlsMode === 'relative' && offset > 0 ? ['-ss', String(offset)] : []
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...seek, '-i', media.clip,
      '-c', 'copy', '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0', '-hls_playlist_type', 'vod',
      '-hls_segment_filename', join(dir, 'seg%05d.ts'), join(dir, 'index.m3u8'),
    ])
    sessions.set(session, { dir, offset })
    return `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"\nsession/${encodeURIComponent(session)}/base/index.m3u8\n`
  }

  // Plex Media Server.
  const pms = createServer(async (req, res) => {
    const url = new URL(req.url, urls.pms)
    cors(res)
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    log('pms', req, url, undefined, res)
    const p = decodeURIComponent(url.pathname)
    const token = url.searchParams.get('X-Plex-Token') ?? req.headers['x-plex-token']
    if (token !== SERVER_TOKEN) return json(res, { error: 'unauthorized' }, 401)
    const { episodes, show, season, movie } = library

    try {
      if (p === '/identity') return json(res, { MediaContainer: { machineIdentifier: 'fake-server', version: '1.41.0' } })
      if (p === '/library/sections')
        return json(res, {
          MediaContainer: {
            Directory: [
              { key: '1', type: 'movie', title: 'Фильмы' },
              { key: '2', type: 'show', title: 'Сериалы' },
              { key: '3', type: 'artist', title: 'Музыка' },
            ],
          },
        })
      if (p === '/library/sections/1/all') return json(res, container([movie]))
      if (p === '/library/sections/2/all') return json(res, container([show]))
      if (p === '/library/sections/1/recentlyAdded') return json(res, container([movie]))
      if (p === '/library/sections/2/recentlyAdded') return json(res, container([...episodes].reverse()))
      if (p === '/library/onDeck') {
        const next = episodes.find((e) => !(e.viewCount > 0) && !e.viewOffset)
        const inProgress = [movie, ...episodes].filter((i) => i.viewOffset > 0)
        return json(res, container([...others.deck, ...(next ? [next] : []), ...inProgress]))
      }
      let m = /^\/library\/metadata\/(\w+(?:,\w+)+)$/.exec(p)
      if (m) {
        // Several items at once; like PMS, a show's lastViewedAt is its latest watched episode.
        const lastViewed = Math.max(0, ...library.episodes.map((e) => e.lastViewedAt ?? 0))
        const found = m[1].split(',').map((key) =>
          key === library.show.ratingKey ? { ...library.show, lastViewedAt: lastViewed || undefined } : others.shows[key] ?? findItem(key),
        )
        return json(res, container(found.filter(Boolean)))
      }
      m = /^\/library\/metadata\/(\w+)$/.exec(p)
      if (m) {
        const item = findItem(m[1])
        return item ? json(res, container([item])) : json(res, { error: 'not found' }, 404)
      }
      m = /^\/library\/metadata\/(\w+)\/children$/.exec(p)
      if (m) {
        if (m[1] === show.ratingKey) return json(res, container([season]))
        if (m[1] === season.ratingKey) return json(res, container(episodes))
        return json(res, container([]))
      }
      if (p === `/library/metadata/${show.ratingKey}/allLeaves`) return json(res, container(episodes))

      if (p === '/:/timeline') {
        const item = findItem(url.searchParams.get('ratingKey') ?? '')
        const time = Number(url.searchParams.get('time') ?? 0)
        // Like PMS: past 90 % the item counts as played and loses its resume point;
        // before that the offset is kept (also for an item that is already watched).
        if (item && time > 0) {
          item.lastViewedAt = now()
          if (time >= 0.9 * (item.duration ?? Infinity)) {
            item.viewCount = Math.max(1, item.viewCount ?? 0)
            delete item.viewOffset
            recountShow()
          } else item.viewOffset = time
        }
        return text(res, '')
      }
      if (p === '/:/scrobble' || p === '/:/unscrobble') {
        const item = findItem(url.searchParams.get('key') ?? '')
        const targets = item?.type === 'show' ? episodes : item?.type === 'season' ? episodes : item ? [item] : []
        for (const i of targets) {
          i.viewCount = p === '/:/scrobble' ? 1 : 0
          delete i.viewOffset
          if (p === '/:/scrobble') i.lastViewedAt = now()
        }
        recountShow()
        return text(res, '')
      }

      if (p.startsWith('/photo/:/transcode')) {
        const path = url.searchParams.get('url') ?? ''
        const key = /\/library\/metadata\/(\w+)/.exec(path)?.[1]
        const item = key ? findItem(key) : undefined
        const w = Math.min(2000, Number(url.searchParams.get('width') ?? 300))
        const h = Math.min(2000, Number(url.searchParams.get('height') ?? 300))
        const label = item ? (item.type === 'episode' ? `${item.index}. ${item.title}` : item.title) : 'SkipTV'
        res.setHeader('Cache-Control', 'max-age=3600')
        return text(res, artwork(label, w, h), 200, 'image/svg+xml')
      }

      m = /^\/library\/parts\/(\d+)\/indexes\/sd$/.exec(p)
      if (m) return serveFile(req, res, media.bif, 'application/octet-stream')
      m = /^\/library\/parts\/(\d+)$/.exec(p)
      if (m && req.method === 'PUT') return text(res, '')
      m = /^\/library\/parts\/(\d+)\/\d+\/file\.(\w+)$/.exec(p)
      if (m) return serveFile(req, res, media.clip, 'video/mp4')
      m = /^\/library\/streams\/(\d+)$/.exec(p)
      if (m) {
        res.writeHead(200, { 'Content-Type': 'application/x-subrip' })
        return res.end(cp1251(SRT))
      }

      if (p === '/video/:/transcode/universal/start.m3u8') {
        const required = ['path', 'session', 'protocol', 'X-Plex-Client-Identifier', 'X-Plex-Client-Profile-Extra']
        const missing = required.filter((k) => !url.searchParams.get(k))
        if (missing.length) return text(res, `missing ${missing.join(',')}`, 400)
        return text(res, await startTranscode(url), 200, 'application/vnd.apple.mpegurl')
      }
      m = /^\/video\/:\/transcode\/universal\/session\/([^/]+)\/base\/([\w.]+)$/.exec(p)
      if (m) {
        const s = sessions.get(m[1])
        if (!s) return text(res, 'no session', 404)
        const file = normalize(join(s.dir, m[2]))
        if (!file.startsWith(s.dir) || !existsSync(file)) return text(res, 'not found', 404)
        return serveFile(req, res, file, m[2].endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t')
      }
      if (p === '/video/:/transcode/universal/stop') {
        sessions.delete(url.searchParams.get('session'))
        return text(res, '')
      }
      json(res, { error: 'not found' }, 404)
    } catch (error) {
      console.error('fake pms', p, error)
      text(res, String(error), 500)
    }
  })

  // Detector with the CORS the real one is getting.
  const detector = createServer(async (req, res) => {
    const url = new URL(req.url, urls.detector)
    cors(res, 'GET, PUT, OPTIONS', 'X-Plex-Token, Content-Type, Accept')
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    const body = req.method === 'PUT' ? await readBody(req) : undefined
    log('detector', req, url, body, res)
    if (state.detectorDown) return text(res, 'down', 503)
    // A slow detector (smoke test: leaving the player while it still loads).
    if (state.detectorDelayMs && url.pathname !== '/healthz') await new Promise((r) => setTimeout(r, state.detectorDelayMs))
    const p = decodeURIComponent(url.pathname)
    if (p === '/healthz') return text(res, 'ok')
    if (req.headers['x-plex-token'] !== SERVER_TOKEN) return json(res, { error: 'unauthorized' }, 401)
    let m = /^\/v1\/segments\/(\w+)$/.exec(p)
    if (m) return json(res, { ratingKey: m[1], segments: segments[m[1]] ?? [], analyzed: true })
    if (p === '/v1/segments') {
      const keys = (url.searchParams.get('ratingKeys') ?? '').split(',').filter(Boolean)
      return json(res, { items: keys.map((k) => ({ ratingKey: k, segments: segments[k] ?? [], analyzed: true })) })
    }
    m = /^\/v1\/preferences\/([^/]+)$/.exec(p)
    if (m && req.method === 'GET') {
      const stored = preferences.get(m[1])
      return json(res, stored ? { key: m[1], preferences: stored, updatedAt: new Date().toISOString() } : { key: m[1], preferences: null })
    }
    if (m && req.method === 'PUT') {
      let value
      try {
        value = JSON.parse(body ?? '')
      } catch {
        return json(res, { error: 'bad json' }, 400)
      }
      if (value === null || (typeof value === 'object' && Object.keys(value).length === 0)) preferences.delete(m[1])
      else if (typeof value === 'object' && !Array.isArray(value)) preferences.set(m[1], value)
      else return json(res, { error: 'not an object' }, 400)
      const stored = preferences.get(m[1])
      return json(res, { key: m[1], preferences: stored ?? null })
    }
    json(res, { error: 'not found' }, 404)
  })

  // The built app.
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.map': 'application/json' }
  const app = createServer((req, res) => {
    const url = new URL(req.url, urls.app)
    let file = normalize(join(appDir, decodeURIComponent(url.pathname)))
    if (!file.startsWith(appDir)) return text(res, 'forbidden', 403)
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(appDir, 'index.html')
    if (!existsSync(file)) return text(res, `No build in ${appDir}. Run: npm run build:fake`, 404)
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
    createReadStream(file).pipe(res)
  })

  const servers = { app, plextv, pms, detector }
  await Promise.all(Object.entries(servers).map(([name, s]) => new Promise((ok, fail) => s.once('error', fail).listen(ports[name], host, ok))))

  return {
    urls,
    requests,
    state,
    close: () => Promise.all(Object.values(servers).map((s) => new Promise((ok) => (s.closeAllConnections?.(), s.close(ok))))),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fake = await startFake()
  console.log('Fake servers:')
  for (const [name, url] of Object.entries(fake.urls)) console.log(`  ${name.padEnd(9)} ${url}`)
  console.log(`Open ${fake.urls.app} (build with "npm run build:fake"), or run "npm run dev:fake".`)
}
