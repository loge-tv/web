import { useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { appModel } from '../app/appModel'
import { useApp, useOpenItem, useWatchlist } from '../app/hooks'
import { isListed } from '../app/watchlist'
import { CatalogText } from '../core/catalogMatch'
import { discoverCaption, type DiscoverItem } from '../core/plexDiscover'
import { TimeFormat } from '../core/progressTracker'
import { CatalogImage, ErrorView, Spinner } from '../ui/common'
import { BookmarkIcon, CheckIcon, PlayIcon } from '../ui/icons'

/**
 * Page of a catalog title the server doesn't have: description and the Plex list button.
 * Opened from a card with the entry in the route state; a reload fetches it by key.
 */
export function Catalog() {
  const { key = '' } = useParams()
  const location = useLocation()
  const passed = (location.state as { entry?: DiscoverItem } | null)?.entry
  const initial = passed?.ratingKey === key ? passed : undefined
  const { api, items, index, indexed } = useWatchlist()
  const { server } = useApp()
  const open = useOpenItem()
  const [details, setDetails] = useState<{ key: string; item?: DiscoverItem; error?: string }>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!api) return
    const controller = new AbortController()
    void appModel.watchlist.refreshIndex()
    api.details(key, controller.signal).then(
      (item) => setDetails({ key, item }),
      (error: unknown) => {
        if (!controller.signal.aborted) setDetails({ key, error: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => controller.abort()
  }, [api, key, attempt])

  const loaded = details?.key === key ? details : undefined
  const item = loaded?.item ?? initial
  if (!item) {
    if (!loaded) return <Spinner />
    return <ErrorView message={`Не удалось загрузить из каталога Plex: ${loaded.error ?? 'не найдено'}`} onRetry={() => setAttempt((n) => n + 1)} />
  }

  const library = index.item(item)
  // Until the server's titles are in, "not on the server" would be a guess.
  const missing = indexed && !library
  const listed = isListed(items, item)
  const runtime = item.kind === 'movie' ? TimeFormat.runtime(item.duration) : undefined
  const seasons = item.kind === 'show' && item.childCount ? CatalogText.seasons(item.childCount) : undefined
  const toggle = () => void appModel.watchlist.toggle(item)

  return (
    <div className="detail catalog">
      <div className="detail-backdrop">
        <CatalogImage path={item.art ?? item.thumb} width={1600} height={900} eager />
        <div className="hero-shade" />
      </div>
      <div className="detail-body page-inset movie-layout">
        <CatalogImage path={item.thumb} width={300} height={450} className="detail-poster" eager />
        <div className="detail-info">
          <h1 className="detail-title">{item.title}</h1>
          <div className="meta">
            <span>{discoverCaption(item)}</span>
            {runtime && <span>{runtime}</span>}
            {seasons && <span>{seasons}</span>}
            {item.contentRating && <span>{item.contentRating}</span>}
            {item.audienceRating !== undefined && <span>★ {item.audienceRating.toFixed(1)}</span>}
          </div>
          <div className="catalog-actions">
            <div className="row gap wrap">
              {library && (
                <button className="btn btn-primary" onClick={() => open(library)}>
                  <PlayIcon size={18} /> Открыть в библиотеке
                </button>
              )}
              {/* The main action while the title is neither on the server nor on the list. */}
              <button
                className={`btn ${missing && !listed ? 'btn-primary' : 'btn-secondary'}`}
                title={listed ? 'Убрать из списка' : undefined}
                onClick={toggle}
              >
                {listed ? <CheckIcon size={18} /> : <BookmarkIcon size={18} />} {listed ? 'В списке' : 'Добавить в список'}
              </button>
            </div>
            {missing && <p className="muted small">{CatalogText.notOnServer(server?.name)}</p>}
          </div>
          {item.genres.length > 0 && <div className="muted">{item.genres.slice(0, 4).join(' · ')}</div>}
          {item.summary && <p className="summary">{item.summary}</p>}
        </div>
      </div>
    </div>
  )
}
