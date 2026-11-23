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

  useLayoutEffect(() => {
    if (!open || !button.current) return
    const rect = button.current.getBoundingClientRect()
    const width = Math.min(MENU_WIDTH, window.innerWidth - 16)
    setPlace({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) })
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
        place &&
        createPortal(
          <div ref={menu} className="menu glass-strong" role="menu" aria-label="Ещё" style={{ top: place.top, left: place.left, width: Math.min(MENU_WIDTH, window.innerWidth - 16) }}>
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
