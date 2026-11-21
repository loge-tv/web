/** Working name of the app; a rename only needs this constant (and index.html's title fallback). */
export const APP_NAME = 'SkipTV'

export const APP_VERSION = '0.1.0'

/**
 * plex.tv and the sign-in page. Overridable at build time only, so the fake server in
 * `web/dev/` can stand in for them (`npm run build -- --mode fake`).
 */
export const PLEX_TV_URL: string = import.meta.env.VITE_PLEX_TV_URL || 'https://plex.tv'
export const PLEX_AUTH_URL: string = import.meta.env.VITE_PLEX_AUTH_URL || 'https://app.plex.tv/auth'
/** Detector used until the user sets another one in the settings. */
export const DEFAULT_DETECTOR: string | undefined = import.meta.env.VITE_DETECTOR_URL || undefined
