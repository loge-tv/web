// End-to-end smoke test of the built app in headless Chrome against dev/fake-server.mjs.
//
//   npm run smoke                 # builds with --mode fake, then runs
//   SKIP_BUILD=1 npm run smoke    # reuse dev/.out/dist
//   FAKE_HLS=absolute npm run smoke
//   HEADED=1 npm run smoke        # watch it
//   CHROME_PATH=/path/to/chrome npm run smoke
//
// Screenshots go to dev/.out/screens.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { SERVER_TOKEN, startFake, USER_TOKEN } from './fake-server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const screens = join(here, '.out', 'screens')
mkdirSync(screens, { recursive: true })
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const hlsMode = process.env.FAKE_HLS ?? 'relative'

if (!process.env.SKIP_BUILD) {
  const build = spawnSync('npm', ['run', 'build:fake'], { cwd: join(here, '..'), stdio: 'inherit' })
  if (build.status !== 0) process.exit(build.status ?? 1)
}

const fake = await startFake({ hls: hlsMode })
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: !process.env.HEADED,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' })
const page = await context.newPage()
// Every host the browser asked for: only the fakes (rule: never the real Plex).
const requestedHosts = new Set()
const recordHosts = (ctx) =>
  ctx.on('request', (r) => {
    const url = new URL(r.url())
    if (url.protocol.startsWith('http')) requestedHosts.add(url.host)
  })
recordHosts(context)
const pageErrors = []
const consoleErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})

const app = fake.urls.app
let failed = false

async function step(name, fn) {
  if (failed) return
  const started = Date.now()
  try {
    await fn()
    console.log(`ok    ${name} (${Date.now() - started} ms)`)
  } catch (error) {
    failed = true
    console.log(`FAIL  ${name}\n      ${String(error?.stack ?? error).split('\n').slice(0, 6).join('\n      ')}`)
    await page.screenshot({ path: join(screens, 'failure.png') }).catch(() => {})
  }
}

async function until(fn, { timeout = 15000, interval = 150, message = 'condition' } = {}) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = await fn()
    if (last) return last
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`timed out waiting for ${message} (last: ${JSON.stringify(last)})`)
}

const find = (pred) => fake.requests.filter(pred)
const pms = (path, extra = () => true) => find((r) => r.server === 'pms' && r.path === path && extra(r))
const discover = (path, extra = () => true) => find((r) => r.server === 'discover' && r.path === path && extra(r))
/** "title | subtitle" of the cards of a home shelf or a search section (null when absent). */
const cardsUnder = (root, selector, title) =>
  root.$$eval(
    selector,
    (list, [t]) => {
      const box = list.find((s) => s.querySelector('h2')?.textContent === t)
      return box
        ? [...box.querySelectorAll('.card')].map((c) => `${c.querySelector('.card-title')?.textContent} | ${c.querySelector('.card-subtitle')?.textContent ?? ''}`)
        : null
    },
    [title],
  )
const shelfCards = (title, root = page) => cardsUnder(root, 'section.shelf', title)
const sectionCards = (title, root = page) => cardsUnder(root, '.search-section', title)
const listAlert = () => page.getByRole('alertdialog', { name: 'Список Plex' })
/** Screenshot once fades are over (dialog 0.15 s, images and buttons 0.3 s). */
const settledShot = async (name) => {
  await page.waitForTimeout(400)
  await shot(name)
}
const video = () =>
  page.evaluate(() => {
    const v = document.querySelector('video')
    return v ? { time: v.currentTime, paused: v.paused, src: v.currentSrc, duration: v.duration } : null
  })
const shownTime = async () => {
  const text = (await page.locator('.player-controls .time').textContent()) ?? ''
  const [m, s] = text.split('/')[0].trim().split(':').map(Number)
  return m * 60 + s
}
const shot = (name) => page.screenshot({ path: join(screens, `${name}.png`) })

// MARK: Steps

await step('PIN login through the fake plex.tv, server discovery, home', async () => {
  await page.goto(`${app}/`)
  await page.getByRole('button', { name: 'Войти через Plex' }).click()
  await page.getByRole('heading', { name: 'Продолжить просмотр' }).waitFor({ timeout: 30000 })
  assert.equal(await page.evaluate(() => localStorage.getItem('plexUserToken')), USER_TOKEN)
  assert.ok(find((r) => r.server === 'plextv' && r.method === 'POST' && r.path === '/api/v2/pins').length === 1)
  assert.ok(pms('/identity').length > 0, 'probed /identity')
  // Plex auth goes in the query (no custom headers → no CORS preflight to Plex).
  assert.ok(pms('/library/sections').every((r) => r.query['X-Plex-Token'] === SERVER_TOKEN && r.query['X-Plex-Client-Identifier']))
})

await step('home: continue watching order, recently added collapsed to seasons', async () => {
  await page.locator('.img img.loaded').first().waitFor({ timeout: 10000 })
  const shelves = await page.$$eval('section.shelf', (list) =>
    list.map((s) => ({
      title: s.querySelector('.shelf-title')?.textContent,
      cards: [...s.querySelectorAll('.card')].map((c) => `${c.querySelector('.card-title')?.textContent} | ${c.querySelector('.card-subtitle')?.textContent ?? ''}`),
    })),
  )
  assert.equal(shelves[0].title, 'Продолжить просмотр')
  assert.equal(shelves[0].cards.length, 5)
  // One list by recency: episode 3 and the movie by their own last view, next-up episodes by
  // when their show was last watched (the test show, then two others that Plex listed first).
  assert.match(shelves[0].cards[0], /Финал/)
  assert.match(shelves[0].cards[1], /Тестовый фильм/)
  assert.match(shelves[0].cards[2], /Продолжение/)
  assert.match(shelves[0].cards[3], /Третий сериал/)
  assert.match(shelves[0].cards[4], /Второй сериал/)
  assert.ok(pms('/library/metadata/300,400,100').length > 0, 'shows looked up in one request')
  const shows = shelves.find((s) => s.title === 'Недавно добавлено · Сериалы')
  assert.ok(shows, JSON.stringify(shelves))
  assert.equal(shows.cards.length, 1, 'three new episodes → one season card')
  assert.ok(shelves.some((s) => s.title === 'Недавно добавлено · Фильмы'))
  assert.ok(!shelves.some((s) => /Музыка/.test(s.title ?? '')), 'music libraries are hidden')
  await shot('home')
})

