import type { ReactNode } from 'react'

/**
 * A secondary action of a title page as a round icon (the Apple apps' IconButtonStyle): watched,
 * the Plex list, the trailer, «С начала», «Ещё». Its name is the accessible name and the tooltip,
 * `hint` (what a click does to an «on» state) is added to the tooltip. `active`: the state it
 * toggles is on (watched, on the list) — the circle is filled.
 */
export function IconAction({
  label,
  hint,
  active = false,
  disabled,
  onClick,
  children,
}: {
  label: string
  hint?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      className={`icon-action${active ? ' active' : ''}`}
      aria-label={label}
      title={hint ? `${label} — ${hint.toLowerCase()}` : label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** A title page's actions: the main one as a wide button, the rest as a row of round icons. */
export function TitleActions({ main, children }: { main?: ReactNode; children: ReactNode }) {
  return (
    <div className="title-actions">
      {main}
      <div className="action-icons">{children}</div>
    </div>
  )
}
