import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { appModel } from '../app/appModel'
import { useWatchlist } from '../app/hooks'
import { isListed } from '../app/watchlist'
import { discoverCaption, type DiscoverItem } from '../core/plexDiscover'
import { displayTitle, isWatched, landscapePath, posterPath, progress, type PlexItem } from '../core/plexModels'
import { CatalogImage, ItemBadge, PlexImage, ProgressLine } from './common'
import { BookmarkIcon, ChevronRightIcon, BackIcon, PlayIcon } from './icons'

/** Vertical poster with title underneath (movies, shows, seasons). */
export function PosterCard({ item, onOpen, onPlay }: { item: PlexItem; onOpen: () => void; onPlay?: () => void }) {
  const p = progress(item)
  const title = item.type === 'season' ? displayTitle(item) : item.title
  const subtitle = item.type === 'season' ? item.title : item.year !== undefined ? String(item.year) : undefined
  return (
    <div className="card poster-card">
      <div className="card-art-wrap">
        <button className="card-art poster" onClick={onOpen} aria-label={item.type === 'season' ? `${title}, ${item.title}` : title}>
          <PlexImage path={posterPath(item)} width={240} height={360} />
          <span className="card-badge">
            <ItemBadge item={item} />
          </span>
          {p !== undefined && <ProgressLine value={p} />}
        </button>
        {onPlay && <PlayOverlayButton onPlay={onPlay} label={`Смотреть ${title}`} />}
      </div>
      <div className="card-text">
        <div className="card-title">{title}</div>
        {subtitle && <div className="card-subtitle">{subtitle}</div>}
      </div>
    </div>
  )
}

/**
 * Poster of a catalog title (search, «Хочу посмотреть», «Ещё не вышло») with the bookmark
 * that puts it on the Plex list. `caption` replaces "Фильм · 2021" (the release date of what
 * is not out yet).
 */
export function CatalogCard({ entry, caption, onOpen }: { entry: DiscoverItem; caption?: string; onOpen: () => void }) {
  const { items } = useWatchlist()
  const subtitle = caption ?? discoverCaption(entry)
  return (
    <div className="card poster-card catalog-card">
      <div className="card-art-wrap">
        <button className="card-art poster" onClick={onOpen} aria-label={`${entry.title}, ${subtitle}`}>
          <CatalogImage path={entry.thumb} width={240} height={360} />
        </button>
        <WatchlistMark listed={isListed(items, entry)} title={entry.title} onToggle={() => void appModel.watchlist.toggle(entry)} />
      </div>
      <div className="card-text">
        <div className="card-title">{entry.title}</div>
        {/* «Дата не объявлена» may take two lines on a phone: the date is the point of «Ещё не вышло». */}
        <div className={`card-subtitle${caption ? ' two-lines' : ''}`}>{subtitle}</div>
      </div>
    </div>
  )
}

/** Round bookmark over a poster's corner: filled white when the title is on the list. */
export function WatchlistMark({ listed, title, onToggle }: { listed: boolean; title: string; onToggle: () => void }) {
  const label = listed ? `Убрать «${title}» из списка` : `Добавить «${title}» в список`
  return (
    // A sibling of the card button (not inside it), like the play overlay.
    <button className={`watchlist-mark${listed ? ' listed' : ''}`} aria-label={label} title={label} onClick={onToggle}>
      <BookmarkIcon filled={listed} size={17} />
    </button>
  )
}

/** 16:9 card: episodes and "continue watching". */
export function LandscapeCard({
  item,
  title,
  subtitle,
  onOpen,
  onPlay,
  selected,
  extra,
  cardRef,
}: {
  item: PlexItem
  title: string
  subtitle?: string
  onOpen: () => void
  onPlay?: () => void
  selected?: boolean
  extra?: ReactNode
  cardRef?: (el: HTMLDivElement | null) => void
}) {
  const p = progress(item)
  return (
    <div className={`card landscape-card${selected ? ' selected' : ''}`} ref={cardRef}>
      <div className="card-art-wrap">
        <button className="card-art landscape" onClick={onOpen} aria-label={title} aria-current={selected ? 'true' : undefined}>
          <PlexImage path={landscapePath(item)} width={400} height={225} />
          <span className="card-badge">{isWatched(item) && <ItemBadge item={item} />}</span>
          {p !== undefined && <ProgressLine value={p} />}
        </button>
        {onPlay && <PlayOverlayButton onPlay={onPlay} label={`Смотреть ${title}`} />}
      </div>
      <div className="card-text">
        <div className="card-title">{title}</div>
        {subtitle && <div className="card-subtitle">{subtitle}</div>}
        {extra}
      </div>
    </div>
  )
}

/** Round play button over the artwork: shown on hover (always on touch screens). */
function PlayOverlayButton({ onPlay, label }: { onPlay: () => void; label: string }) {
  return (
    <button
      className="play-overlay"
      aria-label={label}
      title="Смотреть"
      onClick={(e) => {
        e.stopPropagation()
        onPlay()
      }}
    >
      <PlayIcon size={22} />
    </button>
  )
}

/** Horizontal row with a title and scroll arrows on wide screens. */
export function Shelf({ title, children }: { title: string; children: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })
  const update = () => {
    const el = rowRef.current
    if (!el) return
    const start = el.scrollLeft < 8
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }
  useLayoutEffect(update)
  useEffect(() => {
    const el = rowRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => update())
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const scroll = (direction: 1 | -1) => {
    const el = rowRef.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' })
  }
  return (
    <section className="shelf">
      <h2 className="shelf-title">{title}</h2>
      <div className="shelf-body">
        {!edges.start && (
          <button className="shelf-arrow left" onClick={() => scroll(-1)} aria-label="Назад">
            <BackIcon size={26} />
          </button>
        )}
        <div className="shelf-row" ref={rowRef} onScroll={update}>
          {children}
        </div>
        {!edges.end && (
          <button className="shelf-arrow right" onClick={() => scroll(1)} aria-label="Дальше">
            <ChevronRightIcon size={26} />
          </button>
        )}
      </div>
    </section>
  )
}
