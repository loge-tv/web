// Snapshot tests of the screens of Loge Web that the site shows (loge-tv/landing,
// assets/shots/web/<screen>.jpg). They run the fake build of this checkout against the landing
// rig's fake.mjs (the Blender library the site's screenshots are shot on) and compare each screen
// with dev/screens/baseline/<screen>.png. A red test here means the site shows an old screen:
// update the baseline (`npm run screens:update`) and reshoot the screen for the site (CLAUDE.md).
//
// The screens are the site's states, made deterministic: the player is paused at a fixed position
// and its picture is hidden (hide-video.css); the trailer plays the fake's stand-in for the
// YouTube embed (never youtube.com); every request goes to the fakes on 127.0.0.1. TMDB (trailers,
// recommendations, titles) comes from this checkout's fake proxy (dev/fake-tmdb.mjs) with the rig's
// data: the rig's fake has TMDB on its Loge Server only.
import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startFakeTMDB } from '../fake-tmdb.mjs'
import { APP_DIR, FAKE, RIG } from './paths.mjs'

const HIDE_VIDEO = fileURLToPath(new URL('./hide-video.css', import.meta.url))

test.skip(!existsSync(FAKE), `needs the landing rig's fake.mjs at ${RIG} (or LOGE_SHOTS_RIG=<shots-raw/harness>)`)
// One worker runs them in this order (playwright.config.mjs); a failed screen doesn't stop the others.

let fake
let tmdb
let app
test.beforeAll(async () => {
  const { startFake, TMDB_VIDEOS, TMDB_RECOMMENDATIONS } = await import(pathToFileURL(FAKE).href)
  fake = await startFake({ appDir: APP_DIR })
  // The Blender films keep their English names (the site's approved state): no Russian ones.
  tmdb = await startFakeTMDB({ videos: TMDB_VIDEOS, recommendations: TMDB_RECOMMENDATIONS })
  app = fake.urls.app
})
test.afterAll(async () => {
  await tmdb?.close()
  await fake?.close()
})

// Every page of a test asks only the fakes.
let hosts
test.beforeEach(async ({ page }) => {
  hosts = new Set()
  page.on('request', (r) => {
    const url = new URL(r.url())
    if (url.protocol.startsWith('http')) hosts.add(url.host)
  })
})
test.afterEach(() => {
  expect([...hosts].filter((h) => !h.startsWith('127.0.0.1:'))).toEqual([])
})

const signIn = async (page) => {
  await page.goto(`${app}/`)
  await page.getByRole('button', { name: 'Войти через Plex' }).click()
  await page.getByRole('heading', { name: 'Продолжить просмотр' }).waitFor({ timeout: 30_000 })
}
// The app reads its settings once, at load: a reload takes in what this writes.
const settings = (page, value) =>
  page.evaluate((v) => localStorage.setItem('settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('settings') ?? '{}'), ...v })), value)
const imagesLoaded = (page, scope) =>
  page.waitForFunction(
    (sel) => [...document.querySelectorAll(sel)].filter((i) => i.getBoundingClientRect().top < innerHeight && i.getBoundingClientRect().bottom > 0).every((i) => i.complete && i.naturalWidth > 0),
    scope,
    { timeout: 15_000 },
  )
// Away from everything that reacts to a hover.
const pointerAway = (page) => page.mouse.move(1599, 400)

const playFresh = async (page, key) => {
  await page.goto(`${app}/#/movie/900`)
  await page.reload()
  await page.getByRole('heading', { name: 'Sintel' }).waitFor({ timeout: 15_000 })
  await page.goto(`${app}/#/play/${key}`)
  await page.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0.2, null, { timeout: 20_000 })
}
/**
 * Plays from `from` up to `at`, pauses and puts the position exactly at `at` (the pause lands a
 * little later): a countdown follows the position, so its number, the time and the bar stop there.
 */
const playUpToAndPause = async (page, from, at) => {
  await page.evaluate((t) => { document.querySelector('video').currentTime = t }, from)
  await page.waitForFunction((t) => (document.querySelector('video')?.currentTime ?? 0) >= t, at, { timeout: 15_000 })
  await page.evaluate((t) => { const v = document.querySelector('video'); v.pause(); v.currentTime = t }, at)
  await page.waitForFunction((t) => { const v = document.querySelector('video'); return v.paused && !v.seeking && v.currentTime === t && v.readyState >= 2 }, at)
}

test('home', async ({ page }) => {
  await signIn(page)
  await page.locator('.shelf-title', { hasText: 'Потому что вы смотрели' }).waitFor({ timeout: 15_000 })
  await imagesLoaded(page, 'section.shelf img')
  await pointerAway(page)
  await expect(page).toHaveScreenshot('home.png')
})

test('recs', async ({ page }) => {
  // Home with the TMDB shelves at the top, as the site shows it.
  await signIn(page)
  await settings(page, { shelfOrder: ['because', 'similarOnServer', 'continue', 'wanted', 'upcoming', 'recent:1', 'recent:2', 'moreWithCast'] })
  await page.reload()
  await page.locator('.shelf-title', { hasText: 'Похожее на сервере' }).waitFor({ timeout: 15_000 })
  await imagesLoaded(page, 'section.shelf img')
  await pointerAway(page)
  await expect(page).toHaveScreenshot('recs.png')
})

test('show', async ({ page }) => {
  // Sprite Fright as a show of three episodes.
  await signIn(page)
  await page.goto(`${app}/#/show/20`)
  await page.getByRole('heading', { name: 'Sprite Fright' }).first().waitFor({ timeout: 15_000 })
  await page.getByText('Нет на сервере').first().waitFor({ timeout: 15_000 })
  await imagesLoaded(page, 'img')
  await pointerAway(page)
  await expect(page).toHaveScreenshot('show.png')
})

test('trailer', async ({ page }) => {
  // The Sintel page with the «Трейлер» dialog; the embed is the fake's stand-in for YouTube.
  await signIn(page)
  await page.goto(`${app}/#/movie/900`)
  await page.getByRole('heading', { name: 'Sintel' }).waitFor({ timeout: 15_000 })
  await imagesLoaded(page, 'img')
  await page.getByRole('button', { name: 'Трейлер' }).click()
  await expect(page.frameLocator('.trailer-frame iframe').locator('body')).toContainText('HOfdboHvshg')
  await pointerAway(page)
  await expect(page).toHaveScreenshot('trailer.png')
})

test('playback', async ({ page }) => {
  // Sintel at «Чешуйчик?» (10:22) with Russian subtitles, the bar shown under the pointer.
  await signIn(page)
  await settings(page, { skipMode: 'off' })
  await playFresh(page, '900')
  await page.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 622.8; v.pause() })
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v.paused && Math.abs(v.currentTime - 622.8) < 0.3 && v.readyState >= 2 }, null, { timeout: 15_000 })
  await page.mouse.move(800, 500)
  await page.getByRole('button', { name: 'Дорожки и разметка' }).click()
  const russian = page.locator('.tracks-panel').getByRole('button', { name: /Русский/ })
  if (!(await russian.locator('svg').count())) await russian.click()
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await expect(page.locator('.subtitle-text')).toHaveText('Чешуйчик?')
  await expect(page.locator('body')).toContainText('10:22 / 14:48')
  await page.mouse.move(900, 963)
  await expect(page.getByRole('button', { name: 'Дорожки и разметка' })).toBeVisible()
  await expect(page).toHaveScreenshot('playback.png', { stylePath: HIDE_VIDEO })
})

