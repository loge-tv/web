// Builds this checkout for the screen tests: the fake mode, and the trailer's embed forced onto the
// fake detector (vite.config lets the environment win, so a VITE_YOUTUBE_URL in the shell would
// otherwise send the trailer to youtube.com).
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { APP_DIR, DETECTOR, FAKE, REPO } from './paths.mjs'

export default function globalSetup() {
  if (!existsSync(FAKE) || process.env.SKIP_BUILD) return
  const build = spawnSync('npx', ['vite', 'build', '--mode', 'fake', '--outDir', APP_DIR, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: REPO,
    stdio: 'inherit',
    env: { ...process.env, VITE_YOUTUBE_URL: DETECTOR },
  })
  if (build.status !== 0) throw new Error(`the fake build failed (${build.status})`)
}
