import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { appModel } from '../app/appModel'
import { useApp } from '../app/hooks'
import { isLocalConnection } from '../core/plexAccount'
import { displaySubtitle, displayTitle, landscapePath, makeItem, primaryPart, type PlexItem } from '../core/plexModels'
import type { PlexServerAPI } from '../core/plexServerAPI'
import { TimeFormat } from '../core/progressTracker'
import { capabilities, fullscreenSupported, isTouch, nativeHLS } from '../platform'
import { settingsStore, useSettings } from '../settings'
import { readString, StorageKey, writeString } from '../storage'
import { PlexImage } from '../ui/common'
import {
  BackIcon,
  ExitFullscreenIcon,
  ForwardEndIcon,
  ForwardIcon,
  FullscreenIcon,
  PauseIcon,
  PlayIcon,
  RewindIcon,
  TracksIcon,
  VolumeIcon,
} from '../ui/icons'
import { BifThumbnails } from './bifThumbnails'
import { PlayerSession, type PlayerSnapshot } from './playerSession'
import { ScrubBar } from './ScrubBar'
import { TracksPanel } from './TracksPanel'

const HIDE_CONTROLS_AFTER = 3000

/** Full-screen player route: `/play/:ratingKey?t=seconds`. */
export function PlayerPage() {
  const { key = '' } = useParams()
  const [params] = useSearchParams()
  const { api, server } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const startAt = Number(params.get('t')) || undefined
  const [session, setSession] = useState<PlayerSession>()
  const videoRef = useRef<HTMLVideoElement>(null)

  const exit = useCallback(() => {
    appModel.refresh()
    if (location.key !== 'default') navigate(-1)
    else navigate('/', { replace: true })
  }, [location.key, navigate])

  // One session per mount; the next episode is loaded by the session itself.
  useEffect(() => {
    const video = videoRef.current
    if (!api || !video) return
    const s = new PlayerSession(
      {
        api,
        detector: () => appModel.detector(),
        settings: () => settingsStore.get(),
        preferences: appModel.preferences,
        preferencesSync: appModel.preferencesSync,
        capabilities,
        nativeHLS,
        local: server ? isLocalConnection(server, api.baseURL) : false,
        onItemChange: (next: PlexItem) => navigate(`/play/${encodeURIComponent(next.ratingKey)}`, { replace: true }),
      },
      makeItem({ ratingKey: key, type: 'other' }),
    )
    s.attach(video)
    s.start(startAt)
    setSession(s)
    const onPageHide = () => s.reportStopped(true)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      s.dispose()
    }
    // The session follows its own episode changes; a new mount is a new session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  return (
    <div className="player-page">
      <video ref={videoRef} className="player-video" playsInline preload="auto" />
      {session && api && <PlayerOverlay session={session} api={api} onExit={exit} />}
    </div>
  )
}

function useSession(session: PlayerSession): PlayerSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot)
}

