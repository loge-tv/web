import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { appModel } from '../app/appModel'
import { CatalogShow, CatalogShowText } from '../app/catalogShow'
import { today } from '../app/watchlist'
import { PINNED_TODAY } from '../config'
import { displaySubtitle, type PlexItem } from '../core/plexModels'
import { catalogEpisodeCaption, entryID, entryItem, entryWatched, isDownloaded, mergeShowCatalog, type ShowEntry } from '../core/showCatalog'
import { CatalogImage } from './common'
import { AlertDialog } from './dialog'
import { CheckIcon, EyeIcon } from './icons'

/** The show's seasons and episodes in Plex's catalog, with the account's marks (a store per show). */
export function useCatalogShow(showKey: string | undefined) {
  // A store per show: another show's marks never show up here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => new CatalogShow(), [showKey])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => {
    if (showKey) void store.load(showKey, appModel.discover)
  }, [store, showKey])
  const loadEpisodes = (seasonKey: string | undefined) => {
    if (seasonKey) void store.loadEpisodes(seasonKey, appModel.discover)
  }
  const setWatched = (item: PlexItem, watched: boolean) => void store.setWatched(item, watched, appModel.discover)
  const alert = snapshot.failure ? <AlertDialog title={CatalogShowText.failedTitle} message={snapshot.failure} onClose={() => store.dismissFailure()} /> : null
  return { snapshot, loadEpisodes, setWatched, alert }
}

/** «Сезон 2», «Сезон 2, просмотрен», «Сезон 3, не скачан». */
export function seasonLabel(entry: ShowEntry, watched: boolean, server = true): string {
  const parts = [entryItem(entry).title]
  if (watched) parts.push('просмотрен')
  if (server && !isDownloaded(entry)) parts.push('не скачан')
  return parts.join(', ')
}

/** Season chips: the ones not downloaded are greyed; a season watched through has a ✓. */
export function SeasonTabs({
  entries,
  selected,
  watched,
  onSelect,
  server = true,
}: {
  entries: ShowEntry[]
  selected: string | undefined
  watched: (entry: ShowEntry) => boolean
  onSelect: (id: string) => void
  /** On a show page: «не скачан» tells the catalog's apart. A catalog title has only those. */
  server?: boolean
}) {
  return (
    <div className="season-tabs page-inset" role="tablist" aria-label="Сезоны">
      {entries.map((entry) => {
        const id = entryID(entry)
        const done = watched(entry)
        const classes = [id === selected ? 'active' : '', server && !isDownloaded(entry) ? 'not-downloaded' : ''].filter(Boolean).join(' ')
        return (
          <button key={id} role="tab" aria-selected={id === selected} aria-label={seasonLabel(entry, done, server)} className={classes} onClick={() => onSelect(id)}>
            {entryItem(entry).title}
            {done && <CheckIcon size={14} />}
          </button>
        )
      })}
    </div>
  )
}

/** «Отметить «Сезон 2» просмотренным»: a season not downloaded, for the account. */
export function SeasonMarkButton({ entry, watched, onToggle }: { entry: ShowEntry; watched: boolean; onToggle: () => void }) {
  const title = entryItem(entry).title
  return (
    <div className="season-actions page-inset">
      <button className="btn btn-ghost" onClick={onToggle}>
        {watched ? <EyeIcon off size={18} /> : <CheckIcon size={18} />} {watched ? `Отметить «${title}» непросмотренным` : `Отметить «${title}» просмотренным`}
      </button>
    </div>
  )
}

function episodeTitle(item: PlexItem): string {
  return `${item.index !== undefined ? `${item.index}. ` : ''}${item.title}`
}

