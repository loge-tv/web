import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { appModel } from '../app/appModel'
import { deletionItems, deletionMessage, deletionTitle, DeletionText, type Deletion } from '../core/deletion'
import { AlertDialog, ConfirmDialog } from './dialog'

/**
 * Deleting downloads from a page: `ask` shows «Удалить …?» with what it means; «Удалить» sends it
 * to the server (Plex's DELETE), a refusal says why. `onDeleted` runs once all went.
 */
export function useDeletion(onDeleted?: (deletion: Deletion) => void) {
  const [pending, setPending] = useState<Deletion>()
  const [error, setError] = useState<string>()
  const [deleting, setDeleting] = useState(false)

  const perform = async (deletion: Deletion) => {
    setPending(undefined)
    setDeleting(true)
    const message = await appModel.delete(deletionItems(deletion))
    setDeleting(false)
    if (message) setError(message)
    else onDeleted?.(deletion)
  }

  const dialogs = (
    <>
      {pending && (
        <ConfirmDialog
          title={deletionTitle(pending)}
          message={deletionMessage(pending)}
          confirm="Удалить"
          onConfirm={() => void perform(pending)}
          onCancel={() => setPending(undefined)}
        />
      )}
      {error && <AlertDialog title={DeletionText.alertTitle} message={error} onClose={() => setError(undefined)} />}
      {deleting && (
        <div className="busy-overlay">
          <div className="spinner" role="progressbar" aria-label="Удаление…" />
        </div>
      )}
    </>
  )
  return { ask: setPending, deleting, dialogs }
}

/** Back where the page was opened from (a link opened in a new tab: Home). */
export function useLeave() {
  const navigate = useNavigate()
  return useCallback(() => {
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (index > 0) navigate(-1)
    else navigate('/', { replace: true })
  }, [navigate])
}