test('intro', async ({ page }) => {
  // Caminandes: Gran Dillama with an intro at 1:28–1:38, the countdown before it is skipped.
  const segments = fake.segments['100']
  fake.segments['100'] = [{ type: 'intro', start: 88, end: 98 }, { type: 'credits', start: 119.5, end: 146 }]
  try {
    await signIn(page)
    await settings(page, { skipMode: 'countdown', autoplayNext: true, nextEpisodeCountdown: 10 })
    await playFresh(page, '100')
    await pointerAway(page)
    await playUpToAndPause(page, 87.2, 90)
    await expect(page.locator('.skip-countdown .countdown-title')).toHaveText(/^Пропуск заставки через \d$/)
    await expect(page).toHaveScreenshot('intro.png', { stylePath: HIDE_VIDEO })
  } finally {
    if (segments) fake.segments['100'] = segments
    else delete fake.segments['100']
  }
})

test('skip', async ({ page }) => {
  // The end credits of Llamigos (played as Gran Dillama) with the «Следующая серия» card.
  const segments = fake.segments['100']
  const gran = fake.state.library.episodes.find((e) => e.ratingKey === '100')
  const length = gran.duration
  const setLength = (ms) => {
    gran.duration = ms
    for (const m of gran.Media) {
      m.duration = ms
      for (const part of m.Part ?? []) part.duration = ms
    }
  }
  fake.state.videoFor['100'] = '101'
  setLength(150_000)
  fake.segments['100'] = [{ type: 'credits', start: 136, end: 150 }]
  try {
    await signIn(page)
    await settings(page, { skipMode: 'auto', autoplayNext: true, nextEpisodeCountdown: 10 })
    await playFresh(page, '100')
    // A button pressed with the mouse first: after a bare reload the browser draws a focus ring
    // on the «Смотреть» the card focuses.
    await page.mouse.move(800, 500)
    await page.getByRole('button', { name: 'Дорожки и разметка' }).click()
    await page.getByRole('button', { name: 'Закрыть' }).click()
    await pointerAway(page)
    await playUpToAndPause(page, 142.6, 145.5)
    await expect(page.locator('.next-label')).toHaveText(/^Следующая серия через \d$/)
    await expect(page.locator('.next-card')).toContainText('Llamigos')
    await imagesLoaded(page, '.next-card img')
    await expect(page).toHaveScreenshot('skip.png', { stylePath: HIDE_VIDEO })
  } finally {
    delete fake.state.videoFor['100']
    setLength(length)
    if (segments) fake.segments['100'] = segments
    else delete fake.segments['100']
  }
})
