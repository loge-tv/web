import { useEffect, useState, type FormEvent } from 'react'
import { appModel } from '../app/appModel'
import { useApp } from '../app/hooks'
import { normalizeDetectorURL } from '../core/detectorClient'
import { verdictText, type Discovery, type Verdict } from '../core/sepiaServer'

/**
 * Connecting Sepia Server to the current Plex server: looking for it on Plex's hosts and typing
 * its address. Used by the «Подключите Sepia Server» step after connecting and by the settings.
 * An address is kept only once its /v1/info names this Plex server and it takes the token.
 * Strings agreed with the Apple and Android apps.
 */

/** Looks for Sepia Server on Plex's hosts once mounted (again on «Повторить»). */
export function SepiaServerFinder({ onNone }: { onNone?: () => void }) {
  const { server } = useApp()
  const [round, setRound] = useState(0)
  const [found, setFound] = useState<Discovery | undefined>()
  useEffect(() => {
    let cancelled = false
    setFound(undefined)
    void appModel.findSepiaServer().then((result) => {
      if (cancelled) return
      setFound(result)
      if (result.kind === 'none') onNone?.()
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per round
  }, [round])

  if (!found) {
    return (
      <div className="row gap" role="status">
        <div className="spinner small" />
        <span className="muted">Ищу Sepia Server…</span>
      </div>
    )
  }
  switch (found.kind) {
    case 'found':
      return (
        <div className="sepia-found">
          <p>Найден Sepia Server для «{server?.name}»</p>
          <p className="sepia-address">{found.url}</p>
          <ConnectButton url={found.url} />
        </div>
      )
    case 'pending':
      return (
        <div className="sepia-found">
          <p className="muted">{verdictText({ kind: 'pending' })}</p>
          <button className="btn btn-secondary" onClick={() => setRound((r) => r + 1)}>
            Повторить
          </button>
        </div>
      )
    case 'external':
      return <p className="muted">Sepia Server найден по адресу {found.url}, но вне домашней сети нужен адрес https:// (через обратный прокси).</p>
    case 'none':
      return <p className="muted">Sepia Server не найден. Введите его адрес.</p>
  }
}

/** «Подключить» for a found address: checked with the token, then kept. */
function ConnectButton({ url }: { url: string }) {
  const [checking, setChecking] = useState(false)
  const [verdict, setVerdict] = useState<Verdict | undefined>()
  const connect = async () => {
    setChecking(true)
    const result = await appModel.checkSepiaServer(url)
    setChecking(false)
    if (result.kind === 'ok') appModel.setSepiaServer(url)
    else setVerdict(result)
  }
  return (
    <>
      {verdict && <p className="error-text">{verdictText(verdict)}</p>}
      <button className="btn btn-primary" disabled={checking} onClick={() => void connect()}>
        Подключить
      </button>
    </>
  )
}

/**
 * The address typed by hand. An http address outside the home network is kept only after the
 * user agrees, and nothing with the token goes there before that.
 */
export function SepiaServerAddressForm({ initial = '' }: { initial?: string }) {
  const [draft, setDraft] = useState(initial)
  const [checking, setChecking] = useState(false)
  const [verdict, setVerdict] = useState<Verdict | undefined>()
  const [asked, setAsked] = useState<string | undefined>()

  const check = async (consented: boolean) => {
    const url = normalizeDetectorURL(draft)
    if (!url) {
      setVerdict({ kind: 'down' })
      return
    }
    setChecking(true)
    setVerdict(undefined)
    const result = await appModel.checkSepiaServer(url, consented)
    setChecking(false)
    if (result.kind === 'ok') {
      appModel.setSepiaServer(url)
      setAsked(undefined)
      setDraft(url)
      return
    }
    setAsked(result.kind === 'consent' ? url : undefined)
    setVerdict(result)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void check(false)
  }

  return (
    <div className="sepia-form">
      <form className="row gap" onSubmit={submit}>
        <input
          type="url"
          aria-label="Адрес Sepia Server"
          placeholder="http://192.168.1.10:32420"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setAsked(undefined)
            setVerdict(undefined)
          }}
          spellCheck={false}
          autoCapitalize="off"
        />
        <button className="btn btn-secondary" type="submit" disabled={checking || !!asked}>
          Подключить
        </button>
      </form>
      {checking && <p className="muted">Проверяю…</p>}
      {verdict && verdict.kind === 'consent' && asked ? (
        <div className="sepia-consent">
          <p className="error-text">{verdictText(verdict)}</p>
          <div className="row gap">
            <button className="btn btn-primary" onClick={() => void check(true)}>
              Подключить
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setAsked(undefined)
                setVerdict(undefined)
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : (
        verdict && (
          <div className="sepia-consent">
            <p className="error-text">{verdictText(verdict)}</p>
            {verdict.kind === 'pending' && (
              <button className="btn btn-secondary" onClick={() => void check(false)}>
                Повторить
              </button>
            )}
          </div>
        )
      )}
    </div>
  )
}

/** After connecting a Plex server that has no Sepia Server yet: find it, type it, or skip. */
export function SepiaServerStep() {
  const [manual, setManual] = useState(false)
  return (
    <div className="session-screen">
      <div className="session-card">
        <h1>Подключите Sepia Server</h1>
        <p className="muted">Sepia Server точнее находит заставки и титры и отдаёт видео вне дома. Его можно подключить и позже, в настройках.</p>
        <SepiaServerFinder onNone={() => setManual(true)} />
        {manual ? (
          <SepiaServerAddressForm />
        ) : (
          <button className="link-button" onClick={() => setManual(true)}>
            Ввести адрес вручную
          </button>
        )}
        <button className="btn btn-secondary wide" onClick={() => appModel.setSepiaServer('')}>
          Пропустить
        </button>
      </div>
    </div>
  )
}
