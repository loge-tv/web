import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { appModel } from '../app/appModel'
import { useApi, useLoad, usePlay, useWatchlistLoaded } from '../app/hooks'
import { EpisodeNavigator } from '../core/episodeNavigator'
import { catalogKey, displaySubtitle, episodeLabel, isWatched, progress, tmdbID, unwatchedLeafCount, type PlexItem } from '../core/plexModels'
import { entryID, entryWatched, mergeShowCatalog, type ShowEntry } from '../core/showCatalog'
import { CatalogEpisodeCard, CatalogEpisodeDetails, SeasonMarkButton, SeasonTabs, useCatalogShow } from '../ui/catalogEpisodes'
import { ResumePolicy, TimeFormat } from '../core/progressTracker'
import { LandscapeCard, LibraryWatchlistButton } from '../ui/cards'
import { ErrorView, PlexImage, Spinner } from '../ui/common'
import { CheckIcon, EyeIcon, PlayIcon, TrashIcon } from '../ui/icons'
import { TrailerButton, useTrailers } from '../ui/trailers'
import { useDeletion, useLeave } from '../ui/deletion'
import { MoreMenu, type MenuAction } from '../ui/menu'
import { TitleActions } from '../ui/iconAction'

interface ShowData {
  show: PlexItem
  seasons: PlexItem[]
  episodes: PlexItem[]
}

function playTitle(episode: PlexItem): string {
  const label = episodeLabel(episode) ?? episode.title
  return progress(episode) !== undefined ? `Продолжить ${label}` : `Смотреть ${label}`
}

function episodesWord(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'серия'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'серии'
  return 'серий'
}

