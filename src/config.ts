/** The product name (also index.html's title fallback); the logo is `Wordmark` in ui/icons.tsx. */
export const APP_NAME = 'Sepia TV'

export const APP_VERSION = '0.1.0'

/**
 * plex.tv and the sign-in page. Overridable at build time only, so the fake server in
 * `web/dev/` can stand in for them (`npm run build -- --mode fake`).
 */
export const PLEX_TV_URL: string = import.meta.env.VITE_PLEX_TV_URL || 'https://plex.tv'
export const PLEX_AUTH_URL: string = import.meta.env.VITE_PLEX_AUTH_URL || 'https://app.plex.tv/auth'
/**
 * Plex's online catalog (search, Watchlist) and its picture resizer. Build-time overrides are
 * for the fakes only, like the plex.tv ones.
 */
export const PLEX_DISCOVER_URL: string = import.meta.env.VITE_PLEX_DISCOVER_URL || 'https://discover.provider.plex.tv'
export const PLEX_IMAGES_URL: string = import.meta.env.VITE_PLEX_IMAGES_URL || 'https://images.plex.tv'
/** Fakes only: «today» for release dates, so the smoke's «Ещё не вышло» doesn't go stale. */
export const PINNED_TODAY: string | undefined = import.meta.env.VITE_TODAY || undefined
/**
 * The TMDB proxy (sepiatv/tmdb-proxy): titles in Russian, trailers and recommendations for
 * everyone, Sepia Server or not. The one place of its address.
 * Overridable at build time for the fakes.
 */
export const TMDB_PROXY_URL: string = import.meta.env.VITE_TMDB_PROXY_URL || 'https://api.sepiatv.com'
/**
 * The builds' token the proxy asks for (`X-Client-Token`), given at build time
 * (`VITE_TMDB_PROXY_TOKEN`), never in the repository. It is in the page's code for anyone to see:
 * it keeps out scanners, not people (a known limit for the beta).
 */
export const TMDB_PROXY_TOKEN: string = import.meta.env.VITE_TMDB_PROXY_TOKEN || ''
/** Sepia Server used until the user sets another one in the settings; none by default. */
export const DEFAULT_DETECTOR: string | undefined = import.meta.env.VITE_DETECTOR_URL || undefined
/**
 * The port Sepia Server is looked for on, on the Plex server's hosts: its standard 32420.
 * Overridable for the fakes only (their Sepia Server listens elsewhere).
 */
export const SEPIA_SERVER_PORT: number = Number(import.meta.env.VITE_SEPIA_SERVER_PORT) || 32420
/**
 * YouTube, where trailers play (`/embed/<id>`). Overridable for the fakes only: the smoke test
 * must not reach the real YouTube.
 */
export const YOUTUBE_URL: string = import.meta.env.VITE_YOUTUBE_URL || 'https://www.youtube.com'
/**
 * TheIntroDB, asked for segments when Sepia Server can't be. Overridable for the fakes only:
 * the smoke test must not reach the real one.
 */
export const THEINTRODB_URL: string | undefined = import.meta.env.VITE_THEINTRODB_URL || undefined
