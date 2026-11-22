import { useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { appModel } from './app/appModel'
import { useApp } from './app/hooks'
import { Catalog } from './pages/Catalog'
import { Home } from './pages/Home'
import { Library } from './pages/Library'
import { Movie } from './pages/Movie'
import { FailedScreen, LoginScreen, ServerPicker, SplashScreen } from './pages/SessionScreens'
import { Search } from './pages/Search'
import { SettingsPage } from './pages/Settings'
import { Show } from './pages/Show'
import { PlayerPage } from './player/PlayerPage'
import { APP_NAME } from './config'
import { Layout } from './ui/Layout'

/** One full sweep of the splash light. */
const SPLASH_MIN_MS = 1300

export function App() {
  const { phase } = useApp()

  // The launch splash shows at least one sweep of its light, even when start-up is instant.
  const [splashTimeUp, setSplashTimeUp] = useState(false)

  useEffect(() => {
    void appModel.start()
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setSplashTimeUp(true), SPLASH_MIN_MS)
    return () => window.clearTimeout(timer)
  }, [])

  if (phase.kind === 'starting' || phase.kind === 'connecting' || !splashTimeUp) {
    return <SplashScreen text={phase.kind === 'connecting' ? phase.text : undefined} />
  }

  switch (phase.kind) {
    case 'login':
      return <LoginScreen phase={phase} />
    case 'choosingServer':
      return <ServerPicker servers={phase.servers} />
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
              <Route path="search" element={<Search />} />
              <Route path="catalog/:key" element={<Catalog />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="play/:key" element={<PlayerPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <TitleReset />
        </HashRouter>
      )
  }
}

/** Restores the tab title after the player sets it. */
function TitleReset() {
  const { refreshKey } = useApp()
  useEffect(() => {
    if (!window.location.hash.startsWith('#/play/')) document.title = APP_NAME
  }, [refreshKey])
  return null
}