function PlayerOverlay({ session, api, onExit }: { session: PlayerSession; api: PlexServerAPI; onExit: () => void }) {
  const s = useSession(session)
  const settings = useSettings()
  const [controls, setControls] = useState(true)
  const [panel, setPanel] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [volume, setVolume] = useState(() => Number(readString(StorageKey.volume) ?? '1'))
  const [muted, setMuted] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const overControls = useRef(false)
  const thumbnails = useThumbnails(api, s.item)

  useEffect(() => {
    if (s.finished) onExit()
  }, [s.finished, onExit])

  useEffect(() => {
    document.title = `${displayTitle(s.item)}${s.item.type === 'episode' ? ` — ${displaySubtitle(s.item)}` : ''}`
  }, [s.item])

  // Volume lives on the element.
  useEffect(() => {
    const video = document.querySelector<HTMLVideoElement>('.player-video')
    if (!video) return
    video.volume = Math.min(1, Math.max(0, volume))
    video.muted = muted
    writeString(StorageKey.volume, String(volume))
  }, [volume, muted])

  const showControls = useCallback(() => {
    setControls(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (!overControls.current) setControls(false)
    }, HIDE_CONTROLS_AFTER)
  }, [])

  useEffect(() => {
    showControls()
    return () => clearTimeout(hideTimer.current)
  }, [showControls])

  // The bar stays while the panel is open; closing it starts the usual delay over, as in the
  // Apple apps (910e0e7): the bar stays its 3 s, then hides.
  const closePanel = useCallback(() => {
    setPanel(false)
    showControls()
  }, [showControls])

  const visible = controls || s.paused || panel || scrubbing || s.loading || !!s.error

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!fullscreenSupported()) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.querySelector('.player-page')?.requestFullscreen()
  }, [])

  // Keyboard: Space pause, ←/→ seek, F fullscreen, M mute, Esc back out step by step.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') && (t as HTMLInputElement).type !== 'range'
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      switch (e.code) {
        case 'Space':
        case 'KeyK':
          e.preventDefault()
          if (!e.repeat) session.togglePause()
          showControls()
          break
        case 'ArrowLeft':
          e.preventDefault()
          session.seekBy(-settingsStore.get().seekBack)
          showControls()
          break
        case 'ArrowRight':
          e.preventDefault()
          session.seekBy(settingsStore.get().seekForward)
          showControls()
          break
        case 'KeyF':
          e.preventDefault()
          toggleFullscreen()
          break
        case 'KeyM':
          setMuted((m) => !m)
          break
        case 'Escape':
          e.preventDefault()
          if (panel) closePanel()
          else if (session.getSnapshot().nextCard) session.cancelNextEpisode()
          else if (session.getSnapshot().skipCountdown) session.cancelSkipCountdown()
          else if (!document.fullscreenElement) session.close()
          break
        default:
          return
      }
    }
    // A focused button must not also react to Space.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [session, panel, closePanel, showControls, toggleFullscreen])

  const onSurfacePointer = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return
    if (panel) {
      closePanel()
      return
    }
    // Touch: the first tap shows the controls, the next one pauses.
    if (e.pointerType !== 'mouse' && !visible) {
      showControls()
      return
    }
    session.togglePause()
    showControls()
  }

  const item = s.item
  const subtitle = item.type === 'episode' ? displaySubtitle(item) : item.year !== undefined ? String(item.year) : undefined
  // Skip button, countdown or the next episode card.
  const corner = s.nextCard ? (
    <div className="next-card glass">
      <PlexImage path={landscapePath(s.nextCard.item)} width={240} height={135} className="next-art" />
      <div className="next-info">
        <div className="next-label">
          {s.nextCard.secondsLeft !== undefined ? `Следующая серия через ${s.nextCard.secondsLeft}` : 'Следующая серия'}
        </div>
        <div className="next-title">{displaySubtitle(s.nextCard.item) ?? s.nextCard.item.title}</div>
        <div className="row gap">
          <button className="btn btn-primary" onClick={() => session.playNext()} autoFocus>
            <PlayIcon size={16} /> Смотреть
          </button>
          <button className="btn btn-secondary" onClick={() => session.cancelNextEpisode()}>
            Титры
          </button>
        </div>
      </div>
    </div>
  ) : s.skipCountdown ? (
    <div className="skip-countdown glass">
      <span className="countdown-title">{s.skipCountdown.title}</span>
      <button className="btn btn-primary" onClick={() => session.cancelSkipCountdown()}>
        Не пропускать
      </button>
    </div>
  ) : s.skipPrompt ? (
    <button className="btn btn-primary skip-button" onClick={() => session.performSkip()}>
      <ForwardEndIcon size={18} /> {s.skipPrompt.title}
    </button>
  ) : null

  return (
    <div
      className={`player-overlay${visible ? ' controls-visible' : ''}`}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') showControls()
      }}
    >
      <div className="player-surface" onPointerUp={onSurfacePointer} onDoubleClick={toggleFullscreen} />

      {(s.loading || s.buffering) && !s.error && !s.needsGesture && <div className="spinner player-spinner" aria-label="Загрузка…" />}

      {s.needsGesture && !s.error && (
        <button className="big-play" onClick={() => session.togglePause()} aria-label="Смотреть">
          <PlayIcon size={44} />
        </button>
      )}

      <div className={`player-top${visible ? '' : ' hidden'}`}>
        <button className="icon-button" onClick={() => session.close()} aria-label="Назад" title="Назад (Esc)">
          <BackIcon size={26} />
        </button>
        <div className="player-titles">
          <div className="player-title">{displayTitle(item)}</div>
          {subtitle && <div className="player-subtitle">{subtitle}</div>}
        </div>
      </div>

      {/* Subtitles above the corner (one column: they never go under it), over the bar while it is shown. */}
      <div className={`player-stack${visible ? ' raised' : corner ? ' cornered' : ''}`}>
        <Subtitles session={session} />
        {corner && <div className="player-corner">{corner}</div>}
      </div>

      <div
        className={`player-bottom${visible ? '' : ' hidden'}`}
        onPointerEnter={() => (overControls.current = true)}
        onPointerLeave={() => (overControls.current = false)}
      >
        <ScrubBar
          position={s.position}
          duration={s.duration}
          segments={s.segments}
          thumbnails={thumbnails}
          onSeek={(t) => session.seekTo(t)}
          onScrubbing={(active) => {
            setScrubbing(active)
            if (!active) showControls()
          }}
        />
        <div className="player-controls">
          <button className="icon-button" onClick={() => session.togglePause()} aria-label={s.paused ? 'Смотреть' : 'Пауза'} title="Пробел">
            {s.paused ? <PlayIcon size={26} /> : <PauseIcon size={26} />}
          </button>
          <button className="icon-button" onClick={() => session.seekBy(-settings.seekBack)} aria-label={`Назад на ${settings.seekBack} с`} title="←">
            <RewindIcon size={24} />
            <span className="step">{settings.seekBack}</span>
          </button>
          <button className="icon-button" onClick={() => session.seekBy(settings.seekForward)} aria-label={`Вперёд на ${settings.seekForward} с`} title="→">
            <ForwardIcon size={24} />
            <span className="step">{settings.seekForward}</span>
          </button>
          <span className="time">
            {TimeFormat.clock(s.position)} / {TimeFormat.clock(s.duration)}
          </span>
          <span className="spacer" />
          {!isTouch && (
            <div className="volume">
              <button className="icon-button" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Включить звук' : 'Выключить звук'} title="M">
                <VolumeIcon size={22} muted={muted || volume === 0} />
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                aria-label="Громкость"
                onChange={(e) => {
                  setVolume(Number(e.target.value))
                  setMuted(false)
                }}
              />
            </div>
          )}
          <button className={`icon-button${panel ? ' active' : ''}`} onClick={() => (panel ? closePanel() : setPanel(true))} aria-label="Дорожки и разметка" title="Дорожки и разметка">
            <TracksIcon size={24} />
          </button>
          {fullscreenSupported() && (
            <button className="icon-button" onClick={toggleFullscreen} aria-label={fullscreen ? 'Выйти из полноэкранного режима' : 'Во весь экран'} title="F">
              {fullscreen ? <ExitFullscreenIcon size={22} /> : <FullscreenIcon size={22} />}
            </button>
          )}
        </div>
      </div>

      {panel && <TracksPanel session={session} snapshot={s} onClose={closePanel} />}

      {s.error && (
        <div className="player-error">
          <p>{s.error}</p>
          <div className="row gap center">
            <button className="btn btn-primary" onClick={() => session.close()}>
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Text subtitles drawn over the video, in file time (works with HLS offsets too). */
function Subtitles({ session }: { session: PlayerSession }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let frame = 0
    let last = ''
    const loop = () => {
      const text = session.subtitleText()
      if (text !== last && ref.current) {
        last = text
        ref.current.textContent = text
        ref.current.style.display = text ? '' : 'none'
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [session])
  return (
    <div className="subtitles" aria-live="off">
      <div ref={ref} className="subtitle-text" style={{ display: 'none' }} />
    </div>
  )
}

/** Preview thumbnails of the part, when Plex generated them. */
function useThumbnails(api: PlexServerAPI, item: PlexItem): BifThumbnails | undefined {
  const [thumbnails, setThumbnails] = useState<BifThumbnails>()
  const part = primaryPart(item)
  const url = part ? api.bifURL(part) : undefined
  useEffect(() => {
    setThumbnails(undefined)
    if (!url) return
    const t = new BifThumbnails(url)
    let alive = true
    void t.load().then((ok) => {
      if (alive && ok) setThumbnails(t)
    })
    return () => {
      alive = false
      t.dispose()
    }
  }, [url])
  return thumbnails
}
