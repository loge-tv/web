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
  // In progress by last viewed (episode 3, then the movie), then next up by when the show was
  // last watched (the test show, then two others that Plex listed first).
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

await step('movie: resume dialog, mark watched, library filters', async () => {
  await page.goto(`${app}/#/`)
  const movieCard = page.locator('section.shelf').first().locator('.card').nth(1)
  await movieCard.hover()
  await movieCard.locator('.play-overlay').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Продолжить с 0:30' }).waitFor()
  await shot('resume-dialog')
  await page.getByRole('dialog').getByRole('button', { name: 'Отмена' }).click()
  await page.getByRole('navigation').getByRole('link', { name: 'Фильмы' }).click()
  await page.waitForURL(/#\/library\/1/)
  await page.getByRole('tab', { name: 'Непросмотренные' }).click()
  assert.equal(await page.locator('.poster-grid .card').count(), 1)
  await page.locator('.poster-grid .card button.card-art').first().click({ position: { x: 20, y: 20 } })
  await page.waitForURL(/#\/movie\/200/)
  await page.getByRole('button', { name: /Продолжить с 0:30/ }).waitFor()
  await shot('movie')
  await page.getByRole('button', { name: 'Просмотрено' }).click()
  await page.getByRole('button', { name: 'Не просмотрено' }).waitFor()
  assert.ok(pms('/:/scrobble', (r) => r.query.key === '200').length === 1)
  await page.goBack()
  await page.getByRole('tab', { name: 'Непросмотренные' }).click()
  await page.getByText('Здесь пока ничего нет.').waitFor()
  await page.getByRole('tab', { name: 'Все' }).click()
  assert.equal(await page.locator('.poster-grid .card').count(), 1)
})

await step('settings: detector reachable, skip mode switch persists', async () => {
  await page.getByRole('link', { name: 'Настройки' }).click()
  await page.getByText('Детектор отвечает').waitFor({ timeout: 8000 })
  await page.getByRole('radio', { name: 'Кнопкой' }).click().catch(async () => {
    // Title of the button mode may differ; pick the third option.
    await page.locator('[role=radiogroup]').first().locator('[role=radio]').nth(2).click()
  })
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('settings') ?? '{}'))
  assert.notEqual(stored.skipMode, 'auto')
  await shot('settings')
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
  await page.goto(`${app}/#/settings`)
  await page.getByRole('radiogroup', { name: 'Пропуск' }).getByRole('radio', { name: 'Автоматически' }).click()
})

await step('detector down: the episode still plays, without segments', async () => {
  fake.state.detectorDown = true
  await page.goto(`${app}/#/play/112`)
  await until(async () => ((await video())?.time ?? 0) > 1, { timeout: 15000, message: 'playback without detector' })
  await page.getByRole('button', { name: 'Дорожки и разметка' }).click()
  // The fakes have no chapters and no Guid, so TheIntroDB is never asked.
  await page.getByText('Loge Server недоступен, а в главах файла и TheIntroDB разметки нет').waitFor()
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
  // A fresh page: the app remembers for 5 minutes that the detector was down and wouldn't ask it.
  await page.goto(`${app}/#/`)
  await page.reload()
  await page.getByRole('heading', { name: 'Продолжить просмотр' }).waitFor({ timeout: 15000 })
  // The video starts as soon as the item is known (segments come later): hold the item back.
  fake.state.metadataDelayMs = 1500
  await page.goto(`${app}/#/play/113`)
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  const left = Date.now()
  await page.waitForURL((u) => !u.hash.startsWith('#/play'), { timeout: 5000 })
  await page.waitForTimeout(2500)
  fake.state.metadataDelayMs = 0
  const late = find((r) => r.server === 'pms' && r.at > left && (r.path.includes('/transcode/universal/') || (r.path.startsWith('/library/parts/') && r.method === 'PUT')))
  const stops = new Set(pms('/video/:/transcode/universal/stop').map((r) => r.query.session))
  const orphans = late.filter((r) => r.path.endsWith('start.m3u8') && !stops.has(r.query.session))
  assert.deepEqual(late.map((r) => `${r.method} ${r.path}`), [], 'nothing started after leaving')
  assert.deepEqual(orphans, [])
  assert.equal(await page.evaluate(() => document.querySelectorAll('video').length), 0)
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
  const p = await phone.newPage()
  p.on('pageerror', (e) => pageErrors.push(`phone: ${e}`))
  const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  await p.goto(`${app}/#/`)
  await p.getByRole('heading', { name: 'Продолжить просмотр' }).waitFor({ timeout: 15000 })
  await p.locator('.img img.loaded').first().waitFor()
  assert.ok((await overflow()) <= 0, `home overflows by ${await overflow()} px`)
  await p.screenshot({ path: join(screens, 'phone-home.png') })
  await p.goto(`${app}/#/show/100`)
  await p.locator('.landscape-card.selected').waitFor()
  assert.ok((await overflow()) <= 0, `show overflows by ${await overflow()} px`)
  await p.screenshot({ path: join(screens, 'phone-show.png'), fullPage: true })
  await p.goto(`${app}/#/play/112`)
  await p.locator('.scrub').waitFor()
  await p.waitForTimeout(1500)
  await p.screenshot({ path: join(screens, 'phone-player.png') })
  await p.goto(`${app}/#/settings`)
  await p.getByText('Детектор отвечает').waitFor({ timeout: 8000 })
  assert.ok((await overflow()) <= 0, `settings overflow by ${await overflow()} px`)
  await p.screenshot({ path: join(screens, 'phone-settings.png'), fullPage: true })
  await phone.close()
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
