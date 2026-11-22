import type { ReactNode } from 'react'
import {
  useApi,
  useApp,
  useLoad,
  useOpenCatalog,
  useOpenItem,
  usePlay,
  useRecommendations,
  useRecommendationsRefresh,
  useWatchlistRefresh,
  useWatchlistShelves,
} from '../app/hooks'
import { upcomingCaption } from '../core/plexDiscover'
import { RecommendationText } from '../core/recommendations'
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
import { useSettings, visibleHomeShelves, type HomeShelf } from '../settings'
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
  // Only the shelves turned on in settings, in their order (search shows the whole list).
  const settings = useSettings()
  const order = visibleHomeShelves(settings, sections)
  const list = useWatchlistShelves()
  const { shelves: recommendations } = useRecommendations()
  const openCatalog = useOpenCatalog()
  useWatchlistRefresh()
  useRecommendationsRefresh()
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

  // Everything turned off in settings.
  if (order.length === 0) return <p className="muted page-inset home-hint">{SettingsHomeText.allShelvesOff}</p>
  if (!data && loading) return <Spinner />
  if (!data) return <ErrorView message={`Не удалось загрузить главную: ${error ?? ''}`} onRetry={reload} />

  const hero = data.onDeck[0] ?? data.recent.find((r) => r.items.length > 0)?.items[0]

  /** One shelf of Home by its id (nothing when it has nothing). */
  const shelf = (id: HomeShelf): ReactNode => {
    switch (id) {
      case 'continue':
        return data.onDeck.length === 0 ? null : (
          <Shelf key={id} title="Продолжить просмотр">
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
        )
      case 'wanted':
        return list.wanted.length === 0 ? null : (
          <Shelf key={id} title="Хочу посмотреть">
            {list.wanted.map((entry) => (
              <CatalogCard key={entry.ratingKey} entry={entry} onOpen={() => openCatalog(entry)} />
            ))}
          </Shelf>
        )
      case 'upcoming':
        return list.upcoming.length === 0 ? null : (
          <Shelf key={id} title="Ещё не вышло">
            {list.upcoming.map((entry) => (
              <CatalogCard key={entry.ratingKey} entry={entry} caption={upcomingCaption(entry)} onOpen={() => openCatalog(entry)} />
            ))}
          </Shelf>
        )
      case 'similarOnServer':
        return recommendations.onServer.length === 0 ? null : (
          <Shelf key={id} title="Похожее на сервере">
            {recommendations.onServer.map((item) => (
              <PosterCard key={item.ratingKey} item={item} onOpen={() => open(item)} />
            ))}
          </Shelf>
        )
      case 'because':
        return recommendations.because.map((b) => (
          <Shelf key={`because-${b.seed.item.ratingKey}`} title={RecommendationText.because(b.seed.item.title)}>
            {b.items.map((entry) => (
              <CatalogCard key={entry.ratingKey} entry={entry} onOpen={() => openCatalog(entry)} />
            ))}
          </Shelf>
        ))
      case 'moreWithCast': {
        const cast = recommendations.cast
        return !cast ? null : (
          <Shelf key={id} title={RecommendationText.cast(cast.seed.title)}>
            {cast.items.map((entry) => (
              <CatalogCard key={entry.ratingKey} entry={entry} onOpen={() => openCatalog(entry)} />
            ))}
          </Shelf>
        )
      }
      default: {
        const r = data.recent.find((x) => `recent:${x.section.key}` === id)
        return !r || r.items.length === 0 ? null : (
          <Shelf key={id} title={`Недавно добавлено · ${r.section.title}`}>
            {r.items.map((item) => (
              <PosterCard key={`${item.type}-${item.ratingKey}`} item={item} onOpen={() => open(item)} />
            ))}
          </Shelf>
        )
      }
    }
  }
  const rendered = order.map(shelf).filter((node) => node !== null && !(Array.isArray(node) && node.length === 0))

  return (
    <div className="home">
      {hero && <Hero item={hero} onOpen={() => open(hero)} onPlay={data.onDeck[0] === hero ? () => requestPlay(hero) : undefined} />}
      <div className="shelves">
        {rendered}
        {rendered.length === 0 && <p className="muted page-inset">Медиатека пуста.</p>}
      </div>
    </div>
  )
}

export const SettingsHomeText = {
  allShelvesOff: 'Все полки выключены. Включите нужные в Настройки → Главная и Обзор.',
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
