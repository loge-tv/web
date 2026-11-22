import { useApi, useApp, useLoad, useOpenCatalog, useOpenItem, usePlay, useWatchlistRefresh, useWatchlistShelves } from '../app/hooks'
import { shelvesAreEmpty, type WatchlistShelves } from '../core/catalogMatch'
import { upcomingCaption } from '../core/plexDiscover'
import {
  backdropPath,
  collapseRecentlyAdded,
  displaySubtitle,
  displayTitle,
  orderContinueWatching,
  showsToLookUp,
  progress,
  type PlexItem,
  type PlexLibrarySection,
} from '../core/plexModels'
import { TimeFormat } from '../core/progressTracker'
import { CatalogCard, LandscapeCard, PosterCard, Shelf } from '../ui/cards'
import { ErrorView, PlexImage, Spinner } from '../ui/common'
import { PlayIcon } from '../ui/icons'

interface HomeData {
  onDeck: PlexItem[]
  recent: { section: PlexLibrarySection; items: PlexItem[] }[]
}

function remaining(item: PlexItem): string | undefined {
  if (item.duration === undefined || item.viewOffset === undefined) return item.year !== undefined ? String(item.year) : undefined
  const left = TimeFormat.runtime(item.duration - item.viewOffset)
  return left ? `Осталось ${left}` : undefined
}

export function Home() {
  const api = useApi()
  const { sections } = useApp()
  const open = useOpenItem()
  const { requestPlay } = usePlay()
  const shelves = useWatchlistShelves()
  useWatchlistRefresh()
  const { data, error, loading, reload } = useLoad<HomeData>(async () => {
    const [deck, recent] = await Promise.all([
      api.onDeck(),
      Promise.all(
        sections.map(async (section) => ({
          section,
          items: collapseRecentlyAdded(await api.recentlyAdded(section).catch(() => [])),
        })),
      ),
    ])
    // Next-up episodes are ordered by when their show was last watched; on error, Plex order.
    const shows = await api.itemsByKeys(showsToLookUp(deck)).catch(() => [])
    const showLastViewed: Record<string, number> = {}
    for (const show of shows) if (show.lastViewedAt) showLastViewed[show.ratingKey] = show.lastViewedAt
    return { onDeck: orderContinueWatching(deck, showLastViewed), recent }
  }, [api, sections])

  if (!data && loading) return <Spinner />
  if (!data) return <ErrorView message={`Не удалось загрузить главную: ${error ?? ''}`} onRetry={reload} />

  const hero = data.onDeck[0] ?? data.recent.find((r) => r.items.length > 0)?.items[0]
  const nothing = data.onDeck.length === 0 && data.recent.every((r) => r.items.length === 0) && shelvesAreEmpty(shelves)

  return (
    <div className="home">
      {hero && <Hero item={hero} onOpen={() => open(hero)} onPlay={data.onDeck[0] === hero ? () => requestPlay(hero) : undefined} />}
      <div className="shelves">
        {data.onDeck.length > 0 && (
          <Shelf title="Продолжить просмотр">
            {data.onDeck.map((item) => (
              <LandscapeCard
                key={item.ratingKey}
                item={item}
                title={displayTitle(item)}
                subtitle={item.type === 'episode' ? displaySubtitle(item) : remaining(item)}
                onOpen={() => open(item)}
                onPlay={() => requestPlay(item)}
              />
            ))}
          </Shelf>
        )}
        <WatchlistShelvesView shelves={shelves} />
        {data.recent
          .filter((r) => r.items.length > 0)
          .map((r) => (
            <Shelf key={r.section.key} title={`Недавно добавлено · ${r.section.title}`}>
              {r.items.map((item) => (
                <PosterCard key={`${item.type}-${item.ratingKey}`} item={item} onOpen={() => open(item)} />
              ))}
            </Shelf>
          ))}
        {nothing && <p className="muted page-inset">Медиатека пуста.</p>}
      </div>
    </div>
  )
}

/** The Plex list minus what the server has: «Хочу посмотреть» and «Ещё не вышло». */
function WatchlistShelvesView({ shelves }: { shelves: WatchlistShelves }) {
  const openCatalog = useOpenCatalog()
  return (
    <>
      {shelves.wanted.length > 0 && (
        <Shelf title="Хочу посмотреть">
          {shelves.wanted.map((entry) => (
            <CatalogCard key={entry.ratingKey} entry={entry} onOpen={() => openCatalog(entry)} />
          ))}
        </Shelf>
      )}
      {shelves.upcoming.length > 0 && (
        <Shelf title="Ещё не вышло">
          {shelves.upcoming.map((entry) => (
            <CatalogCard key={entry.ratingKey} entry={entry} caption={upcomingCaption(entry)} onOpen={() => openCatalog(entry)} />
          ))}
        </Shelf>
      )}
    </>
  )
}

function Hero({ item, onOpen, onPlay }: { item: PlexItem; onOpen: () => void; onPlay?: () => void }) {
  const p = progress(item)
  return (
    <section className="hero">
      <PlexImage path={backdropPath(item)} width={1600} height={900} className="hero-art" eager />
      <div className="hero-shade" />
      <div className="hero-content page-inset">
        <h1 className="hero-title">{displayTitle(item)}</h1>
        {displaySubtitle(item) && <div className="hero-subtitle">{displaySubtitle(item)}</div>}
        {item.summary && <p className="hero-summary">{item.summary}</p>}
        <div className="row gap wrap">
          {onPlay && (
            <button className="btn btn-primary" onClick={onPlay}>
              <PlayIcon size={18} /> {p !== undefined ? 'Продолжить' : 'Смотреть'}
            </button>
          )}
          <button className="btn btn-secondary" onClick={onOpen}>
            Подробнее
          </button>
        </div>
        {p !== undefined && (
          <div className="hero-progress">
            <div className="progress-line inline">
              <div style={{ width: `${Math.round(p * 100)}%` }} />
            </div>
            <span className="muted">{remaining(item)}</span>
          </div>
        )}
      </div>
    </section>
  )
}
