import { useState, type ReactNode } from 'react'
import { useApp } from '../app/hooks'
import { isWatched, progress, unwatchedLeafCount, type PlexItem } from '../core/plexModels'
import { CheckIcon } from './icons'

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center-fill">
      <div className="spinner" role="progressbar" aria-label={label ?? 'Загрузка…'} />
      {label && <p className="muted">{label}</p>}
    </div>
  )
}

export function ErrorView({ message, onRetry, children }: { message: string; onRetry?: () => void; children?: ReactNode }) {
  return (
    <div className="center-fill error-view">
      <p>{message}</p>
      <div className="row gap">
        {onRetry && (
          <button className="btn btn-secondary" onClick={onRetry}>
            Повторить
          </button>
        )}
        {children}
      </div>
    </div>
  )
}

/** Resized image through the server's photo transcoder; sized for the screen's pixel density. */
export function PlexImage({
  path,
  width,
  height,
  alt = '',
  className,
  eager,
}: {
  path: string | undefined
  width: number
  height: number
  alt?: string
  className?: string
  eager?: boolean
}) {
  const { api } = useApp()
  const [loaded, setLoaded] = useState<string | undefined>()
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  const src = api?.imageURL(path, Math.round(width * dpr), Math.round(height * dpr))
  return (
    <div className={`img ${className ?? ''}`}>
      {src && (
        <img
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className={loaded === src ? 'loaded' : undefined}
          onLoad={() => setLoaded(src)}
        />
      )}
    </div>
  )
}

export function ProgressLine({ value }: { value: number }) {
  return (
    <div className="progress-line" aria-hidden="true">
      <div style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}

/** Watched check or the number of unwatched episodes. */
export function ItemBadge({ item }: { item: PlexItem }) {
  if (isWatched(item)) {
    return (
      <span className="badge badge-watched" title="Просмотрено">
        <CheckIcon size={14} />
      </span>
    )
  }
  const left = item.type === 'show' || item.type === 'season' ? unwatchedLeafCount(item) : undefined
  if (left && left > 0) return <span className="badge badge-count">{left}</span>
  return null
}

export function itemProgress(item: PlexItem): number | undefined {
  return progress(item)
}
