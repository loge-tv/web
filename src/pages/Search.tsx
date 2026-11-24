import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { appModel } from '../app/appModel'
import { useOpenCatalog, useOpenItem, useWatchlistRefresh, useWatchlistShelves } from '../app/hooks'
import { CatalogText, isEmptySearchResult, mergeCatalogSearch, shelvesAreEmpty, type CatalogSearchResult } from '../core/catalogMatch'
import { upcomingCaption, type DiscoverItem } from '../core/plexDiscover'
import { isTouch } from '../platform'
import { CatalogCard, PosterCard } from '../ui/cards'
import { Spinner } from '../ui/common'
import { SearchIcon } from '../ui/icons'

/** Typing: wait for a pause before asking. */
const DEBOUNCE_MS = 350

interface Shown {
  /** The query `result` belongs to. */
  query: string
  result: CatalogSearchResult
  catalogFailed: boolean
}

/**
 * Search over the server and Plex's whole catalog. With an empty query it shows the Plex list:
 * «Хочу посмотреть» and «Ещё не вышло». The query lives in the URL (`?q=`), so Back from a
 * title returns to the same results.
 */
export function Search() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const trimmed = query.trim()
  const [shown, setShown] = useState<Shown>()
  useWatchlistRefresh()

  useEffect(() => {
    if (!trimmed) {
      setShown(undefined)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      const watchlist = appModel.watchlist
      const index = watchlist.refreshIndex()
      const api = watchlist.getSnapshot().api
      let catalog: DiscoverItem[] = []
      let catalogFailed = !api
      if (api) {
        try {
          catalog = await api.search(trimmed, 30, controller.signal)
        } catch {
          catalogFailed = true
        }
      }
      await index
      if (controller.signal.aborted) return
      setShown({ query: trimmed, result: mergeCatalogSearch(trimmed, watchlist.getSnapshot().index, catalog), catalogFailed })
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed])

  return (
    <div className="search page-inset">
      <h1>Поиск</h1>
      <div className="search-field">
        <SearchIcon size={20} />
        <input
          type="search"
          value={query}
          placeholder="Фильмы и сериалы"
          aria-label="Фильмы и сериалы"
          autoFocus={!isTouch && !query}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
        />
      </div>
      {trimmed ? <Results shown={shown} current={shown?.query === trimmed} /> : <Watchlist />}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="search-section">
      <h2>{title}</h2>
      <div className="poster-grid">{children}</div>
    </section>
  )
}

/** Empty query: the Plex list, or what the search does while the list is empty. */
function Watchlist() {
  const shelves = useWatchlistShelves()
  const openCatalog = useOpenCatalog()
  if (shelvesAreEmpty(shelves)) {
    return (
      <div className="search-hint">
        <SearchIcon size={40} />
        <h2>Найдите фильм или сериал</h2>
        <p>{CatalogText.searchHint}</p>
      </div>
    )
  }
  return (
    <>
      {shelves.wanted.length > 0 && (
        <Section title="Хочу посмотреть">
          {shelves.wanted.map((entry) => (
            <CatalogCard key={entry.ratingKey} entry={entry} onOpen={() => openCatalog(entry)} />
          ))}
        </Section>
      )}
      {shelves.upcoming.length > 0 && (
        <Section title="Ещё не вышло">
          {shelves.upcoming.map((entry) => (
            <CatalogCard key={entry.ratingKey} entry={entry} caption={upcomingCaption(entry)} onOpen={() => openCatalog(entry)} />
          ))}
        </Section>
      )}
    </>
  )
}

/** While a new query is on its way the previous results stay (no flashing on each letter). */
function Results({ shown, current }: { shown?: Shown; current: boolean }) {
  const open = useOpenItem()
  const openCatalog = useOpenCatalog()
  if (!shown) return <Spinner />
  const { result, catalogFailed } = shown
  return (
    <>
      {result.inLibrary.length > 0 && (
        <Section title="На сервере">
          {result.inLibrary.map((item) => (
            <PosterCard key={item.ratingKey} item={item} onOpen={() => open(item)} />
          ))}
        </Section>
      )}
      {result.elsewhere.length > 0 && (
        <Section title="Нет на сервере">
          {result.elsewhere.map((entry) => (
            <CatalogCard key={entry.ratingKey} entry={entry} onOpen={() => openCatalog(entry)} />
          ))}
        </Section>
      )}
      {catalogFailed && <p className="muted small">Каталог Plex сейчас недоступен: показано только то, что есть на сервере.</p>}
      {isEmptySearchResult(result) && current && <p className="muted search-empty">Ничего не нашлось</p>}
    </>
  )
}
