import { useRef, useState, type PointerEvent } from 'react'
import { TimeFormat } from '../core/progressTracker'
import type { Segment } from '../core/segment'
import type { BifThumbnails } from './bifThumbnails'

/**
 * Seek bar: drag (mouse or touch) moves the knob smoothly and shows a preview
 * (Plex BIF thumbnail when available, else time); the seek happens on release.
 */
export function ScrubBar({
  position,
  duration,
  segments,
  thumbnails,
  onSeek,
  onScrubbing,
}: {
  position: number
  duration: number
  segments: Segment[]
  thumbnails?: BifThumbnails
  onSeek: (seconds: number) => void
  onScrubbing?: (active: boolean) => void
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | undefined>()
  const [hover, setHover] = useState<number | undefined>()

  const timeAt = (clientX: number) => {
    const el = barRef.current
    if (!el || duration <= 0) return 0
    const rect = el.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return fraction * duration
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (duration <= 0 || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(timeAt(e.clientX))
    onScrubbing?.(true)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const t = timeAt(e.clientX)
    if (drag !== undefined) setDrag(t)
    else if (e.pointerType === 'mouse') setHover(t)
  }
  const finish = (e: PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (drag === undefined) return
    const target = commit ? timeAt(e.clientX) : undefined
    setDrag(undefined)
    onScrubbing?.(false)
    if (target !== undefined) onSeek(target)
  }

  const shown = drag ?? position
  const fraction = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0
  const preview = drag ?? hover
  const previewFraction = preview !== undefined && duration > 0 ? preview / duration : 0
  const thumb = preview !== undefined ? thumbnails?.frame(preview) : undefined

  return (
    <div
      className={`scrub${drag !== undefined ? ' dragging' : ''}`}
      ref={barRef}
      role="slider"
      aria-label="Позиция"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={TimeFormat.clock(shown)}
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, true)}
      onPointerCancel={(e) => finish(e, false)}
      onPointerLeave={() => setHover(undefined)}
    >
      <div className="scrub-track">
        {duration > 0 &&
          segments.map((s, i) => (
            <div
              key={i}
              className={`scrub-segment ${s.type}`}
              style={{ left: `${(s.start / duration) * 100}%`, width: `${Math.max(0.3, ((s.end - s.start) / duration) * 100)}%` }}
            />
          ))}
        <div className="scrub-played" style={{ width: `${fraction * 100}%` }} />
      </div>
      <div className="scrub-knob" style={{ left: `${fraction * 100}%` }} />
      {preview !== undefined && (
        <div className="scrub-preview" style={{ left: `clamp(${thumb ? 90 : 34}px, ${previewFraction * 100}%, calc(100% - ${thumb ? 90 : 34}px))` }}>
          {thumb && <img src={thumb} alt="" />}
          <span>{TimeFormat.clock(preview)}</span>
        </div>
      )}
    </div>
  )
}
