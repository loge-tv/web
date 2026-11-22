import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useApp } from '../app/hooks'
import { APP_NAME } from '../config'
import { sectionKind } from '../core/plexModels'
import { SettingsIcon, Wordmark } from './icons'

/** Top navigation and the page below it. */
export function Layout() {
  const { sections } = useApp()
  const [scrolled, setScrolled] = useState(false)
  const location = useLocation()

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
        <nav className="topnav" aria-label="Разделы">
          <NavLink to="/" end>
            Главная
          </NavLink>
          {sections.map((section) => (
            <NavLink key={section.key} to={`/library/${section.key}`} title={sectionKind(section) === 'movie' ? 'Фильмы' : 'Сериалы'}>
              {section.title}
            </NavLink>
          ))}
        </nav>
        <NavLink to="/settings" className="settings-link" aria-label="Настройки" title="Настройки">
          <SettingsIcon size={22} />
        </NavLink>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}
