// Fake plex.tv, Plex Media Server, Plex's catalog (Discover + image resizer) and detector for
// local development and the smoke test. Nothing here talks to the real Plex. Media is generated
// with ffmpeg into dev/.media.
//
//   node dev/fake-server.mjs            # serves dev/.out/dist (build with `npm run build:fake`)
//   FAKE_HLS=absolute node dev/fake-server.mjs
//
// Ports (env): FAKE_APP_PORT 5180, FAKE_PLEXTV_PORT 5181, FAKE_PMS_PORT 5182, FAKE_DETECTOR_PORT 5183,
// FAKE_DISCOVER_PORT 5184, FAKE_TMDB_PORT 5185 (the TMDB proxy, dev/fake-tmdb.mjs).

import { execFile } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { startFakeTMDB } from './fake-tmdb.mjs'
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

4
00:00:05,000 --> 00:00:15,000
Реплика поверх заставки,
в две строки

5
00:00:52,000 --> 00:01:10,000
Реплика перед титрами,
тоже в две строки
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
    // Modern agent: the same title as the catalog's cat-show-10.
    guid: 'plex://show/cat-show-10',
    // TMDB's id: the seed of «Потому что вы смотрели» (the fake detector knows it).
    Guid: [{ id: 'imdb://tt0000100' }, { id: 'tmdb://1100' }, { id: 'tvdb://100' }],
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
    // Old agent: no catalog key, found by its title only.
    guid: 'com.plexapp.agents.imdb://tt0000200?lang=ru',
    Guid: [{ id: 'imdb://tt0000200' }, { id: 'tmdb://1200' }],
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
  // Never played: TMDB recommends it, so it is on «Похожее на сервере».
  const fresh = {
    ratingKey: '210',
    key: '/library/metadata/210',
    type: 'movie',
    title: 'Неначатый фильм',
    guid: 'plex://movie/cat-film-210',
    Guid: [{ id: 'tmdb://1210' }],
    summary: 'Его ещё не смотрели.',
    year: 2022,
    duration: DURATION * 1000,
    thumb: '/library/metadata/210/thumb/1',
    art: '/library/metadata/210/art/1',
    addedAt: t - 20000,
    Media: [videoMedia(2100, 'mp4', [{ id: 21001, languageCode: 'rus', title: 'Дубляж', default: true }], [], '')],
  }
  return { show, season, episodes, movie, fresh }
}

/**
 * The fake TMDB proxy's recommendations by seed. The show's: the server's unplayed movie
 * («Похожее на сервере»), a catalog movie, a movie watched on the account (dropped) and one Plex
 * doesn't know (dropped). The movie's: the show itself (a seed, dropped) and a catalog comedy.
 */
export const TMDB_RECOMMENDATIONS = {
  'tv:1100': [
    { tmdbId: 1210, type: 'movie', title: 'Неначатый фильм', year: 2022 },
    { tmdbId: 5001, type: 'movie', title: 'Новый фильм', year: 2026 },
    { tmdbId: 5003, type: 'movie', title: 'Просмотренный фильм', year: 2023 },
    { tmdbId: 5009, type: 'movie', title: 'Неизвестный Plex фильм', year: 2001 },
  ],
  'movie:1200': [
    { tmdbId: 1100, type: 'tv', title: 'Тестовый сериал', year: 2025 },
    { tmdbId: 5004, type: 'movie', title: 'Тестовая комедия', year: 2023 },
  ],
}

/**
 * The fake TMDB proxy's trailers (`/v1/videos`). The show: a Russian and an English one (and a
 * key that is not a YouTube id, dropped); the catalog movie: a teaser; the server's movie: none.
 */
export const TMDB_VIDEOS = {
  'tv:1100': [
    { key: 'ruTrailer01', name: 'Тестовый сериал — трейлер', type: 'Trailer', language: 'ru', official: true },
    { key: 'enTrailer01', name: 'Official Trailer', type: 'Trailer', language: 'en', official: true },
    { key: 'not a youtube id', name: 'Broken', type: 'Trailer', language: 'en', official: false },
  ],
  'movie:5001': [{ key: 'newTeaser01', name: '', type: 'Teaser', language: 'ru', official: true }],
}

