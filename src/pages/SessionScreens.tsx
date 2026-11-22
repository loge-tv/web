import { appModel, type Phase } from '../app/appModel'
import { APP_NAME } from '../config'
import type { PlexServer } from '../core/plexAccount'
import { Wordmark } from '../ui/icons'

export function LoginScreen({ phase }: { phase: Extract<Phase, { kind: 'login' }> }) {
  return (
    <div className="session-screen">
      <div className="session-card">
        <div className="logo big" role="img" aria-label={APP_NAME}>
          <Wordmark height={40} />
        </div>
        <h1>Войдите через аккаунт Plex</h1>
        <p className="muted">
          Откроется страница Plex: войдите в аккаунт и разрешите доступ, после этого вы вернётесь сюда. Пароль от Plex
          {` ${APP_NAME}`} не видит.
        </p>
        {phase.error && <p className="error-text">{phase.error}</p>}
        {phase.waiting ? (
          <div className="row gap center">
            <div className="spinner small" />
            <span className="muted">Жду подтверждения от Plex…</span>
            <button className="btn btn-secondary" onClick={() => appModel.cancelLogin()}>
              Отмена
            </button>
          </div>
        ) : (
          <button className="btn btn-primary wide" onClick={() => void appModel.beginLogin()}>
            Войти через Plex
          </button>
        )}
      </div>
    </div>
  )
}

export function ServerPicker({ servers }: { servers: PlexServer[] }) {
  return (
    <div className="session-screen">
      <div className="session-card">
        <h1>Выберите сервер</h1>
        {servers.length === 0 && <p className="muted">В аккаунте нет доступных серверов Plex.</p>}
        <div className="server-list">
          {servers.map((server) => (
            <button key={server.clientIdentifier} className="server-row" onClick={() => void appModel.choose(server)}>
              <span>{server.name}</span>
              {server.owned && <span className="muted">Мой</span>}
            </button>
          ))}
        </div>
        <div className="row gap">
          <button className="btn btn-secondary" onClick={() => void appModel.loadServers()}>
            Обновить
          </button>
          <button className="btn btn-secondary" onClick={() => appModel.logout()}>
            Выйти
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Launch and connecting screen: the wordmark fades in, then a tilted band of light sweeps across
 * the dimmed letters (1.1 s sweep, 0.9 s rest). Without `text` the line stays empty so the logo
 * doesn't jump when it appears.
 */
export function SplashScreen({ text }: { text?: string }) {
  return (
    <div className="session-screen splash" role="status" aria-label={text ?? APP_NAME}>
      <div className="splash-logo" aria-hidden="true">
        <Wordmark height={64} className="splash-base" />
        <Wordmark height={64} className="splash-shine" />
      </div>
      <p className="muted splash-text">{text ?? '\u00a0'}</p>
    </div>
  )
}

export function FailedScreen({ message }: { message: string }) {
  return (
    <div className="session-screen">
      <div className="session-card">
        <p>{message}</p>
        <div className="row gap wrap">
          <button className="btn btn-primary" onClick={() => void appModel.retry()}>
            Повторить
          </button>
          <button className="btn btn-secondary" onClick={() => void appModel.switchServer()}>
            Выбрать сервер
          </button>
          <button className="btn btn-secondary" onClick={() => appModel.logout()}>
            Выйти
          </button>
        </div>
      </div>
    </div>
  )
}
