import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreIcon } from './icons'

export interface MenuAction {
  title: string
  onSelect: () => void
  destructive?: boolean
  icon?: ReactNode
}

const MENU_WIDTH = 280

/**
 * «Ещё» («⋯»): a menu of less common actions (deleting downloads). In <body> at the button's
 * place, so the page's sections don't cover it; Esc, a click elsewhere, scrolling close it.
 */
export function MoreMenu({ actions, disabled }: { actions: MenuAction[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<{ top: number; left: number }>()
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  // Under the button; above it when there is no room below (the button low on the screen, as on
  // a phone turned sideways), so the menu is never off the screen. Measured before it is painted.
  useLayoutEffect(() => {
    if (!open || !button.current) return
    const rect = button.current.getBoundingClientRect()
    const width = Math.min(MENU_WIDTH, window.innerWidth - 16)
    const height = menu.current?.offsetHeight ?? 0
    const below = rect.bottom + 6
    const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - 6 - height) : below
    setPlace({ top, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!menu.current?.contains(target) && !button.current?.contains(target)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    menu.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus()
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, place])

  if (actions.length === 0) return null
  return (
    <>
      <button
        ref={button}
        className="icon-action"
        aria-label="Ещё"
        title="Ещё"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon size={20} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="menu glass-strong"
            role="menu"
            aria-label="Ещё"
            // Hidden for the moment it is measured, before its place is known.
            style={{ top: place?.top ?? 0, left: place?.left ?? 0, visibility: place ? undefined : 'hidden', width: Math.min(MENU_WIDTH, window.innerWidth - 16) }}
          >
            {actions.map((action) => (
              <button
                key={action.title}
                role="menuitem"
                className={action.destructive ? 'destructive' : undefined}
                onClick={() => {
                  setOpen(false)
                  action.onSelect()
                }}
              >
                {action.icon}
                <span>{action.title}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