/**
 * The fake TMDB proxy's Russian names (`/v1/titles`) of catalog titles Plex has in English:
 * `<kind>:<Plex's title>`.
 */
export const TMDB_TITLES = { 'movie:The Quiet Harbor': { tmdbId: 5020, title: 'Тихая гавань' } }

/** TMDB id → catalog key (`/library/metadata/matches`). */
const TMDB_MATCHES = { 'movie:5001': 'cat-new-1', 'movie:5003': 'cat-seen-1', 'movie:5004': 'cat-test-1' }

/** «More From This Cast & Crew» of the test show: itself, the server's movie, a watched one and two new. */
const MORE_FROM_CREDITS = { 'cat-show-10': ['cat-show-10', 'cat-film-200', 'cat-seen-1', 'cat-cast-1', 'cat-cast-2'] }

/** Plex's ready-made collections («Обзор»); the coming-soon one lists a new season of the test show. */
const HUBS = {
  'trending-plex': ['cat-new-1', 'cat-test-1', 'cat-show-10'],
  top_watchlisted: ['cat-new-2', 'cat-new-3'],
  'coming-soon': [{ season: 'cat-show-10', index: 2, originallyAvailableAt: '2027-01-15' }, 'cat-soon-1'],
  'highly-anticipated-movies': ['cat-soon-2'],
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

// MARK: Catalog

// Pictures are absolute URLs on a host that doesn't exist: the app must only ever hand them to
// the resizer (/photo), never load them itself.
const CATALOG_IMAGES = 'https://catalog-images.invalid'

function catalogItem(key, kind, title, year, summary, extra = {}) {
  return {
    ...extra,
    ratingKey: key,
    key: `/library/metadata/${key}`,
    guid: `plex://${kind}/${key}`,
    type: kind,
    title,
    year,
    summary,
    duration: kind === 'movie' ? 7_200_000 : 3_000_000,
    thumb: `${CATALOG_IMAGES}/${key}-poster.jpg`,
    art: `${CATALOG_IMAGES}/${key}-art.jpg`,
    Genre: [{ tag: 'Драма' }, { tag: 'Фантастика' }],
    ...(kind === 'show' ? { childCount: 3 } : {}),
  }
}

/** Plex's catalog (same titles as the Apple app's fake), plus a catalog-only «Тест…» title. */
export function makeCatalog() {
  return [
    catalogItem('cat-show-10', 'show', 'Тестовый сериал', 2025, 'Сериал для проверки интерфейса.'),
    // The server's old-agent movie (no catalog key): recognised by kind, title and year.
    catalogItem('cat-film-200', 'movie', 'Тестовый фильм', 2024, 'Фильм для проверки интерфейса.'),
    catalogItem('cat-new-1', 'movie', 'Новый фильм', 2026, 'Фильма нет на сервере: его можно добавить в список.', {
      contentRating: '16+',
      audienceRating: 7.4,
      // Details carry the other ids: TMDB's for its trailer.
      Guid: [{ id: 'imdb://tt0005001' }, { id: 'tmdb://5001' }],
    }),
    catalogItem('cat-new-2', 'show', 'Новый сериал', 2025, 'Сериала нет на сервере.'),
    catalogItem('cat-new-3', 'movie', 'Ещё один новый фильм', 2024, 'Третий тайтл каталога.'),
    // Not out yet (by the pinned «today», 2026-11-22): soonest first, the day before the year-only one.
    catalogItem('cat-soon-2', 'show', 'Будущий сериал', 2028, 'Объявлен на 2028 год.'),
    catalogItem('cat-soon-1', 'movie', 'Скоро фильм', 2027, 'Выйдет в марте 2027.', { originallyAvailableAt: '2027-03-12' }),
    // Watched elsewhere (Plex's watch history, USER_STATES): on the list but on no shelf.
    catalogItem('cat-seen-1', 'movie', 'Просмотренный фильм', 2023, 'Уже посмотрен.'),
    catalogItem('cat-seen-2', 'show', 'Начатый сериал', 2021, 'Начат в другом приложении.'),
    // Only in the catalog: «тест» finds it next to the server's two titles.
    catalogItem('cat-test-1', 'movie', 'Тестовая комедия', 2023, 'Комедии нет на сервере.'),
    // The server's unplayed movie (modern agent).
    catalogItem('cat-film-210', 'movie', 'Неначатый фильм', 2022, 'Его ещё не смотрели.'),
    // Plex has it only in English: the proxy names it in Russian (TMDB_TITLES). Opened by key only.
    catalogItem('cat-en-1', 'movie', 'The Quiet Harbor', 2019, 'Названия по-русски у Plex нет.'),
    // «Ещё с актёрами «Тестовый сериал»».
    catalogItem('cat-cast-1', 'movie', 'Фильм с теми же актёрами', 2022, 'Те же актёры.'),
    catalogItem('cat-cast-2', 'show', 'Сериал с теми же актёрами', 2020, 'Те же актёры.'),
  ]
}

/**
 * The list after a reset: two missing titles («Хочу посмотреть»), one the server has, a watched
 * movie and a started show (on no shelf), two not out yet («Ещё не вышло»).
 */
export const WATCHLIST_START = ['cat-new-2', 'cat-show-10', 'cat-new-3', 'cat-seen-1', 'cat-soon-2', 'cat-seen-2', 'cat-soon-1']

/**
 * The account's watch history, as `/library/metadata/<keys>/userState` gives it (the watchlist
 * itself carries none): movies count plays, shows watched episodes.
 */
const USER_STATES = {
  'cat-seen-1': { viewCount: 1, viewState: 'complete' },
  'cat-seen-2': { viewedLeafCount: 12 },
}

/**
 * Seasons and episodes in Plex's catalog (`/library/metadata/<key>/children`). «Тестовый сериал»:
 * the server has season 1's first three episodes; the catalog has five (E4 marked on the
 * account) and season 2, not out yet. «Новый сериал» (not on the server): two seasons.
 */
function catalogSeasons(show, seasons) {
  const result = []
  for (const [index, days] of seasons.entries()) {
    const key = `${show}-s${index + 1}`
    const episodes = days.map((day, e) => ({
      ratingKey: `${key}-e${e + 1}`,
      key: `/library/metadata/${key}-e${e + 1}`,
      type: 'episode',
      title: `Серия ${e + 1}`,
      index: e + 1,
      parentIndex: index + 1,
      parentRatingKey: key,
      grandparentRatingKey: show,
      summary: `Серия ${e + 1} сезона ${index + 1} из каталога Plex.`,
      originallyAvailableAt: day,
      duration: 2_700_000,
      thumb: `${CATALOG_IMAGES}/${key}-e${e + 1}-thumb.jpg`,
    }))
    result.push({
      season: { ratingKey: key, key: `/library/metadata/${key}`, type: 'season', title: `Сезон ${index + 1}`, index: index + 1, parentRatingKey: show, leafCount: days.length, thumb: `${CATALOG_IMAGES}/${key}-poster.jpg` },
      episodes,
    })
  }
  return result
}

export const CATALOG_CHILDREN = {
  'cat-show-10': catalogSeasons('cat-show-10', [
    ['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04', '2025-01-05'],
    ['2027-01-15', '2027-01-22'],
  ]),
  'cat-new-2': catalogSeasons('cat-new-2', [
    ['2025-02-01', '2025-02-08'],
    ['2025-09-01', '2025-09-08'],
  ]),
}

/** Catalog episodes and movies the account marked watched, after a reset. */
export const CATALOG_MARKS_START = ['cat-show-10-s1-e4']

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
    discover: Number(options.discoverPort ?? process.env.FAKE_DISCOVER_PORT ?? 5184),
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
  const catalog = makeCatalog()
  const state = {
    detectorDown: !!options.detectorDown,
    detectorDelayMs: 0,
    metadataDelayMs: 0,
    /** Catalog seasons' episodes come this much later (the show's seasons do not). */
    catalogEpisodesDelayMs: 0,
    preferences,
    pins,
    library,
    catalog,
    /** Catalog keys on the account's Plex list, last added first. */
    watchlist: [...WATCHLIST_START],
    /** Refuse list changes, like Plex being down. */
    watchlistFail: false,
    /** Catalog search down: the app falls back to the server's titles. */
    searchFail: false,
    /** The TMDB proxy answers every /v1 question with this status (0: as usual; 429 with Retry-After). */
    tmdbStatus: 0,
    tmdbRetryAfter: 30,
    /** The fake YouTube can't be reached: its connections are dropped (a browser error page in the frame). */
    youtubeDown: false,
    /** The fake YouTube player reports this error code to the page (150: embedding not allowed). */
    youtubeError: 0,
    /** Plex's collections down. */
    hubsFail: false,
    /** The server refuses DELETE (deletion not allowed in its settings). */
    deleteRefused: false,
    /** Catalog titles and episodes marked watched on the account; scrobbles as [action, key]. */
    catalogMarks: new Set(CATALOG_MARKS_START),
    scrobbles: [],
    scrobbleFail: false,
    resetWatchlist() {
      state.watchlist = [...WATCHLIST_START]
      state.watchlistFail = false
      state.searchFail = false
    },
  }

  const log = (server, req, url, body, res) => {
    const entry = {
      server,
      method: req.method,
      path: decodeURIComponent(url.pathname),
      query: Object.fromEntries(url.searchParams),
      headers: {
        'x-plex-token': req.headers['x-plex-token'],
        'x-plex-language': req.headers['x-plex-language'],
        'x-plex-client-identifier': req.headers['x-plex-client-identifier'],
        'x-client-token': req.headers['x-client-token'],
        'content-type': req.headers['content-type'],
      },
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
      // Not strong: a short code for plex.tv/link, as plex.tv gives (4 characters, 15 minutes).
      const strong = url.searchParams.get('strong') === 'true'
      const code = strong ? `FAKE${id}` : `K${String(id % 1000).padStart(3, '0')}`
      const pin = { id, code, strong, approved: false, clientId: url.searchParams.get('X-Plex-Client-Identifier') }
      pins.set(id, pin)
      return json(res, { id, code: pin.code, authToken: null, expiresIn: strong ? 1800 : 900 }, 201)
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
    if (p === '/link') {
      // Stands in for plex.tv/link with a signed-in account: approves the short PIN typed there.
      const code = (url.searchParams.get('code') ?? '').toUpperCase()
      const pin = [...pins.values()].find((x) => !x.strong && x.code === code)
      if (pin) pin.approved = true
      return text(res, pin ? 'linked' : 'no such code', pin ? 200 : 404)
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

  const allItems = () => [library.show, library.season, library.movie, library.fresh, ...library.episodes]
  /** Deleted items are gone from every answer (DELETE on the fake only). */
  const findItem = (ratingKey) => allItems().find((i) => i.ratingKey === ratingKey && !i.deleted)
  const alive = (list) => list.filter((i) => !i.deleted)
  state.resetCatalogMarks = () => {
    state.catalogMarks = new Set(CATALOG_MARKS_START)
    state.scrobbles = []
    state.scrobbleFail = false
  }
  state.restoreLibrary = () => {
    for (const item of allItems()) delete item.deleted
    state.deleteRefused = false
    recountShow()
  }
  const container = (Metadata, extra = {}) => ({ MediaContainer: { size: Metadata.length, Metadata, ...extra } })
  const recountShow = () => {
    const left = library.episodes.filter((e) => !e.deleted)
    const watched = left.filter((e) => (e.viewCount ?? 0) > 0).length
    library.show.viewedLeafCount = watched
    library.season.viewedLeafCount = watched
    library.show.leafCount = left.length
    library.season.leafCount = left.length
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
      if (req.method === 'DELETE') {
        // «Allow media deletion»: off answers 403 (state.deleteRefused).
        const target = /^\/library\/metadata\/(\w+)$/.exec(p)
        const item = target ? findItem(target[1]) : undefined
        if (!item) return json(res, { error: 'not found' }, 404)
        if (state.deleteRefused) return json(res, { error: 'forbidden' }, 403)
        const gone = item.type === 'show' ? [show, season, ...episodes] : item.type === 'season' ? [season, ...episodes] : [item]
        for (const i of gone) i.deleted = true
        recountShow()
        return text(res, '')
      }
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
      if (p === '/library/sections/1/all') return json(res, container([movie, library.fresh].filter((i) => !i.deleted)))
      if (p === '/library/sections/2/all') return json(res, container(alive([show])))
      if (p === '/library/sections/1/recentlyAdded') return json(res, container(alive([movie])))
      if (p === '/library/sections/2/recentlyAdded') return json(res, container(alive([...episodes].reverse())))
      if (p === '/status/sessions/history/all') {
        // The owner's plays (accountID 1), newest first: the last episode, then the movie.
        if (url.searchParams.get('accountID') !== '1') return json(res, container([]))
        const t = now()
        return json(
          res,
          container([
            { ratingKey: '113', type: 'episode', grandparentKey: '/library/metadata/100', viewedAt: t - 50, accountID: 1 },
            { ratingKey: '112', type: 'episode', grandparentKey: '/library/metadata/100', viewedAt: t - 80, accountID: 1 },
            { ratingKey: '200', type: 'movie', viewedAt: t - 100, accountID: 1 },
          ]),
        )
      }
      if (p === '/library/onDeck') {
        const next = alive(episodes).find((e) => !(e.viewCount > 0) && !e.viewOffset)
        const inProgress = alive([movie, ...episodes]).filter((i) => i.viewOffset > 0)
        return json(res, container([...others.deck, ...(next ? [next] : []), ...inProgress]))
      }
      let m = /^\/library\/metadata\/(\w+(?:,\w+)+)$/.exec(p)
      if (m) {
        // Several items at once. The fake's own simplification: a show's lastViewedAt is its
        // latest fully watched episode (not checked against PMS), so the half-watched episode
        // doesn't tie with the next-up one in «Продолжить просмотр».
        const lastViewed = Math.max(0, ...library.episodes.filter((e) => (e.viewCount ?? 0) > 0).map((e) => e.lastViewedAt ?? 0))
        const found = m[1].split(',').map((key) =>
          key === library.show.ratingKey ? { ...library.show, lastViewedAt: lastViewed || undefined } : others.shows[key] ?? findItem(key),
        )
        return json(res, container(found.filter((i) => i && !i.deleted)))
      }
      m = /^\/library\/metadata\/(\w+)$/.exec(p)
      if (m) {
        if (state.metadataDelayMs) await new Promise((r) => setTimeout(r, state.metadataDelayMs))
        const item = findItem(m[1])
        return item ? json(res, container([item])) : json(res, { error: 'not found' }, 404)
      }
      m = /^\/library\/metadata\/(\w+)\/children$/.exec(p)
      if (m) {
        if (m[1] === show.ratingKey) return json(res, container(alive([season])))
        if (m[1] === season.ratingKey) return json(res, container(alive(episodes)))
        return json(res, container([]))
      }
      if (p === `/library/metadata/${show.ratingKey}/allLeaves`) return json(res, container(alive(episodes)))

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
    // Like Sepia Server: CORS on everything but /healthz (the real one has it on /v1 only), so a page
    // can't read /healthz.
    if (url.pathname !== '/healthz') cors(res, 'GET, PUT, OPTIONS', 'X-Plex-Token, Content-Type, Accept')
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    const body = req.method === 'PUT' ? await readBody(req) : undefined
    // Stands in for TheIntroDB (segments when Sepia Server is down); it knows nothing here.
    if (url.pathname.startsWith('/theintrodb/')) {
      log('theintrodb', req, url, body, res)
      return json(res, { error: 'not found' }, 404)
    }
    log('detector', req, url, body, res)
    if (state.detectorDown) return text(res, 'down', 503)
    // A slow detector (smoke test: leaving the player while it still loads).
    if (state.detectorDelayMs && url.pathname !== '/healthz') await new Promise((r) => setTimeout(r, state.detectorDelayMs))
    const p = decodeURIComponent(url.pathname)
    if (p === '/healthz') return text(res, 'ok')
    // Stands in for YouTube's embed page (the trailer's iframe), so the browser never leaves the fakes.
    // Like YouTube's player with enablejsapi=1, it answers the page's «listening» with onReady
    // (and onError when `youtubeError` is set).
    const embed = /^\/embed\/([\w-]+)$/.exec(p)
    if (embed && state.youtubeDown) return req.socket.destroy()
    if (embed)
      return text(
        res,
        `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111;color:#eee;font:20px sans-serif;display:grid;place-items:center;height:100vh">Fake YouTube: ${embed[1]} (${escapeXML(url.searchParams.get('hl') ?? '')})<script>
addEventListener('message', (e) => {
  let data
  try { data = JSON.parse(e.data) } catch { return }
  if (data?.event !== 'listening' || window.answered) return
  window.answered = true
  const send = (event, info) => parent.postMessage(JSON.stringify({ event, info, id: data.id, channel: 'widget' }), '*')
  send('initialDelivery', {})
  send('onReady', null)
  if (${Number(state.youtubeError) || 0}) send('onError', ${Number(state.youtubeError) || 0})
})
</script></body>`,
        200,
        'text/html; charset=utf-8',
      )
    if (req.headers['x-plex-token'] !== SERVER_TOKEN) return json(res, { error: 'unauthorized' }, 401)
    let m = /^\/v1\/segments\/(\w+)$/.exec(p)
    if (m) return json(res, { ratingKey: m[1], segments: segments[m[1]] ?? [], analyzed: true })
    if (p === '/v1/segments') {
      const keys = (url.searchParams.get('ratingKeys') ?? '').split(',').filter(Boolean)
      return json(res, { items: keys.map((k) => ({ ratingKey: k, segments: segments[k] ?? [], analyzed: true })) })
    }
    // TMDB (/v1/videos, /v1/recommendations) is the proxy's: the app never asks Sepia Server.
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

  // Plex's catalog (discover.provider.plex.tv) and its image resizer (images.plex.tv) on one port.
  const catalogByKey = new Map(catalog.map((c) => [c.ratingKey, c]))
  const seasonByKey = new Map(Object.values(CATALOG_CHILDREN).flatMap((show) => show.map((s) => [s.season.ratingKey, s])))
  const childByKey = new Map(Object.values(CATALOG_CHILDREN).flatMap((show) => show.flatMap((s) => [[s.season.ratingKey, s.season], ...s.episodes.map((e) => [e.ratingKey, e])])))
  const discover = createServer(async (req, res) => {
    const url = new URL(req.url, urls.discover)
    // Like the real one: any origin, PUT allowed; headers limited to what the app sends.
    cors(res, 'GET, HEAD, PUT, OPTIONS', 'Accept, X-Plex-Token, X-Plex-Client-Identifier, X-Plex-Product, X-Plex-Language')
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    log('discover', req, url, undefined, res)
    const p = decodeURIComponent(url.pathname)
    if (p === '/photo') {
      // The resizer needs no token; the label comes from the catalog picture's URL.
      const source = url.searchParams.get('url') ?? ''
      const item = catalog.find((c) => c.thumb === source || c.art === source) ?? [...childByKey.values()].find((c) => c.thumb === source)
      const w = Math.min(2000, Number(url.searchParams.get('width') ?? 300))
      const h = Math.min(2000, Number(url.searchParams.get('height') ?? 300))
      res.setHeader('Cache-Control', 'max-age=3600')
      return text(res, artwork(item?.title ?? 'Plex', w, h), item ? 200 : 404, 'image/svg+xml')
    }
    // The account token (not the server's), in a header.
    if (req.headers['x-plex-token'] !== USER_TOKEN) return json(res, { error: 'unauthorized' }, 401)
    if (!req.headers['x-plex-client-identifier']) return json(res, { error: 'no client id' }, 400)
    if (req.method === 'GET' && p === '/library/search') {
      if (state.searchFail) return json(res, { error: 'down' }, 503)
      const query = (url.searchParams.get('query') ?? '').toLowerCase()
      const found = query ? catalog.filter((c) => c.title.toLowerCase().includes(query)) : []
      const results = found.map((c, i) => ({ score: 0.9 - i * 0.05, Metadata: { ...c, summary: undefined } }))
      // People come back too; the app drops them.
      if (query && 'тестовый актёр'.includes(query)) results.push({ score: 0.4, Metadata: { ratingKey: 'person-1', type: 'person', title: 'Тестовый актёр' } })
      return json(res, { MediaContainer: { size: results.length, SearchResults: [{ id: 'external', title: 'More Ways To Watch', size: results.length, SearchResult: results }] } })
    }
    if (req.method === 'GET' && p === '/library/sections/watchlist/all') {
      const start = Number(url.searchParams.get('X-Plex-Container-Start') ?? 0)
      const size = Number(url.searchParams.get('X-Plex-Container-Size') ?? 50)
      // No watch state, `includeUserState` or not, as on a real account.
      const all = state.watchlist
        .map((k) => catalogByKey.get(k))
        .filter(Boolean)
        .map((c) => ({ ...c, userState: false }))
      const page = all.slice(start, start + size)
      return json(res, { MediaContainer: { offset: start, totalSize: all.length, size: page.length, Metadata: page } })
    }
    if (req.method === 'GET' && p === '/library/metadata/matches') {
      const kind = url.searchParams.get('type') === '1' ? 'movie' : 'tv'
      const id = /^tmdb:\/\/(\d+)$/.exec(url.searchParams.get('guid') ?? '')?.[1]
      const key = id ? TMDB_MATCHES[`${kind}:${id}`] : undefined
      // Like Plex: titles in English whatever the language asked.
      return key ? json(res, { MediaContainer: { size: 1, Metadata: [{ ...catalogByKey.get(key), title: `${catalogByKey.get(key).title} (en)` }] } }) : json(res, { error: 'not found' }, 404)
    }
    if (req.method === 'GET' && p.startsWith('/hubs/sections/home/')) {
      const list = HUBS[p.slice('/hubs/sections/home/'.length)]
      if (!list || state.hubsFail) return json(res, { error: 'not found' }, state.hubsFail ? 503 : 404)
      const items = list.map((entry) => {
        if (typeof entry === 'string') return catalogByKey.get(entry)
        const show = catalogByKey.get(entry.season)
        return { ratingKey: `${entry.season}-s${entry.index}`, type: 'season', title: `Сезон ${entry.index}`, index: entry.index, parentRatingKey: entry.season, parentTitle: show.title, year: 2027, originallyAvailableAt: entry.originallyAvailableAt, thumb: show.thumb }
      })
      return json(res, { MediaContainer: { size: items.length, Metadata: items } })
    }
    let m = /^\/library\/metadata\/([\w-]+)\/more-from-credits$/.exec(p)
    if (req.method === 'GET' && m) {
      const keys = MORE_FROM_CREDITS[m[1]] ?? []
      return json(res, { MediaContainer: { size: keys.length, Metadata: keys.map((k) => catalogByKey.get(k)) } })
    }
    m = /^\/library\/metadata\/([\w-]+)\/children$/.exec(p)
    if (req.method === 'GET' && m) {
      const show = CATALOG_CHILDREN[m[1]]
      const season = show ? undefined : seasonByKey.get(m[1])
      if (season && state.catalogEpisodesDelayMs) await new Promise((r) => setTimeout(r, state.catalogEpisodesDelayMs))
      const items = show ? show.map((s) => s.season) : season ? season.episodes : undefined
      return items ? json(res, { MediaContainer: { size: items.length, Metadata: items } }) : json(res, { error: 'not found' }, 404)
    }
    m = /^\/actions\/(scrobble|unscrobble)$/.exec(p)
    if (m) {
      // Marks for the account (on metadata.provider.plex.tv for real; the same fake here).
      const key = url.searchParams.get('key') ?? ''
      if (state.scrobbleFail || url.searchParams.get('identifier') !== 'com.plexapp.plugins.library') return json(res, { error: 'refused' }, 500)
      state.scrobbles.push([m[1], key])
      const show = CATALOG_CHILDREN[key]
      const season = seasonByKey.get(key)
      const keys = show ? show.flatMap((s) => s.episodes.map((e) => e.ratingKey)) : season ? season.episodes.map((e) => e.ratingKey) : [key]
      for (const k of keys) {
        if (m[1] === 'scrobble') state.catalogMarks.add(k)
        else state.catalogMarks.delete(k)
      }
      return text(res, '')
    }
    m = /^\/library\/metadata\/([\w,-]+)\/userState$/.exec(p)
    if (req.method === 'GET' && m) {
      // Shaped like a real answer: movies with viewCount (0 when unwatched), shows with
      // viewedLeafCount once an episode is watched; seasons count their marked episodes.
      const marked = (k) => (state.catalogMarks.has(k) ? { viewCount: 1, viewState: 'complete' } : {})
      const states = m[1]
        .split(',')
        .filter((k) => catalogByKey.has(k) || childByKey.has(k))
        .map((k) => {
          const season = seasonByKey.get(k)
          if (season) {
            const viewed = season.episodes.filter((e) => state.catalogMarks.has(e.ratingKey)).length
            return { ratingKey: k, type: 'season', ...(viewed ? { viewedLeafCount: viewed } : {}), ...(viewed === season.episodes.length ? { viewState: 'complete' } : {}) }
          }
          if (childByKey.has(k)) return { ratingKey: k, type: 'episode', ...marked(k) }
          const type = catalogByKey.get(k).type
          return { ratingKey: k, type, ...(type === 'movie' ? { viewCount: 0, viewOffset: 0 } : {}), ...USER_STATES[k], ...marked(k), watchlistedAt: 1792598042 }
        })
      return json(res, { MediaContainer: { identifier: 'tv.plex.provider.discover', size: states.length, UserState: states } })
    }
    m = /^\/library\/metadata\/([\w-]+)$/.exec(p)
    if (req.method === 'GET' && m) {
      const item = catalogByKey.get(m[1])
      return item ? json(res, { MediaContainer: { size: 1, Metadata: [item] } }) : json(res, { error: 'not found' }, 404)
    }
    m = /^\/actions\/(addToWatchlist|removeFromWatchlist)$/.exec(p)
    if (m) {
      if (req.method !== 'PUT') return json(res, { error: 'method' }, 405)
      const key = url.searchParams.get('ratingKey') ?? ''
      if (state.watchlistFail || !catalogByKey.has(key)) return json(res, { error: 'refused' }, 500)
      state.watchlist = state.watchlist.filter((k) => k !== key)
      if (m[1] === 'addToWatchlist') state.watchlist.unshift(key)
      return text(res, '')
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

  const servers = { app, plextv, pms, detector, discover }
  await Promise.all(Object.entries(servers).map(([name, s]) => new Promise((ok, fail) => s.once('error', fail).listen(ports[name], host, ok))))
  // The TMDB proxy: titles, trailers and recommendations.
  const tmdb = await startFakeTMDB({
    port: options.tmdbPort,
    videos: TMDB_VIDEOS,
    recommendations: TMDB_RECOMMENDATIONS,
    titles: TMDB_TITLES,
    state,
    log: (req, url, res) => log('tmdb', req, url, undefined, res),
  })
  urls.tmdb = tmdb.url

  return {
    urls,
    requests,
    state,
    close: () => Promise.all([...Object.values(servers).map((s) => new Promise((ok) => (s.closeAllConnections?.(), s.close(ok)))), tmdb.close()]),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fake = await startFake()
  console.log('Fake servers:')
  for (const [name, url] of Object.entries(fake.urls)) console.log(`  ${name.padEnd(9)} ${url}`)
  console.log(`Open ${fake.urls.app} (build with "npm run build:fake"), or run "npm run dev:fake".`)
}