/** An episode only the catalog has: greyed, its air date, a ✓ when the account watched it. */
export function CatalogEpisodeCard({
  entry,
  selected,
  onOpen,
  cardRef,
}: {
  entry: ShowEntry
  selected: boolean
  onOpen: () => void
  cardRef?: (el: HTMLDivElement | null) => void
}) {
  const item = entryItem(entry)
  const title = episodeTitle(item)
  const caption = catalogEpisodeCaption(item, today(PINNED_TODAY))
  return (
    <div className={`card landscape-card not-downloaded${selected ? ' selected' : ''}`} ref={cardRef}>
      <div className="card-art-wrap">
        <button className="card-art landscape" onClick={onOpen} aria-label={`${title}, ${caption}`} aria-current={selected ? 'true' : undefined}>
          <CatalogImage path={item.thumb} width={400} height={225} />
          <span className="card-badge">
            {entryWatched(entry) && (
              <span className="badge badge-watched" title="Просмотрено">
                <CheckIcon size={14} />
              </span>
            )}
          </span>
        </button>
      </div>
      <div className="card-text">
        <div className="card-title">{title}</div>
        <div className="card-subtitle">{caption}</div>
      </div>
    </div>
  )
}

/** Under the row for a catalog episode: no play, no delete; only the account's mark. */
export function CatalogEpisodeDetails({ entry, onToggle }: { entry: ShowEntry; onToggle: () => void }) {
  const item = entryItem(entry)
  const watched = entryWatched(entry)
  return (
    <section className="episode-details page-inset" aria-live="polite">
      <h2>{displaySubtitle(item) ?? item.title}</h2>
      <div className="meta">
        <span>{catalogEpisodeCaption(item, today(PINNED_TODAY))}</span>
        {watched && (
          <span className="meta-watched">
            <CheckIcon size={14} /> Просмотрено
          </span>
        )}
      </div>
      {item.summary && <p className="summary">{item.summary}</p>}
      <div className="row gap wrap">
        <button className="btn btn-secondary" onClick={onToggle}>
          {watched ? <EyeIcon off size={18} /> : <CheckIcon size={18} />} {watched ? 'Отметить непросмотренной' : 'Отметить просмотренной'}
        </button>
      </div>
    </section>
  )
}

/** A show the server lacks (its catalog page): its seasons and episodes to mark watched. */
export function CatalogSeasons({ showKey }: { showKey: string }) {
  const { snapshot, loadEpisodes, setWatched, alert } = useCatalogShow(showKey)
  const [chosen, setChosen] = useState<string>()
  const [selectedEpisode, setSelectedEpisode] = useState<string>()
  const entries = mergeShowCatalog([], snapshot.seasons, snapshot.states)
  // The first season not watched through (specials last), else the first.
  const numbered = entries.filter((e) => (entryItem(e).index ?? 0) > 0)
  const first = numbered.find((e) => !entryWatched(e)) ?? numbered[0] ?? entries[0]
  const open = entries.find((e) => entryID(e) === chosen) ?? first
  const openKey = open?.catalog?.ratingKey
  useEffect(() => loadEpisodes(openKey), [openKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const episodes = openKey ? snapshot.episodes[openKey] : undefined
  const episodeEntries = episodes ? mergeShowCatalog([], episodes, snapshot.states) : []
  const seasonWatched = (entry: ShowEntry) => (entry === open && episodeEntries.length > 0 ? episodeEntries.every(entryWatched) : entryWatched(entry))
  const selected = episodeEntries.find((e) => entryID(e) === selectedEpisode)
  if (entries.length === 0) return null
  return (
    <section className="catalog-seasons" aria-label="Сезоны и серии">
      {entries.length > 1 && (
        <SeasonTabs
          entries={entries}
          selected={open ? entryID(open) : undefined}
          watched={seasonWatched}
          server={false}
          onSelect={(id) => {
            setChosen(id)
            setSelectedEpisode(undefined)
          }}
        />
      )}
      {open?.catalog && <SeasonMarkButton entry={open} watched={seasonWatched(open)} onToggle={() => setWatched(open.catalog!, !seasonWatched(open))} />}
      {episodeEntries.length > 0 && (
        <div className="episode-row">
          {episodeEntries.map((entry) => (
            <CatalogEpisodeCard key={entryID(entry)} entry={entry} selected={entryID(entry) === selectedEpisode} onOpen={() => setSelectedEpisode(entryID(entry))} />
          ))}
        </div>
      )}
      {selected?.catalog && <CatalogEpisodeDetails entry={selected} onToggle={() => setWatched(selected.catalog!, !entryWatched(selected))} />}
      {alert}
    </section>
  )
}
