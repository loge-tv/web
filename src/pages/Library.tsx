import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useApi, useApp, useLoad, useOpenItem } from '../app/hooks'
import { isWatched, type PlexItem } from '../core/plexModels'
import { PosterCard } from '../ui/cards'
import { ErrorView, Spinner } from '../ui/common'

type Filter = 'all' | 'unwatched' | 'recent'

const filters: { id: Filter; title: string }[] = [
  { id: 'all', title: 'Все' },
  { id: 'unwatched', title: 'Непросмотренные' },
  { id: 'recent', title: 'Новые' },
]

/** Poster grid of a movie or TV library. */
export function Library() {
  const { key } = useParams()
  const api = useApi()
  const { sections } = useApp()
  const open = useOpenItem()
  const section = sections.find((s) => s.key === key)
  const [filter, setFilter] = useState<Filter>('all')
  const { data, error, loading, reload } = useLoad<PlexItem[]>(
    (signal) => (section ? api.items(section, signal) : Promise.resolve([])),
    [api, section?.key],
  )

  const visible = useMemo(() => {
    const items = data ?? []
    switch (filter) {
      case 'all':
        return items
      case 'unwatched':
        return items.filter((i) => !isWatched(i))
      case 'recent':
        return [...items].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
    }
  }, [data, filter])

  if (!section) return <ErrorView message="Такой медиатеки нет." />
  if (!data && loading) return <Spinner />
  if (!data) return <ErrorView message={`Не удалось загрузить «${section.title}»: ${error ?? ''}`} onRetry={reload} />

  return (
    <div className="library page-inset">
      <div className="library-header">
        <h1>
          {section.title} <span className="muted count">{visible.length}</span>
        </h1>
        <div className="segmented" role="tablist">
          {filters.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>
              {f.title}
            </button>
          ))}
        </div>
      </div>
      <div className="poster-grid">
        {visible.map((item) => (
          <PosterCard key={item.ratingKey} item={item} onOpen={() => open(item)} />
        ))}
      </div>
      {visible.length === 0 && <p className="muted">Здесь пока ничего нет.</p>}
    </div>
  )
}
