import { useCallback, useEffect, useState } from 'react'
import { appModel } from '../app/appModel'
import { YOUTUBE_URL } from '../config'
import { isYouTubeID, trailerWatchURL, type TrailerVideo } from '../core/detectorClient'
import { Language } from '../core/mediaTrack'
import { useSettings } from '../settings'
import { Modal } from './dialog'
import { PlayIcon, TrailerIcon } from './icons'
import { IconAction } from './iconAction'

/**
 * TMDB's trailers of a page's title (`movie:603` / `tv:1396`) through the detector, the
 * preferred language first. Empty without a TMDB id, without a detector with a TMDB key, or when
 * TMDB has none.
 */
export function useTrailers(item: string | undefined): TrailerVideo[] {
  const { preferredLanguage } = useSettings()
  const key = `${item ?? ''}|${preferredLanguage}`
  const [loaded, setLoaded] = useState<{ key: string; videos: TrailerVideo[] }>()
  useEffect(() => {
    const detector = appModel.detector()
    if (!item || !detector) return
    let cancelled = false
    detector.videos(item, preferredLanguage).then(
      (videos) => {
        if (!cancelled) setLoaded({ key, videos: (videos ?? []).filter((v) => isYouTubeID(v.key)) })
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
  const lang = isYouTubeID(language) ? language : 'ru'
  const query = new URLSearchParams({ autoplay: '1', playsinline: '1', rel: '0', hl: lang, cc_lang_pref: lang })
  return `${YOUTUBE_URL}/embed/${encodeURIComponent(video.key)}?${query}`
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
 * way out to YouTube itself (some videos refuse to play embedded).
 */
function TrailerDialog({ videos, onClose }: { videos: TrailerVideo[]; onClose: () => void }) {
  const { preferredLanguage } = useSettings()
  const [current, setCurrent] = useState(videos[0])
  return (
    <Modal label="Трейлер" className="trailer-modal" onClose={onClose}>
      <div className="trailer-head">
        <div className="modal-title">Трейлер</div>
        <button className="btn btn-ghost" onClick={onClose}>
          Готово
        </button>
      </div>
      <div className="trailer-frame">
        <iframe
          key={current.key}
          src={trailerEmbedURL(current, preferredLanguage)}
          title={videoTitle(current)}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
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
      <a className="btn btn-secondary" href={trailerWatchURL(current)} target="_blank" rel="noopener noreferrer">
        Открыть в YouTube
      </a>
    </Modal>
  )
}
