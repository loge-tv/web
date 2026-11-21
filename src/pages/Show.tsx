import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { appModel } from '../app/appModel'
import { useApi, useLoad, usePlay } from '../app/hooks'
import { EpisodeNavigator } from '../core/episodeNavigator'
import { displaySubtitle, episodeLabel, isWatched, progress, unwatchedLeafCount, type PlexItem } from '../core/plexModels'
import { ResumePolicy, TimeFormat } from '../core/progressTracker'
import { LandscapeCard } from '../ui/cards'
import { ErrorView, PlexImage, Spinner } from '../ui/common'
import { CheckIcon, EyeIcon, PlayIcon } from '../ui/icons'

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
  const { requestPlay } = usePlay()
  const [params, setParams] = useSearchParams()
  const seasonParam = params.get('season')
  const [selected, setSelected] = useState<string | undefined>(params.get('episode') ?? undefined)
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
  const seasons = data?.seasons ?? []
  const resumeTarget = data ? EpisodeNavigator.resumeEpisode(data.episodes) : undefined
  const defaultSeason =
    seasons.find((s) => s.ratingKey === resumeTarget?.parentRatingKey)?.ratingKey ??
    seasons.find((s) => s.index !== 0)?.ratingKey ??
    seasons[0]?.ratingKey
  const season = seasonParam && seasons.some((s) => s.ratingKey === seasonParam) ? seasonParam : defaultSeason

  const episodesLoad = useLoad<{ season?: string; list: PlexItem[] } | null>(
    async (signal) => {
      if (!data) return null
      // Shows without seasons ("skip seasons"): all episodes in one row.
      if (!season) return { season, list: EpisodeNavigator.ordered(data.episodes) }
      return { season, list: await api.children(season, signal) }
    },
    [api, season, data],
  )
  const current = episodesLoad.data
  const episodes = current && current.season === season ? current.list : undefined
  const selectedEpisode = episodes?.find((e) => e.ratingKey === selected)

  // The episode to watch is selected when a season opens (unless the link named one).
  useEffect(() => {
    if (!episodes) return
    setSelected((current) =>
      current && episodes.some((e) => e.ratingKey === current) ? current : EpisodeNavigator.focusEpisode(episodes)?.ratingKey,
    )
  }, [episodes])

  // Keep the selected card in view inside its row (without scrolling the page).
  useEffect(() => {
    const row = rowRef.current
    const card = selected ? cardRefs.current.get(selected) : undefined
    if (!row || !card) return
    const left = card.offsetLeft - (row.clientWidth - card.clientWidth) / 2
    row.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
  }, [selected, episodes])

  if (!data && showLoad.loading) return <Spinner />
  if (!data) return <ErrorView message={`Не удалось загрузить сериал: ${showLoad.error ?? ''}`} onRetry={showLoad.reload} />

  const { show } = data
  const left = unwatchedLeafCount(show)

  const selectSeason = (id: string) => {
    if (id === season) return
    setSelected(undefined)
    setParams({ season: id }, { replace: true })
  }
  const selectEpisode = (episode: PlexItem) => {
    setSelected(episode.ratingKey)
    const next: Record<string, string> = { episode: episode.ratingKey }
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
        <div className="row gap wrap">
          {resumeTarget && (
            <button className="btn btn-primary" onClick={() => requestPlay(resumeTarget)}>
              <PlayIcon size={18} /> {playTitle(resumeTarget)}
            </button>
          )}
        </div>
      </div>

      {seasons.length > 1 && (
        <div className="season-tabs page-inset" role="tablist" aria-label="Сезоны">
          {seasons.map((s) => (
            <button
              key={s.ratingKey}
              role="tab"
              aria-selected={s.ratingKey === season}
              className={s.ratingKey === season ? 'active' : ''}
              onClick={() => selectSeason(s.ratingKey)}
            >
              {s.title}
              {isWatched(s) && <CheckIcon size={14} />}
            </button>
          ))}
        </div>
      )}

      {!episodes && episodesLoad.loading && <Spinner />}
      {episodes && (
        <div className="episode-row" ref={rowRef}>
          {episodes.map((episode) => (
            <LandscapeCard
              key={episode.ratingKey}
              cardRef={(el) => {
                if (el) cardRefs.current.set(episode.ratingKey, el)
                else cardRefs.current.delete(episode.ratingKey)
              }}
              item={episode}
              title={`${episode.index !== undefined ? `${episode.index}. ` : ''}${episode.title}`}
              subtitle={TimeFormat.runtime(episode.duration)}
              selected={episode.ratingKey === selected}
              onOpen={() => selectEpisode(episode)}
              onPlay={() => requestPlay(episode)}
            />
          ))}
        </div>
      )}

      {selectedEpisode && <EpisodeDetails episode={selectedEpisode} onPlay={() => requestPlay(selectedEpisode)} />}
    </div>
  )
}

function EpisodeDetails({ episode, onPlay }: { episode: PlexItem; onPlay: () => void }) {
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
      </div>
    </section>
  )
}