/** Show page: backdrop, description, seasons and episodes. */
export function Show() {
  const { key = '' } = useParams()
  const api = useApi()
  // The list marks of library titles.
  useWatchlistLoaded()
  const { requestPlay } = usePlay()
  const [params, setParams] = useSearchParams()
  const seasonParam = params.get('season')
  const episodeParam = params.get('episode') ?? undefined
  const [selected, setSelected] = useState<string | undefined>(episodeParam)
  // A link naming another episode of this show (back/forward) selects it.
  useEffect(() => {
    if (episodeParam) setSelected(episodeParam)
  }, [episodeParam])
  const rowRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())

  const showLoad = useLoad<ShowData>(
    async (signal) => {
      const [show, children, episodes] = await Promise.all([
        api.item(key, signal),
        api.children(key, signal),
        api.allEpisodes(key, signal).catch(() => [] as PlexItem[]),
      ])
      if (!show) throw new Error('сериал не найден')
      return { show, seasons: children.filter((c) => c.type === 'season'), episodes }
    },
    [api, key],
  )
  const data = showLoad.data
  const tmdb = data ? tmdbID(data.show) : undefined
  const trailers = useTrailers(tmdb ? `tv:${tmdb}` : undefined)
  const leave = useLeave()
  const deletion = useDeletion((done) => {
    if (done.kind === 'show') leave()
  })
  const seasons = data?.seasons ?? []
  // What the server lacks, from Plex's catalog (nothing for old agents or without an account).
  const catalog = useCatalogShow(data ? catalogKey(data.show) : undefined)
  const seasonEntries = mergeShowCatalog(seasons, catalog.snapshot.seasons, catalog.snapshot.states)
  const resumeTarget = data ? EpisodeNavigator.resumeEpisode(data.episodes) : undefined
  const defaultSeason =
    seasons.find((s) => s.ratingKey === resumeTarget?.parentRatingKey)?.ratingKey ??
    seasons.find((s) => s.index !== 0)?.ratingKey ??
    seasons[0]?.ratingKey
  const season = seasonParam && seasonEntries.some((e) => entryID(e) === seasonParam) ? seasonParam : defaultSeason
  const openEntry = seasonEntries.find((e) => entryID(e) === season)
  const openCatalogKey = openEntry?.catalog?.ratingKey
  const { loadEpisodes } = catalog
  useEffect(() => loadEpisodes(openCatalogKey), [openCatalogKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const episodesLoad = useLoad<{ season?: string; list: PlexItem[] } | null>(
    async (signal) => {
      if (!data) return null
      // Shows without seasons ("skip seasons"): all episodes in one row.
      if (!season) return { season, list: EpisodeNavigator.ordered(data.episodes) }
      // A season only the catalog has: its episodes come from there.
      if (!seasons.some((s) => s.ratingKey === season)) return { season, list: [] }
      return { season, list: await api.children(season, signal) }
    },
    [api, season, data],
  )
  const current = episodesLoad.data
  const episodes = current && current.season === season ? current.list : undefined
  const catalogEpisodes = openCatalogKey ? catalog.snapshot.episodes[openCatalogKey] : undefined
  const episodeEntries = episodes ? mergeShowCatalog(episodes, catalogEpisodes ?? [], catalog.snapshot.states) : undefined
  const selectedEntry = episodeEntries?.find((e) => entryID(e) === selected)
  const selectedEpisode = selectedEntry?.server

  // The episode to watch is selected when a season opens (unless the link named one).
  useEffect(() => {
    if (!episodes) return
    setSelected((current) =>
      current && (current.startsWith('catalog:') || episodes.some((e) => e.ratingKey === current))
        ? current
        : EpisodeNavigator.focusEpisode(episodes)?.ratingKey,
    )
  }, [episodes])

  /** The open season is known episode by episode; the others by their counts. */
  const seasonWatched = (entry: ShowEntry) =>
    entryID(entry) === season && episodeEntries && episodeEntries.length > 0 ? episodeEntries.every(entryWatched) : entryWatched(entry)

  // Keep the selected card in view inside its row (without scrolling the page).
  useEffect(() => {
    const row = rowRef.current
    const card = selected ? cardRefs.current.get(selected) : undefined
    if (!row || !card) return
    const left = card.offsetLeft - (row.clientWidth - card.clientWidth) / 2
    row.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
  }, [selected, episodeEntries?.length])

  if (!data && showLoad.loading) return <Spinner />
  if (!data) return <ErrorView message={`Не удалось загрузить сериал: ${showLoad.error ?? ''}`} onRetry={showLoad.reload} />

  const { show } = data
  const left = unwatchedLeafCount(show)
  const openSeason = openEntry?.server

  /** What is watched now, before asking: the page may be older than another device's progress. */
  const askToDeleteWatched = async () => {
    const fresh = await api.allEpisodes(key).catch(() => data.episodes)
    const watched = fresh.filter(isWatched)
    if (watched.length > 0) deletion.ask({ kind: 'watched', items: watched })
  }
  const watchedCount = data.episodes.filter(isWatched).length
  const moreActions: MenuAction[] = [
    ...(watchedCount > 0
      ? [{ title: `Удалить просмотренные серии (${watchedCount})`, destructive: true, icon: <EyeIcon off size={18} />, onSelect: () => void askToDeleteWatched() }]
      : []),
    ...(openSeason ? [{ title: `Удалить «${openSeason.title}»`, destructive: true, icon: <TrashIcon size={18} />, onSelect: () => deletion.ask({ kind: 'season', item: openSeason }) }] : []),
    { title: 'Удалить сериал', destructive: true, icon: <TrashIcon size={18} />, onSelect: () => deletion.ask({ kind: 'show', item: show }) },
  ]

  const selectSeason = (id: string) => {
    if (id === season) return
    setSelected(undefined)
    setParams({ season: id }, { replace: true })
  }
  const selectEpisode = (id: string) => {
    setSelected(id)
    const next: Record<string, string> = { episode: id }
    if (season) next.season = season
    setParams(next, { replace: true })
  }

  return (
    <div className="detail">
      <div className="detail-backdrop">
        <PlexImage path={show.art ?? show.thumb} width={1600} height={900} eager />
        <div className="hero-shade" />
      </div>
      <div className="detail-body page-inset">
        <h1 className="detail-title">{show.title}</h1>
        <div className="meta">
          {show.year !== undefined && <span>{show.year}</span>}
          {show.contentRating && <span>{show.contentRating}</span>}
          {show.leafCount !== undefined && (
            <span>
              {show.leafCount} {episodesWord(show.leafCount)}
            </span>
          )}
          {left !== undefined && left > 0 && <span className="meta-strong">осталось {left}</span>}
        </div>
        {show.summary && <p className="summary clamp-4">{show.summary}</p>}
        <TitleActions
          main={
            resumeTarget && (
              <button className="btn btn-primary" onClick={() => requestPlay(resumeTarget)}>
                <PlayIcon size={18} /> {playTitle(resumeTarget)}
              </button>
            )
          }
        >
          <LibraryWatchlistButton item={show} />
          <TrailerButton videos={trailers} />
          <MoreMenu actions={moreActions} disabled={deletion.deleting} />
        </TitleActions>
      </div>

      {seasonEntries.length > 1 && <SeasonTabs entries={seasonEntries} selected={season} watched={seasonWatched} onSelect={selectSeason} />}
      {openEntry && !openEntry.server && openEntry.catalog && (
        <SeasonMarkButton entry={openEntry} watched={seasonWatched(openEntry)} onToggle={() => catalog.setWatched(openEntry.catalog!, !seasonWatched(openEntry))} />
      )}

      {!episodes && episodesLoad.loading && <Spinner />}
      {episodeEntries && (
        <div className="episode-row" ref={rowRef}>
          {episodeEntries.map((entry) => {
            const id = entryID(entry)
            const cardRef = (el: HTMLDivElement | null) => {
              if (el) cardRefs.current.set(id, el)
              else cardRefs.current.delete(id)
            }
            const episode = entry.server
            if (!episode) return <CatalogEpisodeCard key={id} entry={entry} selected={id === selected} onOpen={() => selectEpisode(id)} cardRef={cardRef} />
            return (
              <LandscapeCard
                key={id}
                cardRef={cardRef}
                item={episode}
                title={`${episode.index !== undefined ? `${episode.index}. ` : ''}${episode.title}`}
                subtitle={TimeFormat.runtime(episode.duration)}
                selected={id === selected}
                onOpen={() => selectEpisode(id)}
                onPlay={() => requestPlay(episode)}
              />
            )
          })}
        </div>
      )}

      {selectedEpisode && (
        <EpisodeDetails
          episode={selectedEpisode}
          onPlay={() => requestPlay(selectedEpisode)}
          onDelete={() => deletion.ask({ kind: 'episode', item: selectedEpisode })}
        />
      )}
      {selectedEntry && !selectedEntry.server && selectedEntry.catalog && (
        <CatalogEpisodeDetails entry={selectedEntry} onToggle={() => catalog.setWatched(selectedEntry.catalog!, !entryWatched(selectedEntry))} />
      )}
      {deletion.dialogs}
      {catalog.alert}
    </div>
  )
}

function EpisodeDetails({ episode, onPlay, onDelete }: { episode: PlexItem; onPlay: () => void; onDelete: () => void }) {
  const watched = isWatched(episode)
  const resume = ResumePolicy.resumePosition(episode)
  const runtime = TimeFormat.runtime(episode.duration)
  return (
    <section className="episode-details page-inset" aria-live="polite">
      <h2>{displaySubtitle(episode) ?? episode.title}</h2>
      <div className="meta">
        {runtime && <span>{runtime}</span>}
        {episode.originallyAvailableAt && <span>{new Date(episode.originallyAvailableAt).toLocaleDateString('ru-RU')}</span>}
        {watched && (
          <span className="meta-watched">
            <CheckIcon size={14} /> Просмотрено
          </span>
        )}
      </div>
      {episode.summary && <p className="summary">{episode.summary}</p>}
      <div className="row gap wrap">
        <button className="btn btn-primary" onClick={onPlay}>
          <PlayIcon size={18} /> {resume !== undefined ? `Продолжить с ${TimeFormat.clock(resume)}` : 'Смотреть'}
        </button>
        <button className="btn btn-secondary" onClick={() => void appModel.setWatched(episode, !watched)}>
          {watched ? <EyeIcon off size={18} /> : <CheckIcon size={18} />}{' '}
          {watched ? 'Отметить непросмотренной' : 'Отметить просмотренной'}
        </button>
        <button className="btn btn-ghost destructive" onClick={onDelete}>
          <TrashIcon size={18} /> Удалить серию
        </button>
      </div>
    </section>
  )
}
