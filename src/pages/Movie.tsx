import { useParams } from 'react-router-dom'
import { appModel } from '../app/appModel'
import { useApi, useLoad, usePlay, useWatchlistLoaded } from '../app/hooks'
import { backdropPath, dynamicRangeBadge, isWatched, tmdbID, type PlexItem } from '../core/plexModels'
import { ResumePolicy, TimeFormat } from '../core/progressTracker'
import { LibraryWatchlistButton } from '../ui/cards'
import { ErrorView, PlexImage, Spinner } from '../ui/common'
import { CheckIcon, PlayIcon, RestartIcon } from '../ui/icons'
import { IconAction, TitleActions } from '../ui/iconAction'
import { TrailerButton, useTrailers } from '../ui/trailers'
import { useDeletion, useLeave } from '../ui/deletion'
import { MoreMenu } from '../ui/menu'
import { TrashIcon } from '../ui/icons'

export function badges(item: PlexItem): string[] {
  const media = item.media[0]
  if (!media) return []
  const result: string[] = []
  if (media.videoResolution?.toLowerCase() === '4k') result.push('4K')
  const range = dynamicRangeBadge(media)
  if (range) result.push(range)
  return result
}

export function Movie() {
  const { key = '' } = useParams()
  const api = useApi()
  // The list marks of library titles.
  useWatchlistLoaded()
  const { play } = usePlay()
  const { data: item, error, loading, reload } = useLoad<PlexItem | undefined>((signal) => api.item(key, signal), [api, key])
  const tmdb = item ? tmdbID(item) : undefined
  const trailers = useTrailers(tmdb ? `movie:${tmdb}` : undefined)
  const leave = useLeave()
  const deletion = useDeletion(leave)

  if (!item && loading) return <Spinner />
  if (!item) return <ErrorView message={`Не удалось загрузить фильм: ${error ?? 'не найден'}`} onRetry={reload} />

  const resume = ResumePolicy.resumePosition(item)
  const watched = isWatched(item)
  const runtime = TimeFormat.runtime(item.duration)

  return (
    <div className="detail">
      <div className="detail-backdrop">
        <PlexImage path={backdropPath(item)} width={1600} height={900} eager />
        <div className="hero-shade" />
      </div>
      <div className="detail-body page-inset movie-layout">
        <PlexImage path={item.thumb} width={300} height={450} className="detail-poster" eager />
        <div className="detail-info">
          <h1 className="detail-title">{item.title}</h1>
          <div className="meta">
            {item.year !== undefined && <span>{item.year}</span>}
            {runtime && <span>{runtime}</span>}
            {item.contentRating && <span>{item.contentRating}</span>}
            {item.audienceRating !== undefined && <span>★ {item.audienceRating.toFixed(1)}</span>}
            {badges(item).map((b) => (
              <span key={b} className="meta-badge">
                {b}
              </span>
            ))}
            {watched && (
              <span className="meta-watched">
                <CheckIcon size={14} /> Просмотрено
              </span>
            )}
          </div>
          {item.summary && <p className="summary">{item.summary}</p>}
          <TitleActions
            main={
              <button className="btn btn-primary" onClick={() => play(item, resume)}>
                <PlayIcon size={18} /> {resume !== undefined ? `Продолжить с ${TimeFormat.clock(resume)}` : 'Смотреть'}
              </button>
            }
          >
            {resume !== undefined && (
              <IconAction label="С начала" onClick={() => play(item)}>
                <RestartIcon size={20} />
              </IconAction>
            )}
            <IconAction
              label={watched ? 'Просмотрено' : 'Отметить просмотренным'}
              hint={watched ? 'Снять отметку' : undefined}
              active={watched}
              onClick={() => void appModel.setWatched(item, !watched)}
            >
              <CheckIcon size={20} />
            </IconAction>
            <LibraryWatchlistButton item={item} />
            <TrailerButton videos={trailers} />
            <MoreMenu
              disabled={deletion.deleting}
              actions={[{ title: 'Удалить фильм', destructive: true, icon: <TrashIcon size={18} />, onSelect: () => deletion.ask({ kind: 'movie', item }) }]}
            />
          </TitleActions>
        </div>
      </div>
      {deletion.dialogs}
    </div>
  )
}
