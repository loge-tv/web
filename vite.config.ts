/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * `--mode fake`: plex.tv, the sign-in page, Plex's catalog with its image resizer and the
 * detector are the fakes of dev/fake-server.mjs (never the real Plex). Environment variables
 * still win.
 */
const fakeEnv: Record<string, string> = {
  VITE_PLEX_TV_URL: `http://127.0.0.1:${process.env.FAKE_PLEXTV_PORT ?? 5181}`,
  VITE_PLEX_AUTH_URL: `http://127.0.0.1:${process.env.FAKE_PLEXTV_PORT ?? 5181}/auth`,
  VITE_DETECTOR_URL: `http://127.0.0.1:${process.env.FAKE_DETECTOR_PORT ?? 5183}`,
  VITE_PLEX_DISCOVER_URL: `http://127.0.0.1:${process.env.FAKE_DISCOVER_PORT ?? 5184}`,
  VITE_PLEX_IMAGES_URL: `http://127.0.0.1:${process.env.FAKE_DISCOVER_PORT ?? 5184}`,
  // The TMDB proxy: a fake one (dev/fake-tmdb.mjs) with its token.
  VITE_TMDB_PROXY_URL: `http://127.0.0.1:${process.env.FAKE_TMDB_PORT ?? 5185}`,
  VITE_TMDB_PROXY_TOKEN: 'fake-client-token',
  // Trailers play in a fake YouTube embed page on the fake detector.
  VITE_YOUTUBE_URL: `http://127.0.0.1:${process.env.FAKE_DETECTOR_PORT ?? 5183}`,
  // Segments without Loge Server: a fake TheIntroDB on the fake detector, knowing nothing.
  VITE_THEINTRODB_URL: `http://127.0.0.1:${process.env.FAKE_DETECTOR_PORT ?? 5183}/theintrodb/v4`,
  // The fake catalog's release dates are fixed; so is its «today».
  VITE_TODAY: '2026-11-22',
}

// Relative base + HashRouter: the build works from any static host and any sub-path.
export default defineConfig(({ mode }) => {
  if (mode === 'fake') {
    for (const [key, value] of Object.entries(fakeEnv)) process.env[key] ??= value
  }
  return {
    base: './',
    plugins: [react()],
    build: {
      target: 'es2020',
      sourcemap: true,
      // hls.js alone is ~600 kB; it is loaded only when a transcode starts.
      chunkSizeWarningLimit: 700,
    },
    server: {
      host: true,
    },
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'node',
    },
  }
})
