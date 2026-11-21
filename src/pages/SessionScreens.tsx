import { appModel, type Phase } from '../app/appModel'
import { APP_NAME } from '../config'
import type { PlexServer } from '../core/plexAccount'
import { Spinner } from '../ui/common'

export function LoginScreen({ phase }: { phase: Extract<Phase, { kind: 'login' }> }) {
  return (
    <div className="session-screen">
      <div className="session-card">
        <div className="logo big">{APP_NAME}</div>
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

export function ConnectingScreen({ text }: { text: string }) {
  return (
    <div className="session-screen">
      <Spinner label={text} />
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