await step('episode card opens its season with the episode selected', async () => {
  // Off-centre: the centre of the artwork is the play button.
  await page.locator('section.shelf').first().locator('.card').nth(2).locator('button.card-art').click({ position: { x: 24, y: 24 } })
  await page.waitForURL(/#\/show\/100\?.*episode=112/)
  await page.locator('.landscape-card.selected').waitFor()
  assert.equal(await page.locator('.landscape-card.selected .card-title').textContent(), '2. Продолжение')
  await page.locator('.episode-details h2').waitFor()
  await shot('show')
})

let playStarted = 0
await step('direct play of an MP4 with cp1251 SRT subtitles', async () => {
  await page.locator('.episode-details').getByRole('button', { name: 'Смотреть' }).click()
  await page.waitForURL(/#\/play\/112/)
  playStarted = Date.now()
  await until(async () => ((await video())?.time ?? 0) > 0.3, { message: 'playback' })
  const v = await video()
  assert.match(v.src, /\/library\/parts\/1120\/.*file\.mp4/, 'direct play of the file')
  const subtitle = await until(async () => (await page.locator('.subtitle-text').textContent()) || '', { message: 'subtitle cue' })
  assert.equal(subtitle, 'Привет из субтитров')
  assert.ok(pms('/library/streams/11202').length > 0)
})

await step('auto skip: the intro (5–15 s) is skipped by itself', async () => {
  await until(async () => ((await video())?.time ?? 0) >= 14.5, { timeout: 15000, message: 'intro skipped' })
  const wall = (Date.now() - playStarted) / 1000
  assert.ok(wall < 12, `reached 0:15 after ${wall.toFixed(1)} s of real time: intro was not skipped`)
})

await step('BIF thumbnail while hovering the seek bar', async () => {
  await page.mouse.move(700, 400)
  const bar = await page.locator('.scrub').boundingBox()
  await page.mouse.move(bar.x + bar.width * 0.5, bar.y + bar.height / 2)
  await page.locator('.scrub-preview img').waitFor({ timeout: 5000 })
  assert.ok(pms('/library/parts/1120/indexes/sd').length > 0)
  await page.waitForTimeout(500) // controls and preview fade in over 0.3 s
  await shot('player-scrub')
  await page.mouse.move(700, 300)
})

await step('per-show correction in the tracks panel is pushed to the detector', async () => {
  await page.getByRole('button', { name: 'Дорожки и разметка' }).click()
  await page.getByText('Разметка сериала').waitFor()
  assert.match((await page.getByTestId('segments-summary').textContent()) ?? '', /Заставка 0:05–0:15 · Титры 1:10–1:30/)
  await page.getByRole('button', { name: 'Начало заставки позже' }).click()
  assert.equal(await page.getByTestId('offset-introStart').textContent(), '+1 с')
  assert.match((await page.getByTestId('segments-summary').textContent()) ?? '', /Заставка 0:06–0:15/)
  const put = await until(() => find((r) => r.server === 'detector' && r.method === 'PUT' && r.path === '/v1/preferences/100')[0], {
    timeout: 5000,
    message: 'PUT /v1/preferences/100',
  })
  assert.equal(put.headers['x-plex-token'], SERVER_TOKEN)
  assert.deepEqual(JSON.parse(put.body), { correction: { introStart: 1, introEnd: 0, creditsStart: 0, creditsEnd: 0 } })
  assert.deepEqual(fake.state.preferences.get('100').correction.introStart, 1)
  await shot('player-panel')
  await page.keyboard.press('Escape')
  await page.locator('.tracks-panel').waitFor({ state: 'detached' })
})

await step('progress reported to Plex while playing', async () => {
  await until(() => pms('/:/timeline', (r) => r.query.ratingKey === '112' && r.query.state === 'playing').length > 0, {
    timeout: 12000,
    message: 'timeline playing',
  })
})

await step('final credits → "Следующая серия через N" card, scrobble at credits', async () => {
  await page.mouse.move(700, 420)
  const bar = await page.locator('.scrub').boundingBox()
  await page.mouse.click(bar.x + (bar.width * 66) / 90, bar.y + bar.height / 2)
  await until(async () => ((await video())?.time ?? 0) >= 65, { timeout: 8000, message: 'seek to 1:06' })
  await page.getByText(/Следующая серия через \d/).waitFor({ timeout: 10000 })
  assert.ok(pms('/:/scrobble', (r) => r.query.key === '112').length === 1, 'scrobbled at credits start')
  await shot('player-next')
})

await step('autoplay of the next episode: MKV → Plex HLS transcode, resumed at 0:40', async () => {
  await page.waitForURL(/#\/play\/113/, { timeout: 12000 })
  const put = await until(() => pms('/library/parts/1130', (r) => r.method === 'PUT')[0], { message: 'PUT streams' })
  // Russian dub preferred over the default English track; no subtitles.
  assert.equal(put.query.audioStreamID, '11302')
  assert.equal(put.query.subtitleStreamID, '0')
  const start = await until(() => pms('/video/:/transcode/universal/start.m3u8')[0], { message: 'transcode start' })
  assert.equal(start.query.offset, '40')
  assert.equal(start.query.directStream, '1')
  assert.match(start.query['X-Plex-Client-Profile-Extra'], /add-transcode-target/)
  await until(async () => {
    const v = await video()
    return v && v.src.startsWith('blob:') && !v.paused && v.time > 0.3
  }, { timeout: 20000, message: 'HLS playback' })
  const shown = await until(async () => {
    const t = await shownTime()
    return t >= 40 ? t : 0
  }, { timeout: 8000, message: 'file time ≥ 0:40' })
  const v = await video()
  if (hlsMode === 'relative') assert.ok(v.time < 30, `relative stream: element time ${v.time} but file time ${shown}`)
  else assert.ok(v.time >= 39, `absolute stream: element time ${v.time}`)
  // Segment requests carry the token (hls.js xhrSetup).
  const segments = find((r) => r.server === 'pms' && r.path.includes('/transcode/universal/session/'))
  assert.ok(segments.length > 0 && segments.every((r) => r.query['X-Plex-Token'] === SERVER_TOKEN))
  await until(() => pms('/:/timeline', (r) => r.query.ratingKey === '113' && Number(r.query.time) >= 40000).length > 0, {
    timeout: 12000,
    message: 'timeline of episode 3 at ≥ 40 s',
  })
  await shot('player-hls')
})

await step('seeking back before the transcode offset restarts the transcode there', async () => {
  await page.keyboard.press('ArrowLeft') // −10 s
  await page.keyboard.press('ArrowLeft') // −10 s
  if (hlsMode === 'relative') {
    const restart = await until(() => pms('/video/:/transcode/universal/start.m3u8')[1], { timeout: 6000, message: 'second transcode start' })
    const offset = Number(restart.query.offset)
    assert.ok(offset >= 20 && offset < 40, `restart offset ${offset}`)
    assert.ok(pms('/video/:/transcode/universal/stop').length >= 1, 'previous session stopped')
  }
  await until(async () => {
    const t = await shownTime()
    const v = await video()
    return t >= 21 && t < 40 && v && !v.paused
  }, { timeout: 15000, message: 'playing from ~0:2x' })
})

await step('another dub: transcode restarts with it, remembered for the show on the detector', async () => {
  const startsBefore = pms('/video/:/transcode/universal/start.m3u8').length
  await page.mouse.move(700, 400)
  await page.getByRole('button', { name: 'Дорожки и разметка' }).click()
  await page.locator('.tracks-panel .panel-row', { hasText: 'Английский' }).click()
  const put = await until(() => pms('/library/parts/1130', (r) => r.method === 'PUT' && r.query.audioStreamID === '11301')[0], {
    message: 'PUT streams with the English track',
  })
  assert.ok(put)
  await until(() => pms('/video/:/transcode/universal/start.m3u8').length > startsBefore, { message: 'transcode restart' })
  const saved = await until(() => fake.state.preferences.get('100')?.audio, { timeout: 5000, message: 'audio preference on the detector' })
  assert.equal(saved.language, 'eng')
  assert.equal(saved.indexInLanguage, 0)
  await until(async () => {
    const v = await video()
    return v && !v.paused && (await shownTime()) >= 20
  }, { timeout: 15000, message: 'playing again after the switch' })
  await page.keyboard.press('Escape') // closes the panel
  await page.locator('.tracks-panel').waitFor({ state: 'detached' })
})

await step('Esc closes the player: stopped timeline, transcode stopped, back to the show', async () => {
  await page.keyboard.press('Escape')
  await page.waitForURL(/#\/show\/100/, { timeout: 5000 })
  await until(() => pms('/:/timeline', (r) => r.query.ratingKey === '113' && r.query.state === 'stopped').length > 0, {
    timeout: 5000,
    message: 'stopped timeline',
  })
  assert.ok(pms('/video/:/transcode/universal/stop').length >= 1)
})

await step('show page selects the episode in progress when none is named', async () => {
  // Library → show: a fresh show page without an episode in the link.
  await page.getByRole('navigation').getByRole('link', { name: 'Сериалы' }).click()
  await page.locator('.poster-grid .card button.card-art').first().click({ position: { x: 20, y: 20 } })
  await page.waitForURL(/#\/show\/100$/)
  await page.locator('.landscape-card.selected').waitFor()
  assert.equal(
    await page.locator('.landscape-card.selected .card-title').textContent(),
    '3. Финал',
    JSON.stringify(fake.state.library.episodes.map((e) => [e.ratingKey, e.viewCount, e.viewOffset])),
  )
  assert.match((await page.locator('.detail-body .btn-primary').textContent()) ?? '', /Продолжить/)
})

await step('movie: ▶ plays from where it was left (no dialog), mark watched, library filters', async () => {
  await page.goto(`${app}/#/`)
  const movieCard = page.locator('section.shelf').first().locator('.card').nth(1)
  await movieCard.hover()
  await movieCard.locator('.play-overlay').click()
  await page.waitForURL(/#\/play\/200\?t=30$/)
  await page.locator('.scrub').waitFor() // the player's keys work once it is up
  await page.keyboard.press('Escape')
  await page.waitForURL((u) => !u.hash.startsWith('#/play'), { timeout: 5000 })
  await page.getByRole('navigation').getByRole('link', { name: 'Фильмы' }).click()
  await page.waitForURL(/#\/library\/1/)
  await page.getByRole('tab', { name: 'Непросмотренные' }).click()
  // The movie in progress and the one never played.
  assert.equal(await page.locator('.poster-grid .card').count(), 2)
  await page.locator('.poster-grid .card', { hasText: 'Тестовый фильм' }).locator('button.card-art').click({ position: { x: 20, y: 20 } })
  await page.waitForURL(/#\/movie\/200/)
  await page.getByRole('button', { name: /Продолжить с 0:3\d/ }).waitFor()
  await shot('movie')
  await page.getByRole('button', { name: 'Просмотрено' }).click()
  await page.getByRole('button', { name: 'Не просмотрено' }).waitFor()
  assert.ok(pms('/:/scrobble', (r) => r.query.key === '200').length === 1)
  await page.goBack()
  await page.getByRole('tab', { name: 'Непросмотренные' }).click()
  await until(async () => (await page.locator('.poster-grid .card').count()) === 1, { message: 'one unwatched left' })
  assert.equal(await page.locator('.poster-grid .card .card-title').textContent(), 'Неначатый фильм')
  await page.getByRole('tab', { name: 'Все' }).click()
  assert.equal(await page.locator('.poster-grid .card').count(), 2)
})

const settingsPages = () => page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link')

await step('settings: a list of four pages, Back returns to it; detector reachable, skip mode persists', async () => {
  await page.getByRole('link', { name: 'Настройки' }).click()
  await page.waitForURL(/#\/settings$/)
  await settingsPages().first().waitFor()
  assert.deepEqual(await settingsPages().allTextContents(), ['Плеер', 'Главная и Обзор', 'Детектор заставок', 'Сервер и аккаунт'])
  await page.getByText(/^Loge /).waitFor()
  await settledShot('settings')
  // Browser Back from a page lands on the list.
  await settingsPages().filter({ hasText: 'Детектор заставок' }).click()
  await page.waitForURL(/#\/settings\/detector$/)
  await page.getByText('Детектор отвечает').waitFor({ timeout: 8000 })
  await page.getByText('Сервис, который находит заставки и титры. Если он недоступен, видео просто играет без пропуска.').waitFor()
  await page.goBack()
  await page.waitForURL(/#\/settings$/)
  // So does the page's own «Настройки».
  await settingsPages().filter({ hasText: 'Сервер и аккаунт' }).click()
  await page.waitForURL(/#\/settings\/server$/)
  await page.getByText('Фейковый сервер').waitFor()
  await page.getByRole('button', { name: 'Выйти из аккаунта Plex' }).waitFor()
  await page.getByRole('button', { name: 'Настройки' }).click()
  await page.waitForURL(/#\/settings$/)
  await settingsPages().filter({ hasText: 'Плеер' }).click()
  await page.waitForURL(/#\/settings\/playback$/)
  await page.getByRole('switch', { name: 'Всегда через сервер (транскодирование)' }).waitFor({ state: 'attached' })
  await page.getByRole('radio', { name: 'Кнопкой' }).click().catch(async () => {
    // Title of the button mode may differ; pick the third option.
    await page.locator('[role=radiogroup]').first().locator('[role=radio]').nth(2).click()
  })
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('settings') ?? '{}'))
  assert.notEqual(stored.skipMode, 'auto')
  await shot('settings-playback')
})

await step('countdown mode: «Не пропускать» keeps the intro, then a skip button inside it', async () => {
  await page.getByRole('radio', { name: 'С отсчётом' }).click()
  await page.goto(`${app}/#/play/112?t=1`)
  await page.locator('.skip-countdown').waitFor({ timeout: 10000 })
  await shot('player-countdown')
  await page.getByRole('button', { name: 'Не пропускать' }).click()
  await page.locator('.skip-countdown').waitFor({ state: 'detached' })
  // Inside the intro (6–15 s with the +1 s correction): a button instead of a skip.
  const skip = page.locator('.skip-button')
  await skip.waitFor({ timeout: 10000 })
  const before = (await video()).time
  assert.ok(before >= 5.5 && before < 15, `in the intro: ${before}`)
  await skip.click()
  await until(async () => ((await video())?.time ?? 0) >= 14.5, { timeout: 5000, message: 'skipped by the button' })
  await page.keyboard.press('Escape')
  await page.waitForURL((u) => !u.hash.startsWith('#/play'), { timeout: 5000 })
  await page.goto(`${app}/#/settings/playback`)
  await page.getByRole('radiogroup', { name: 'Пропуск' }).getByRole('radio', { name: 'Автоматически' }).click()
})

await step('detector down: the episode still plays, without segments', async () => {
  fake.state.detectorDown = true
  await page.goto(`${app}/#/play/112`)
  await until(async () => ((await video())?.time ?? 0) > 1, { timeout: 15000, message: 'playback without detector' })
  await page.getByRole('button', { name: 'Дорожки и разметка' }).click()
  await page.getByText('В этой серии детектор ничего не нашёл').waitFor()
  await page.keyboard.press('Escape')
  fake.state.detectorDown = false
})

await step('keyboard: Space pauses (paused timeline) and resumes, F toggles fullscreen', async () => {
  await page.keyboard.press('Space')
  await until(async () => (await video())?.paused, { timeout: 3000, message: 'paused' })
  await until(() => pms('/:/timeline', (r) => r.query.ratingKey === '112' && r.query.state === 'paused').length > 0, {
    timeout: 3000,
    message: 'paused timeline',
  })
  await page.keyboard.press('Space')
  await until(async () => (await video())?.paused === false, { timeout: 3000, message: 'playing again' })
  await page.keyboard.press('KeyF')
  await until(() => page.evaluate(() => !!document.fullscreenElement), { timeout: 3000, message: 'fullscreen' })
  await page.keyboard.press('KeyF')
  await until(() => page.evaluate(() => !document.fullscreenElement), { timeout: 3000, message: 'fullscreen off' })
  await page.keyboard.press('Escape')
  await page.waitForURL((u) => !u.hash.startsWith('#/play'), { timeout: 5000 })
})

await step('leaving the player while it still loads starts no media and no transcode', async () => {
  fake.state.detectorDelayMs = 1500
  await page.goto(`${app}/#/play/113`)
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  const left = Date.now()
  await page.waitForURL((u) => !u.hash.startsWith('#/play'), { timeout: 5000 })
  await page.waitForTimeout(2500)
  fake.state.detectorDelayMs = 0
  const late = find((r) => r.server === 'pms' && r.at > left && (r.path.includes('/transcode/universal/') || (r.path.startsWith('/library/parts/') && r.method === 'PUT')))
  const stops = new Set(pms('/video/:/transcode/universal/stop').map((r) => r.query.session))
  const orphans = late.filter((r) => r.path.endsWith('start.m3u8') && !stops.has(r.query.session))
  assert.deepEqual(late.map((r) => `${r.method} ${r.path}`), [], 'nothing started after leaving')
  assert.deepEqual(orphans, [])
  assert.equal(await page.evaluate(() => document.querySelectorAll('video').length), 0)
})

// MARK: Plex list and catalog

await step('home: «Хочу посмотреть» and «Ещё не вышло» from the Plex list', async () => {
  fake.state.resetWatchlist()
  // Plus the server's old-agent movie (no catalog key): it must stay off the shelves too.
  fake.state.watchlist.unshift('cat-film-200')
  // A fresh start: the shelves appear only once this list and its watch state are in.
  await page.goto(`${app}/#/`)
  await page.reload()
  await page.getByRole('heading', { name: 'Хочу посмотреть' }).waitFor({ timeout: 10000 })
  const titles = await page.$$eval('section.shelf .shelf-title', (list) => list.map((h) => h.textContent))
  assert.deepEqual(titles.slice(0, 3), ['Продолжить просмотр', 'Хочу посмотреть', 'Ещё не вышло'])
  // In Plex order; the watched movie, the started show and the server's titles are on neither shelf.
  assert.deepEqual(await shelfCards('Хочу посмотреть'), ['Новый сериал | Сериал · 2025', 'Ещё один новый фильм | Фильм · 2024'])
  for (const title of ['Просмотренный фильм', 'Начатый сериал', 'Тестовый сериал', 'Тестовый фильм'])
    assert.equal(await page.locator('section.shelf .catalog-card').getByText(title, { exact: true }).count(), 0, `${title} on a shelf`)
  // Soonest first: the day before the year-only title.
  assert.deepEqual(await shelfCards('Ещё не вышло'), ['Скоро фильм | 12 марта 2027', 'Будущий сериал | 2028'])
  // The date alone under the poster; the button says the title with it.
  await page.getByRole('button', { name: 'Скоро фильм, 12 марта 2027', exact: true }).waitFor()
  assert.equal(await page.getByText('Мой список').count(), 0)
  const list = discover('/library/sections/watchlist/all').at(-1)
  assert.equal(list.query.includeUserState, undefined, 'the list carries no watch state anyway')
  assert.equal(list.headers['x-plex-language'], 'ru')
  // Watch state of the whole list in one request (the recommendations ask for theirs apart).
  const listStates = `/library/metadata/${fake.state.watchlist.join(',')}/userState`
  assert.ok(discover(listStates).length > 0, 'one request for the list')
  // The account token, in a header, never in a URL; the resizer gets no token at all.
  const api = find((r) => r.server === 'discover' && r.path !== '/photo')
  assert.ok(api.every((r) => r.headers['x-plex-token'] === USER_TOKEN && !r.query['X-Plex-Token']), 'Discover with the account token')
  await page.locator('.catalog-card img.loaded').first().waitFor()
  const photos = discover('/photo')
  assert.ok(photos.length > 0 && photos.every((r) => !r.query['X-Plex-Token'] && r.query.url.startsWith('https://catalog-images.invalid/')))
  await page.screenshot({ path: join(screens, 'home-watchlist.png'), fullPage: true })
})

await step('search: the empty query shows the list, or the hint when it is empty', async () => {
  await page.getByRole('link', { name: 'Поиск' }).click()
  await page.waitForURL(/#\/search$/)
  await page.locator('.search-section h2', { hasText: 'Хочу посмотреть' }).waitFor()
  assert.deepEqual(await sectionCards('Хочу посмотреть'), ['Новый сериал | Сериал · 2025', 'Ещё один новый фильм | Фильм · 2024'])
  assert.deepEqual(await sectionCards('Ещё не вышло'), ['Скоро фильм | 12 марта 2027', 'Будущий сериал | 2028'])
  await page.locator('.search-section').last().locator('img.loaded').last().waitFor()
  await settledShot('search-list')
  fake.state.watchlist = []
  const reloaded = Date.now()
  await page.reload()
  await until(() => discover('/library/sections/watchlist/all', (r) => r.at > reloaded && r.status === 200).length > 0, { message: 'list fetched again' })
  await page.getByRole('heading', { name: 'Найдите фильм или сериал' }).waitFor()
  await page.getByText('Чего нет на сервере, можно добавить в список Plex (он общий с приложениями Plex): оно появится здесь, в «Хочу посмотреть» или «Ещё не вышло».', { exact: false }).waitFor()
  await shot('search-hint')
  fake.state.resetWatchlist()
})

await step('search: the server\'s titles and the catalog\'s apart, each once; typing is debounced', async () => {
  const before = discover('/library/search').length
  await page.getByRole('searchbox', { name: 'Фильмы и сериалы' }).pressSequentially('тест', { delay: 60 })
  await page.locator('.search-section h2', { hasText: 'Нет на сервере' }).waitFor()
  const searches = discover('/library/search').slice(before)
  assert.equal(searches.length, 1, 'one request once typing stops')
  assert.equal(searches[0].query.query, 'тест')
  // Both are the catalog's matches: the show by its plex:// key, the old-agent movie by kind,
  // title and year; neither is repeated under «Нет на сервере»; the person is dropped.
  assert.deepEqual(await sectionCards('На сервере'), ['Тестовый сериал | 2025', 'Тестовый фильм | 2024'])
  assert.deepEqual(await sectionCards('Нет на сервере'), ['Тестовая комедия | Фильм · 2023'])
  assert.match(page.url(), /#\/search\?q=/)
  await page.locator('.search-section .catalog-card img.loaded').first().waitFor()
  await settledShot('search-results')
})

await step('search: a catalog poster\'s bookmark puts it on the Plex list', async () => {
  await page.getByRole('button', { name: 'Добавить «Тестовая комедия» в список' }).click()
  await page.getByRole('button', { name: 'Убрать «Тестовая комедия» из списка' }).waitFor()
  const put = await until(() => discover('/actions/addToWatchlist', (r) => r.query.ratingKey === 'cat-test-1')[0], { message: 'PUT add' })
  assert.equal(put.method, 'PUT')
  assert.equal(put.headers['x-plex-token'], USER_TOKEN)
  assert.equal(fake.state.watchlist[0], 'cat-test-1')
  await page.getByRole('searchbox', { name: 'Фильмы и сериалы' }).fill('')
  await page.locator('.search-section h2', { hasText: 'Хочу посмотреть' }).waitFor()
  assert.equal((await sectionCards('Хочу посмотреть'))[0], 'Тестовая комедия | Фильм · 2023')
})

await step('refused add: the bookmark goes back and «Список Plex» says why', async () => {
  await page.getByRole('searchbox', { name: 'Фильмы и сериалы' }).fill('нов')
  await page.locator('.search-section h2', { hasText: 'Нет на сервере' }).waitFor()
  fake.state.watchlistFail = true
  await page.getByRole('button', { name: 'Добавить «Новый фильм» в список' }).click()
  await listAlert().waitFor()
  assert.equal(await listAlert().locator('p').textContent(), 'Не удалось добавить «Новый фильм» в список. Проверьте подключение к интернету.')
  await settledShot('watchlist-refused')
  await listAlert().getByRole('button', { name: 'OK' }).click()
  await listAlert().waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Добавить «Новый фильм» в список' }).waitFor()
  assert.ok(!fake.state.watchlist.includes('cat-new-1'))
  fake.state.watchlistFail = false
})

await step('catalog page: details from Plex, add and remove', async () => {
  await page.getByRole('button', { name: 'Новый фильм, Фильм · 2026', exact: true }).click()
  await page.waitForURL(/#\/catalog\/cat-new-1$/)
  await page.getByRole('heading', { name: 'Новый фильм' }).waitFor()
  // The summary is only in the details answer (search results come without it).
  await page.getByText('Фильма нет на сервере: его можно добавить в список.').waitFor()
  assert.ok(discover('/library/metadata/cat-new-1').length > 0)
  const meta = (await page.locator('.detail .meta').textContent()) ?? ''
  for (const part of ['Фильм · 2026', '2 ч', '16+', '★ 7.4']) assert.ok(meta.includes(part), `${part} in ${meta}`)
  await page.getByText('Драма · Фантастика').waitFor()
  await page.getByText('На сервере «Фейковый сервер» этого нет. Список общий с приложениями Plex.').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Открыть в библиотеке' }).count(), 0)
  await page.getByRole('button', { name: 'Добавить в список' }).click()
  await page.getByRole('button', { name: 'В списке' }).waitFor()
  await until(() => fake.state.watchlist.includes('cat-new-1'), { message: 'added on the fake' })
  await page.locator('.detail-backdrop img.loaded').waitFor()
  await settledShot('catalog')
  await page.getByRole('button', { name: 'В списке' }).click()
  await page.getByRole('button', { name: 'Добавить в список' }).waitFor()
  await until(() => !fake.state.watchlist.includes('cat-new-1'), { message: 'removed on the fake' })
  assert.equal(discover('/actions/removeFromWatchlist', (r) => r.query.ratingKey === 'cat-new-1').length, 1)
})

await step('catalog page of a title the server has (opened by link): «Открыть в библиотеке»', async () => {
  await page.goto(`${app}/#/catalog/cat-show-10`)
  await page.getByRole('button', { name: 'Открыть в библиотеке' }).waitFor({ timeout: 10000 })
  assert.equal(await page.getByText(/этого нет/).count(), 0)
  await page.getByRole('button', { name: 'Открыть в библиотеке' }).click()
  await page.waitForURL(/#\/show\/100/)
  // The old-agent movie too, by kind, title and year.
  await page.goto(`${app}/#/catalog/cat-film-200`)
  await page.getByRole('button', { name: 'Открыть в библиотеке' }).waitFor({ timeout: 10000 })
  assert.equal(await page.getByText(/этого нет/).count(), 0)
  await page.getByRole('button', { name: 'Открыть в библиотеке' }).click()
  await page.waitForURL(/#\/movie\/200$/)
})

await step('catalog down: the server\'s titles with a note; «Ничего не нашлось» when nothing matches', async () => {
  fake.state.searchFail = true
  const down = 'Каталог Plex сейчас недоступен: показано только то, что есть на сервере.'
  await page.goto(`${app}/#/search?q=${encodeURIComponent('тест')}`)
  await page.getByText(down).waitFor({ timeout: 10000 })
  // Title matches only, in library order (movies first here).
  assert.deepEqual(await sectionCards('На сервере'), ['Тестовый фильм | 2024', 'Тестовый сериал | 2025'])
  assert.equal(await sectionCards('Нет на сервере'), null)
  await page.getByRole('searchbox', { name: 'Фильмы и сериалы' }).fill('ъъъ')
  await page.getByText('Ничего не нашлось').waitFor()
  await page.getByText(down).waitFor()
  await shot('search-catalog-down')
  fake.state.searchFail = false
  await page.getByRole('searchbox', { name: 'Фильмы и сериалы' }).fill('ъъъъ')
  await until(async () => (await page.getByText(down).count()) === 0, { message: 'note gone once the catalog answers' })
  await page.getByText('Ничего не нашлось').waitFor()
})

await step('home: removing from a card; a refused removal comes back', async () => {
  fake.state.resetWatchlist()
  await page.goto(`${app}/#/`)
  await page.getByRole('heading', { name: 'Хочу посмотреть' }).waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: 'Убрать «Ещё один новый фильм» из списка' }).click()
  await until(async () => (await shelfCards('Хочу посмотреть'))?.length === 1, { message: 'card removed' })
  await until(() => !fake.state.watchlist.includes('cat-new-3'), { message: 'removed on the fake' })
  fake.state.watchlistFail = true
  await page.getByRole('button', { name: 'Убрать «Новый сериал» из списка' }).click()
  await listAlert().waitFor()
  assert.equal(await listAlert().locator('p').textContent(), 'Не удалось убрать «Новый сериал» из списка. Проверьте подключение к интернету.')
  await settledShot('home-refused')
  await page.keyboard.press('Escape')
  await listAlert().waitFor({ state: 'detached' })
  assert.deepEqual(await shelfCards('Хочу посмотреть'), ['Новый сериал | Сериал · 2025'])
  assert.ok(fake.state.watchlist.includes('cat-new-2'))
  fake.state.resetWatchlist()
})

await step('settings «Главная»: «Ещё не вышло» off is gone from Home, the empty search keeps it', async () => {
  fake.state.resetWatchlist()
  const hidden = () => page.evaluate(() => JSON.parse(localStorage.getItem('settings') ?? '{}').hiddenShelves)
  await page.goto(`${app}/#/settings`)
  await settingsPages().filter({ hasText: 'Главная' }).click()
  await page.waitForURL(/#\/settings\/home$/)
  const wanted = page.getByRole('switch', { name: 'Хочу посмотреть' })
  const upcoming = page.getByRole('switch', { name: 'Ещё не вышло' })
  assert.ok((await wanted.isChecked()) && (await upcoming.isChecked()), 'both on by default')
  await page.getByText('Из списка Plex: вышло, но нет на сервере и ещё не просмотрено.').waitFor()
  await page.getByText('Из списка Plex: ещё не вышло, ближайшее первым.').waitFor()
  await page.getByText('В пустом поиске список Plex виден всегда.', { exact: false }).waitFor()
  await settledShot('settings-home')
  await page.locator('label.toggle', { hasText: 'Ещё не вышло' }).click()
  await until(async () => !(await upcoming.isChecked()), { message: 'switched off' })
  assert.deepEqual(await hidden(), ['upcoming'])
  // A fresh Home: the list is in, «Ещё не вышло» is not shown.
  await page.goto(`${app}/#/`)
  await page.reload()
  await page.getByRole('heading', { name: 'Хочу посмотреть' }).waitFor({ timeout: 10000 })
  const homeShelves = await page.$$eval('section.shelf .shelf-title', (list) => list.map((h) => h.textContent))
  assert.ok(!homeShelves.includes('Ещё не вышло'), `home shelves: ${homeShelves}`)
  await page.goto(`${app}/#/search`)
  await page.locator('.search-section h2', { hasText: 'Ещё не вышло' }).waitFor({ timeout: 10000 })
  assert.deepEqual(await sectionCards('Ещё не вышло'), ['Скоро фильм | 12 марта 2027', 'Будущий сериал | 2028'])
  // Back on, so nothing after this depends on it.
  await page.goto(`${app}/#/settings/home`)
  await page.locator('label.toggle', { hasText: 'Ещё не вышло' }).click()
  await until(async () => (await hidden()).length === 0, { message: 'switched back on' })
  await page.goto(`${app}/#/`)
  await page.getByRole('heading', { name: 'Ещё не вышло' }).waitFor({ timeout: 10000 })
})

const homeTitles = () => page.$$eval('section.shelf .shelf-title', (list) => list.map((h) => h.textContent))

await step('home: TMDB recommendations through the detector, «Ещё с актёрами», cached catalog matches', async () => {
  fake.state.resetWatchlist()
  const started = Date.now()
  await page.goto(`${app}/#/`)
  await page.reload()
  await page.getByRole('heading', { name: 'Похожее на сервере' }).waitFor({ timeout: 15000 })
  await page.getByRole('heading', { name: 'Ещё с актёрами «Тестовый сериал»' }).waitFor({ timeout: 10000 })
  // Seeds: the owner's last plays on the server (the show, then the movie), each once.
  const history = pms('/status/sessions/history/all', (r) => r.at > started)
  assert.ok(history.length > 0 && history.every((r) => r.query.accountID === '1' && r.query.sort === 'viewedAt:desc'), 'owner history')
  const asked = find((r) => r.server === 'detector' && r.path === '/v1/recommendations' && r.at > started)
  assert.equal(asked[0]?.query.seeds, 'tv:1100,movie:1200')
  assert.equal(asked[0]?.query.language, 'ru-RU')
  assert.equal(asked[0]?.headers['x-plex-token'], SERVER_TOKEN)
  // The server's unplayed movie; seeds and begun titles are not recommended.
  assert.deepEqual(await shelfCards('Похожее на сервере'), ['Неначатый фильм | 2022'])
  // TMDB's (Russian) title, not the catalog's English one; the watched movie and the one Plex lacks are dropped.
  assert.deepEqual(await shelfCards('Потому что вы смотрели «Тестовый сериал»'), ['Новый фильм | Фильм · 2026'])
  assert.deepEqual(await shelfCards('Потому что вы смотрели «Тестовый фильм»'), ['Тестовая комедия | Фильм · 2023'])
  // Plex's cast list of the show: without the show, the server's movie and the watched one.
  assert.deepEqual(await shelfCards('Ещё с актёрами «Тестовый сериал»'), ['Фильм с теми же актёрами | Фильм · 2022', 'Сериал с теми же актёрами | Сериал · 2020'])
  const titles = await homeTitles()
  assert.deepEqual(titles.slice(-4), ['Похожее на сервере', 'Потому что вы смотрели «Тестовый сериал»', 'Потому что вы смотрели «Тестовый фильм»', 'Ещё с актёрами «Тестовый сериал»'])
  // What the server has is never asked; the rest once (on the first visit of Home), then from storage.
  const matches = discover('/library/metadata/matches').map((r) => `${r.query.type} ${r.query.guid}`).sort()
  assert.deepEqual(matches, ['1 tmdb://5001', '1 tmdb://5003', '1 tmdb://5004', '1 tmdb://5009'])
  await page.locator('section.shelf').last().scrollIntoViewIfNeeded()
  await page.locator('section.shelf').last().locator('img.loaded').first().waitFor()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(screens, 'home-recommendations.png'), fullPage: true })
  const reloaded = Date.now()
  await page.reload()
  await page.getByRole('heading', { name: 'Потому что вы смотрели «Тестовый фильм»' }).waitFor({ timeout: 15000 })
  assert.equal(discover('/library/metadata/matches', (r) => r.at > reloaded).length, 0, 'matches come from storage')
  // A catalog recommendation opens its catalog page.
  await page.getByRole('button', { name: 'Тестовая комедия, Фильм · 2023', exact: true }).click()
  await page.waitForURL(/#\/catalog\/cat-test-1$/)
})

await step('settings «Главная и Обзор»: every shelf off and on, moved, default order back; no TMDB key', async () => {
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('settings') ?? '{}'))
  await page.goto(`${app}/#/settings/home`)
  await page.getByRole('heading', { name: 'Полки Главной' }).waitFor()
  const rows = () => page.$$eval('.shelf-setting [role=switch]', (list) => list.map((s) => s.getAttribute('aria-label')))
  assert.deepEqual(await rows(), [
    'Продолжить просмотр',
    'Хочу посмотреть',
    'Ещё не вышло',
    'Недавно добавлено · Фильмы',
    'Недавно добавлено · Сериалы',
    'Похожее на сервере',
    'Потому что вы смотрели…',
    'Ещё с этими актёрами',
  ])
  const reset = page.getByRole('button', { name: 'Вернуть порядок по умолчанию' })
  assert.ok(await reset.isDisabled(), 'nothing to reset yet')
  assert.ok(await page.getByRole('button', { name: '«Продолжить просмотр» выше' }).isDisabled())
  // «Похожее на сервере» to the top, «Продолжить просмотр» off.
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '«Похожее на сервере» выше' }).click()
  await page.locator('label.toggle', { hasText: 'Продолжить просмотр' }).click()
  await until(async () => (await rows())[0] === 'Похожее на сервере', { message: 'moved to the top' })
  assert.deepEqual((await stored()).shelfOrder.slice(0, 2), ['similarOnServer', 'continue'])
  assert.deepEqual((await stored()).hiddenShelves, ['continue'])
  await settledShot('settings-home-order')
  await page.goto(`${app}/#/`)
  await page.getByRole('heading', { name: 'Похожее на сервере' }).waitFor({ timeout: 10000 })
  let titles = await homeTitles()
  assert.equal(titles[0], 'Похожее на сервере')
  assert.ok(!titles.includes('Продолжить просмотр'), `home: ${titles}`)
  // Everything off: a hint, and nothing is asked of TMDB.
  await page.goto(`${app}/#/settings/home`)
  for (const name of await rows()) {
    const toggle = page.getByRole('switch', { name, exact: true })
    if (await toggle.isChecked()) await page.locator('label.toggle', { has: toggle }).click()
  }
  await until(async () => (await stored()).hiddenShelves.length === 8, { message: 'all off' })
  const off = Date.now()
  await page.goto(`${app}/#/`)
  await page.reload()
  await page.getByText('Все полки выключены. Включите нужные в Настройки → Главная и Обзор.').waitFor()
  await settledShot('home-all-off')
  assert.equal(find((r) => r.server === 'detector' && r.path === '/v1/recommendations' && r.at > off).length, 0, 'TMDB not asked')
  // Back: all on, the default order.
  await page.goto(`${app}/#/settings/home`)
  for (const name of await rows()) await page.locator('label.toggle', { has: page.getByRole('switch', { name, exact: true }) }).click()
  await until(async () => (await stored()).hiddenShelves.length === 0, { message: 'all on' })
  await reset.click()
  await until(async () => (await stored()).shelfOrder.length === 0, { message: 'order reset' })
  assert.equal((await rows())[0], 'Продолжить просмотр')
  assert.ok(await reset.isDisabled())
  // A detector without a TMDB key: no TMDB shelves, settings say why.
  fake.state.tmdbMissing = true
  await page.goto(`${app}/#/`)
  await page.reload()
  await page.getByRole('heading', { name: 'Ещё с актёрами «Тестовый сериал»' }).waitFor({ timeout: 15000 })
  titles = await homeTitles()
  assert.ok(!titles.includes('Похожее на сервере') && !titles.some((t) => t.startsWith('Потому что')), `home: ${titles}`)
  await page.getByRole('link', { name: 'Настройки' }).click()
  await settingsPages().filter({ hasText: 'Главная и Обзор' }).click()
  await page.getByText('Детектор ответил, что ключа TMDB на нём нет', { exact: false }).waitFor()
  await settledShot('settings-home-no-tmdb')
  fake.state.tmdbMissing = false
})

await step('«Обзор»: Plex collections, a new season stands for its show; each can be turned off', async () => {
  const nav = () => page.getByRole('navigation').getByRole('link', { name: 'Обзор' })
  await page.goto(`${app}/#/`)
  await nav().click()
  await page.waitForURL(/#\/explore$/)
  await page.getByRole('heading', { name: 'Популярное в Plex' }).waitFor({ timeout: 10000 })
  assert.deepEqual(await homeTitles(), ['Популярное в Plex', 'Чаще всего добавляют в список', 'Скоро выйдет', 'Самые ожидаемые фильмы'])
  assert.deepEqual(await shelfCards('Популярное в Plex'), ['Новый фильм | Фильм · 2026', 'Тестовая комедия | Фильм · 2023', 'Тестовый сериал | Сериал · 2025'])
  assert.deepEqual(await shelfCards('Скоро выйдет'), ['Тестовый сериал | Сезон 2 · 15 января 2027', 'Скоро фильм | 12 марта 2027'])
  for (const hub of ['trending-plex', 'top_watchlisted', 'coming-soon', 'highly-anticipated-movies']) assert.ok(discover(`/hubs/sections/home/${hub}`).length > 0, hub)
  await page.locator('section.shelf').nth(2).locator('img.loaded').first().waitFor()
  await settledShot('explore')
  // The new season of a show the server has opens the server's show.
  await page.getByRole('button', { name: /^Тестовый сериал, Сезон 2/ }).click()
  await page.waitForURL(/#\/show\/100/)
  // Turned off one by one: gone from the page, then the page and its link are gone.
  await page.goto(`${app}/#/settings/home`)
  await page.locator('label.toggle', { hasText: 'Популярное в Plex' }).click()
  await page.goto(`${app}/#/explore`)
  await page.getByRole('heading', { name: 'Скоро выйдет' }).waitFor()
  assert.ok(!(await homeTitles()).includes('Популярное в Plex'))
  await page.goto(`${app}/#/settings/home`)
  for (const title of ['Чаще всего добавляют в список', 'Скоро выйдет', 'Самые ожидаемые фильмы']) await page.locator('label.toggle', { hasText: title }).click()
  await until(async () => (await nav().count()) === 0, { message: 'Обзор link gone' })
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('settings') ?? '{}').hiddenHubs), [
    'trending-plex',
    'top_watchlisted',
    'coming-soon',
    'highly-anticipated-movies',
  ])
  for (const title of ['Популярное в Plex', 'Чаще всего добавляют в список', 'Скоро выйдет', 'Самые ожидаемые фильмы']) await page.locator('label.toggle', { hasText: title }).click()
  await nav().waitFor()
})

await step('phone layout: no horizontal scrolling on home, show and player', async () => {
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    storageState: await context.storageState(),
  })
  recordHosts(phone)
  const p = await phone.newPage()
  p.on('pageerror', (e) => pageErrors.push(`phone: ${e}`))
  const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  await p.goto(`${app}/#/`)
  await p.getByRole('heading', { name: 'Продолжить просмотр' }).waitFor({ timeout: 15000 })
  await p.locator('.img img.loaded').first().waitFor()
  assert.ok((await overflow()) <= 0, `home overflows by ${await overflow()} px`)
  await p.screenshot({ path: join(screens, 'phone-home.png') })
  await p.getByRole('heading', { name: 'Ещё не вышло' }).waitFor()
  assert.ok((await overflow()) <= 0, `home with the list overflows by ${await overflow()} px`)
  await p.screenshot({ path: join(screens, 'phone-home-full.png'), fullPage: true })
  await p.goto(`${app}/#/search?q=${encodeURIComponent('тест')}`)
  await p.locator('.search-section h2', { hasText: 'Нет на сервере' }).waitFor({ timeout: 10000 })
  await p.locator('.catalog-card img.loaded').first().waitFor()
  assert.ok((await overflow()) <= 0, `search overflows by ${await overflow()} px`)
  await p.screenshot({ path: join(screens, 'phone-search.png'), fullPage: true })
  await p.goto(`${app}/#/search`)
  await p.locator('.search-section h2', { hasText: 'Ещё не вышло' }).waitFor({ timeout: 10000 })
  await p.locator('.search-section').last().locator('img.loaded').last().waitFor()
  await p.waitForTimeout(400)
  assert.ok((await overflow()) <= 0, `search list overflows by ${await overflow()} px`)
  await p.screenshot({ path: join(screens, 'phone-search-list.png'), fullPage: true })
  await p.goto(`${app}/#/catalog/cat-new-1`)
  await p.getByText('Фильма нет на сервере: его можно добавить в список.').waitFor({ timeout: 10000 })
  assert.ok((await overflow()) <= 0, `catalog page overflows by ${await overflow()} px`)
  await p.screenshot({ path: join(screens, 'phone-catalog.png'), fullPage: true })
  await p.goto(`${app}/#/show/100`)
  await p.locator('.landscape-card.selected').waitFor()
  assert.ok((await overflow()) <= 0, `show overflows by ${await overflow()} px`)
  await p.screenshot({ path: join(screens, 'phone-show.png'), fullPage: true })
  await p.goto(`${app}/#/explore`)
  await p.getByRole('heading', { name: 'Скоро выйдет' }).waitFor({ timeout: 10000 })
  await p.locator('section.shelf img.loaded').first().waitFor()
  assert.ok((await overflow()) <= 0, `explore overflows by ${await overflow()} px`)
  await p.screenshot({ path: join(screens, 'phone-explore.png'), fullPage: true })
  await p.goto(`${app}/#/play/112`)
  await p.locator('.scrub').waitFor()
  await p.waitForTimeout(1500)
  await p.screenshot({ path: join(screens, 'phone-player.png') })
  await p.goto(`${app}/#/settings`)
  await p.getByRole('navigation', { name: 'Разделы настроек' }).waitFor({ timeout: 8000 })
  assert.ok((await overflow()) <= 0, `settings overflow by ${await overflow()} px`)
  await p.screenshot({ path: join(screens, 'phone-settings.png'), fullPage: true })
  for (const id of ['playback', 'home', 'detector', 'server']) {
    await p.goto(`${app}/#/settings/${id}`)
    await p.getByRole('button', { name: 'Настройки' }).waitFor({ timeout: 8000 })
    if (id === 'detector') await p.getByText('Детектор отвечает').waitFor({ timeout: 8000 })
    assert.ok((await overflow()) <= 0, `settings/${id} overflows by ${await overflow()} px`)
    await p.screenshot({ path: join(screens, `phone-settings-${id}.png`), fullPage: true })
  }
  await phone.close()
})

await step('the browser asked only the fakes (plus the never-answering fake plex.direct)', async () => {
  const outside = [...requestedHosts].filter((h) => !h.startsWith('127.0.0.1:') && !h.endsWith('.fake.plex.direct:32400'))
  assert.deepEqual(outside, [])
})

await step('no uncaught errors in the page', async () => {
  assert.deepEqual(pageErrors, [])
})

const failures = fake.requests.filter((r) => r.status >= 400 && !(r.server === 'detector' && fake.state.detectorDown))
if (failures.length) console.log(`non-2xx responses:\n  ${failures.map((r) => `${r.status} ${r.server} ${r.method} ${r.path}`).join('\n  ')}`)
if (consoleErrors.length) console.log(`console errors (${consoleErrors.length}):\n  ${[...new Set(consoleErrors)].slice(0, 10).join('\n  ')}`)
console.log(`requests: ${fake.requests.length}, screenshots: ${screens}`)
await browser.close()
await fake.close()
process.exit(failed ? 1 : 0)
