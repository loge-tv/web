import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { appModel } from '../app/appModel'
import { YOUTUBE_URL } from '../config'
import { isYouTubeID, trailerWatchURL, type TrailerVideo } from '../core/tmdbClient'
import { Language } from '../core/mediaTrack'
import { parseYouTubeMessage, trailerFailureText, TrailerText, youTubeEmbedURL, youTubeHandshake, type TrailerFailure } from '../core/youtubeEmbed'
import { useSettings } from '../settings'
import { Modal } from './dialog'
import { PlayIcon, TrailerIcon } from './icons'
import { IconAction } from './iconAction'

/**
 * TMDB's trailers of a page's title (`movie:603` / `tv:1396`) through the TMDB proxy, the
 * preferred language first. Empty without a TMDB id, while the proxy can't answer, or when TMDB
 * has none.
 */
export function useTrailers(item: string | undefined): TrailerVideo[] {
  const { preferredLanguage } = useSettings()
  const key = `${item ?? ''}|${preferredLanguage}`
  const [loaded, setLoaded] = useState<{ key: string; videos: TrailerVideo[] }>()
  useEffect(() => {
    if (!item) return
    let cancelled = false
    appModel.tmdb.videos(item, preferredLanguage).then(
      (videos) => {
        if (!cancelled) setLoaded({ key, videos: videos.filter((v) => isYouTubeID(v.key)) })
      },
      (error: unknown) => console.warn('trailers', item, error),
    )
    return () => {
      cancelled = true
    }
  }, [item, preferredLanguage, key])
  return loaded?.key === key ? loaded.videos : []
}

/** YouTube's embedded player of a video, in `language`. */
export function trailerEmbedURL(video: TrailerVideo, language: string): string {
  return youTubeEmbedURL(YOUTUBE_URL, video, language, window.location.origin)
}

function videoTitle(video: TrailerVideo): string {
  return video.name || (video.type === 'Teaser' ? 'Тизер' : 'Трейлер')
}

/** «Трейлер» on a movie, show or catalog page, once the page has trailers. */
export function TrailerButton({ videos }: { videos: TrailerVideo[] }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  if (videos.length === 0) return null
  return (
    <>
      <IconAction label="Трейлер" onClick={() => setOpen(true)}>
        <TrailerIcon size={20} />
      </IconAction>
      {open && <TrailerDialog videos={videos} onClose={close} />}
    </>
  )
}

/**
 * A trailer playing in the page (YouTube's embedded player), the others to switch to, and the
 * way out to YouTube itself (some videos refuse to play embedded). When the player can't show it
 * (no network, YouTube unreachable, the video refused) the app says so in the frame's place,
 * with «Открыть в YouTube» (and «Повторить» for the network).
 */
function TrailerDialog({ videos, onClose }: { videos: TrailerVideo[]; onClose: () => void }) {
  const { preferredLanguage } = useSettings()
  const [current, setCurrent] = useState(videos[0])
  const [attempt, setAttempt] = useState(0)
  const frame = useRef<HTMLIFrameElement>(null)
  const src = trailerEmbedURL(current, preferredLanguage)
  const failure = useEmbedFailure(frame, src, attempt)
  const retry = useCallback(() => setAttempt((a) => a + 1), [])
  // Back online: again by itself.
  useEffect(() => {
    if (failure?.kind !== 'network') return
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [failure, retry])
  const watch = (
    <a className="btn btn-secondary" href={trailerWatchURL(current)} target="_blank" rel="noopener noreferrer">
      {TrailerText.openInYouTube}
    </a>
  )
  return (
    <Modal label="Трейлер" className="trailer-modal" onClose={onClose}>
      <div className="trailer-head">
        <div className="modal-title">Трейлер</div>
        <button className="btn btn-ghost" onClick={onClose}>
          Готово
        </button>
      </div>
      <div className="trailer-frame">
        {failure ? (
          <div className="trailer-failed" role="alert">
            <p>{trailerFailureText(failure)}</p>
            <div className="trailer-failed-actions">
              {failure.kind === 'network' && (
                <button className="btn btn-primary" onClick={retry}>
                  {TrailerText.retry}
                </button>
              )}
              {watch}
            </div>
          </div>
        ) : (
          <iframe
            key={`${current.key} ${attempt}`}
            ref={frame}
            src={src}
            title={videoTitle(current)}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
      </div>
      {videos.length > 1 && (
        <ul className="trailer-list" aria-label="Другие видео">
          {videos.map((video) => (
            <li key={video.key}>
              <button aria-pressed={video.key === current.key} onClick={() => setCurrent(video)}>
                <PlayIcon size={16} />
                <span className="grow">{videoTitle(video)}</span>
                {video.language && <span className="muted">{Language.name(video.language)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!failure && watch}
    </Modal>
  )
}

/** How long YouTube may take to answer at all before the frame counts as not loading. */
const EMBED_TIMEOUT_MS = 15_000

/**
 * Why the embedded player at `src` can't show its video, or undefined while it can (or may yet).
 * A cross-origin frame doesn't say whether it loaded (its `load` fires for the browser's error
 * page too), so: offline → at once; the embed page unreachable → a no-cors HEAD of it fails (or
 * hangs with the player silent); the player's own error → its postMessage (`enablejsapi=1`).
 * Without an answer from the player nothing is assumed: a player that never talks still plays.
 */
function useEmbedFailure(frame: RefObject<HTMLIFrameElement | null>, src: string, attempt: number): TrailerFailure | undefined {
  const [state, setState] = useState<{ src: string; attempt: number; failure: TrailerFailure }>()
  useEffect(() => {
    let over = false
    let alive = false
    const fail = (failure: TrailerFailure) => {
      if (over) return
      over = true
      setState({ src, attempt, failure })
    }
    if (!navigator.onLine) {
      fail({ kind: 'network' })
      return
    }
    const onOffline = () => {
      if (!alive) fail({ kind: 'network' })
    }
    window.addEventListener('offline', onOffline)

    const probe = new AbortController()
    const timer = setTimeout(() => {
      if (!alive) fail({ kind: 'network' })
      probe.abort()
    }, EMBED_TIMEOUT_MS)
    fetch(src, { method: 'HEAD', mode: 'no-cors', credentials: 'omit', cache: 'no-store', signal: probe.signal }).then(
      () => clearTimeout(timer),
      () => {
        clearTimeout(timer)
        if (!probe.signal.aborted && !alive) fail({ kind: 'network' })
      },
    )

    const origin = new URL(src).origin
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || !frame.current || e.source !== frame.current.contentWindow) return
      const message = parseYouTubeMessage(e.data)
      if (!message) return
      alive = true
      if (message.event === 'onError') fail({ kind: 'player', code: Number(message.info) })
    }
    window.addEventListener('message', onMessage)
    // «listening» until the player answers, for a while (as YouTube's IFrame API does).
    let tries = 0
    const hello = setInterval(() => {
      if (alive || over || ++tries > 120) return clearInterval(hello)
      const target = frame.current?.contentWindow
      if (target) for (const message of youTubeHandshake(1)) target.postMessage(message, origin)
    }, 250)

    return () => {
      over = true
      probe.abort()
      clearTimeout(timer)
      clearInterval(hello)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('message', onMessage)
    }
  }, [frame, src, attempt])
  return state && state.src === src && state.attempt === attempt ? state.failure : undefined
}
