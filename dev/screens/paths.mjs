// Where the screen tests find the landing rig and put the build they test.
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(here, '..', '..')
/** loge-tv/landing's screenshot rig (shots-raw/harness, not in git): its fake.mjs and the pictures. */
export const RIG = resolve(process.env.LOGE_SHOTS_RIG ?? join(REPO, '..', 'landing', 'shots-raw', 'harness'))
export const FAKE = join(RIG, 'tools', 'web', 'fake.mjs')
/** The fake build of this checkout (`--mode fake`, the YouTube embed on the fake detector). */
export const APP_DIR = join(REPO, 'dev', '.out', 'screens-dist')
export const DETECTOR = `http://127.0.0.1:${process.env.FAKE_DETECTOR_PORT ?? 5183}`
