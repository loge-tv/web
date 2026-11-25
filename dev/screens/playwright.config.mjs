// The screens of Loge Web that the site shows: `npm run screens` (see CLAUDE.md, «Screens on the site»).
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'screens.spec.mjs',
  globalSetup: './global-setup.mjs',
  outputDir: '../.out/screens-results',
  snapshotPathTemplate: '{testDir}/baseline/{arg}{ext}',
  // One fake on fixed ports, one browser: the tests share it and run in order.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 0 },
  },
  use: {
    launchOptions: {
      executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--hide-scrollbars'],
    },
    headless: !process.env.HEADED,
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  },
})
