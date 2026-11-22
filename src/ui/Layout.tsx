import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { appModel } from '../app/appModel'
import { useApp, useWatchlist } from '../app/hooks'
import { APP_NAME } from '../config'
import { showsExplore, useSettings } from '../settings'
import { sectionKind } from '../core/plexModels'
import { SearchIcon, SettingsIcon, Wordmark } from './icons'

/** Top navigation and the page below it. */
export function Layout() {
  const { sections } = useApp()
  const { api: discover } = useWatchlist()
  const settings = useSettings()
  const [scrolled, setScrolled] = useState(false)
  const location = useLocation()
  const nav = useNavEdges()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <div className="app">
      <header className={`topbar${scrolled ? ' scrolled' : ''}`}>
        <NavLink to="/" className="logo" aria-label={APP_NAME}>
          <Wordmark height={24} />
        </NavLink>
        <nav className={`topnav${nav.className}`} aria-label="Разделы" ref={nav.ref} onScroll={nav.update}>
          <NavLink to="/" end>
            Главная
          </NavLink>
          {sections.map((section) => (
            <NavLink key={section.key} to={`/library/${section.key}`} title={sectionKind(section) === 'movie' ? 'Фильмы' : 'Сериалы'}>
              {section.title}
            </NavLink>
          ))}
          {/* Plex's collections: while any is on in settings and a Plex account is signed in. */}
          {showsExplore(settings) && discover && <NavLink to="/explore">Обзор</NavLink>}
        </nav>
        <div className="topbar-actions">
          <NavLink to="/search" className="icon-link" aria-label="Поиск" title="Поиск">
            <SearchIcon size={22} />
          </NavLink>
          <NavLink to="/settings" className="icon-link" aria-label="Настройки" title="Настройки">
            <SettingsIcon size={22} />
          </NavLink>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
      <WatchlistAlert />
    </div>
  )
}

/**
 * Fades the edges of the section links where they scroll (phones, many libraries), so a cut
 * link reads as "more this way".
 */
function useNavEdges() {
  const ref = useRef<HTMLElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })
  const update = () => {
    const el = ref.current
    if (!el) return
    const start = el.scrollLeft > 2
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => update())
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, update, className: `${edges.start ? ' fade-start' : ''}${edges.end ? ' fade-end' : ''}` }
}

/** A change to the Plex list that Plex refused (it has been put back). */
function WatchlistAlert() {
  const { failure } = useWatchlist()
  const dismiss = () => appModel.watchlist.dismissFailure()

  useEffect(() => {
    if (!failure) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') appModel.watchlist.dismissFailure()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [failure])

  if (!failure) return null
  return (
    <div className="modal-backdrop" onClick={dismiss}>
      <div
        className="modal glass-strong"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="watchlist-alert-title"
        aria-describedby="watchlist-alert-text"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title" id="watchlist-alert-title">
          Список Plex
        </div>
        <p className="muted" id="watchlist-alert-text">
          {failure}
        </p>
        <div className="modal-actions">
          <button className="btn btn-primary wide" autoFocus onClick={dismiss}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
