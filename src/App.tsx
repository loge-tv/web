import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { appModel } from './app/appModel'
import { useApp, usePlay } from './app/hooks'
import { displaySubtitle, displayTitle } from './core/plexModels'
import { ResumePolicy, TimeFormat } from './core/progressTracker'
import { Home } from './pages/Home'
import { Library } from './pages/Library'
import { Movie } from './pages/Movie'
import { ConnectingScreen, FailedScreen, LoginScreen, ServerPicker } from './pages/SessionScreens'
import { SettingsPage } from './pages/Settings'
import { Show } from './pages/Show'
import { PlayerPage } from './player/PlayerPage'
import { APP_NAME } from './config'
import { Layout } from './ui/Layout'

export function App() {
  const { phase } = useApp()

  useEffect(() => {
    void appModel.start()
  }, [])

  switch (phase.kind) {
    case 'starting':
      return <ConnectingScreen text="Загрузка…" />
    case 'login':
      return <LoginScreen phase={phase} />
    case 'choosingServer':
      return <ServerPicker servers={phase.servers} />
    case 'connecting':
      return <ConnectingScreen text={phase.text} />
    case 'failed':
      return <FailedScreen message={phase.message} />
    case 'ready':
      return (
        <HashRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="library/:key" element={<Library />} />
              <Route path="movie/:key" element={<Movie />} />
              <Route path="show/:key" element={<Show />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="play/:key" element={<PlayerPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <ResumeDialog />
          <TitleReset />
        </HashRouter>
      )
  }
}

/** "Continue from 12:34 / From the beginning" before playing a partially watched item. */
function ResumeDialog() {
  const { resumeCandidate: item } = useApp()
  const { play } = usePlay()

  useEffect(() => {
    if (!item) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') appModel.setResumeCandidate(undefined)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item])

  if (!item) return null
  const resume = ResumePolicy.resumePosition(item)
  const subtitle = item.type === 'episode' ? displaySubtitle(item) : undefined
  return (
    <div className="modal-backdrop" onClick={() => appModel.setResumeCandidate(undefined)}>
      <div className="modal glass-strong" role="dialog" aria-modal="true" aria-label="Продолжить просмотр" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{displayTitle(item)}</div>
        {subtitle && <div className="muted">{subtitle}</div>}
        <div className="modal-actions">
          {resume !== undefined && (
            <button className="btn btn-primary wide" autoFocus onClick={() => play(item, resume)}>
              Продолжить с {TimeFormat.clock(resume)}
            </button>
          )}
          <button className="btn btn-secondary wide" onClick={() => play(item)}>
            С начала
          </button>
          <button className="btn btn-ghost wide" onClick={() => appModel.setResumeCandidate(undefined)}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}

/** Restores the tab title after the player sets it. */
function TitleReset() {
  const { refreshKey } = useApp()
  useEffect(() => {
    if (!window.location.hash.startsWith('#/play/')) document.title = APP_NAME
  }, [refreshKey])
  return null
}
