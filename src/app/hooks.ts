import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import type { WatchlistShelves } from '../core/catalogMatch'
import type { DiscoverItem } from '../core/plexDiscover'
import type { PlexItem } from '../core/plexModels'
import type { PlexServerAPI } from '../core/plexServerAPI'
import { ResumePolicy } from '../core/progressTracker'
import { PINNED_TODAY } from '../config'
import { appModel, type AppSnapshot } from './appModel'
import { today, watchlistShelves, type WatchlistSnapshot } from './watchlist'

export function useApp(): AppSnapshot {
  return useSyncExternalStore(appModel.subscribe, appModel.getSnapshot)
}

export function useWatchlist(): WatchlistSnapshot {
  return useSyncExternalStore(appModel.watchlist.subscribe, appModel.watchlist.getSnapshot)
}

/** «Хочу посмотреть» and «Ещё не вышло». */
export function useWatchlistShelves(): WatchlistShelves {
  const snapshot = useWatchlist()
  return useMemo(() => watchlistShelves(snapshot, today(PINNED_TODAY)), [snapshot])
}

/** Loads the Plex list and the library index, apart from the page's own data (Plex being slow doesn't hold it up). */
export function useWatchlistRefresh() {
  const { refreshKey } = useApp()
  useEffect(() => {
    void appModel.watchlist.load()
    void appModel.watchlist.refreshIndex()
  }, [refreshKey])
}

/** The connected server API (screens behind the "ready" phase only). */
export function useApi(): PlexServerAPI {
  const { api } = useApp()
  if (!api) throw new Error('not connected')
  return api
}

export interface LoadState<T> {
  data?: T
  error?: string
  loading: boolean
  reload: () => void
}

/**
 * Runs `load` when `deps` or the app refresh key change; keeps the previous data while
 * reloading so pages don't flash.
 */
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): LoadState<T> {
  const { refreshKey } = useApp()
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  const [nonce, setNonce] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true }))
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data, loading: false })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        setState((s) => ({ data: s.data, error: message, loading: false }))
      },
    )
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshKey, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { ...state, reload }
}

/** Starts playback; `requestPlay` goes straight from where a partially watched item was left. */
export function usePlay() {
  const navigate = useNavigate()
  const play = useCallback(
    (item: PlexItem, from?: number) => {
      navigate(`/play/${encodeURIComponent(item.ratingKey)}${from ? `?t=${Math.floor(from)}` : ''}`)
    },
    [navigate],
  )
  const requestPlay = useCallback(
    (item: PlexItem) => {
      play(item, ResumePolicy.resumePosition(item))
    },
    [play],
  )
  return { play, requestPlay }
}

/** Opens a card: details for movies and shows; an episode opens its season with the episode selected. */
export function useOpenItem() {
  const navigate = useNavigate()
  const { requestPlay } = usePlay()
  return useCallback(
    (item: PlexItem) => {
      switch (item.type) {
        case 'movie':
          navigate(`/movie/${item.ratingKey}`)
          break
        case 'show':
          navigate(`/show/${item.ratingKey}`)
          break
        case 'season':
          if (item.parentRatingKey) navigate(`/show/${item.parentRatingKey}?season=${item.ratingKey}`)
          break
        case 'episode':
          if (item.grandparentRatingKey) {
            const season = item.parentRatingKey ? `season=${item.parentRatingKey}&` : ''
            navigate(`/show/${item.grandparentRatingKey}?${season}episode=${item.ratingKey}`)
          } else {
            requestPlay(item)
          }
          break
        case 'clip':
          requestPlay(item)
          break
        default:
          break
      }
    },
    [navigate, requestPlay],
  )
}

/** Opens a catalog title: its library page when the server has it, otherwise the catalog page. */
export function useOpenCatalog() {
  const navigate = useNavigate()
  const openItem = useOpenItem()
  return useCallback(
    (entry: DiscoverItem) => {
      const item = appModel.watchlist.getSnapshot().index.item(entry)
      if (item) openItem(item)
      else navigate(`/catalog/${encodeURIComponent(entry.ratingKey)}`, { state: { entry } })
    },
    [navigate, openItem],
  )
}
