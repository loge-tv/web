import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PlexItem } from '../core/plexModels'
import type { PlexServerAPI } from '../core/plexServerAPI'
import { ResumePolicy } from '../core/progressTracker'
import { appModel, type AppSnapshot } from './appModel'

export function useApp(): AppSnapshot {
  return useSyncExternalStore(appModel.subscribe, appModel.getSnapshot)
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

/** Starts playback: asks "resume or restart" first when the item is partially watched. */
export function usePlay() {
  const navigate = useNavigate()
  const play = useCallback(
    (item: PlexItem, from?: number) => {
      appModel.setResumeCandidate(undefined)
      navigate(`/play/${encodeURIComponent(item.ratingKey)}${from ? `?t=${Math.floor(from)}` : ''}`)
    },
    [navigate],
  )
  const requestPlay = useCallback(
    (item: PlexItem) => {
      if (ResumePolicy.resumePosition(item) !== undefined) appModel.setResumeCandidate(item)
      else play(item)
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
