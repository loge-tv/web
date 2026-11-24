import { useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * An in-page dialog over a dimmed page (not `window.confirm`): Esc and a click outside close it.
 * Clicks inside don't reach the page under it (React passes portal events up the tree).
 */
export function Modal({
  label,
  onClose,
  className = '',
  role = 'dialog',
  children,
}: {
  label: string
  onClose: () => void
  className?: string
  role?: 'dialog' | 'alertdialog'
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // The page's own Esc handlers (the player) don't see it.
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // In <body>: page sections have stacking contexts of their own that would cover it.
  return createPortal(
    <div className="modal-backdrop" onClick={(e) => (e.stopPropagation(), onClose())}>
      <div className={`modal glass-strong ${className}`} role={role} aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** «Удалить …?» with what it means, a destructive confirm and «Отмена». */
export function ConfirmDialog({
  title,
  message,
  confirm,
  onConfirm,
  onCancel,
}: {
  title: string
  message?: string
  confirm: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const textId = useId()
  return (
    <Modal label={title} onClose={onCancel} role="alertdialog">
      <div className="modal-title">{title}</div>
      {message && (
        <p className="muted" id={textId}>
          {message}
        </p>
      )}
      <div className="modal-actions">
        <button className="btn btn-danger wide" onClick={onConfirm}>
          {confirm}
        </button>
        <button className="btn btn-secondary wide" autoFocus onClick={onCancel}>
          Отмена
        </button>
      </div>
    </Modal>
  )
}

/** A message with «OK» (a refused deletion and why). */
export function AlertDialog({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  return (
    <Modal label={title} onClose={onClose} role="alertdialog">
      <div className="modal-title">{title}</div>
      <p className="muted">{message}</p>
      <div className="modal-actions">
        <button className="btn btn-primary wide" autoFocus onClick={onClose}>
          OK
        </button>
      </div>
    </Modal>
  )
}
