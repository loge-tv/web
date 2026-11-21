import { useEffect, useState, type ReactNode } from 'react'
import { appModel } from '../app/appModel'
import { useApp } from '../app/hooks'
import { APP_NAME, APP_VERSION } from '../config'
import { DetectorClient, normalizeDetectorURL } from '../core/detectorClient'
import { skipModes, skipModeTitle, type SkipMode } from '../core/skipPolicy'
import {
  countdownOptions,
  defaultDetectorURL,
  seekBackOptions,
  seekForwardOptions,
  settingsStore,
  useSettings,
} from '../settings'
import { CheckIcon } from '../ui/icons'

function skipFooter(mode: SkipMode): string {
  switch (mode) {
    case 'auto':
      return 'Заставки и титры пропускаются сами. В первой серии сезона вместо этого показывается кнопка «Пропустить».'
    case 'countdown':
      return 'За 5 секунд до заставки появляется отсчёт с кнопкой «Не пропускать», и заставка пропускается, как только начнётся. Так же — в первой серии сезона. На финальных титрах — карточка «Следующая серия».'
    case 'button':
      return 'Во время заставки и титров показывается кнопка «Пропустить».'
    case 'off':
      return 'Ничего не пропускается.'
  }
}

function Section({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      <div className="settings-group">{children}</div>
      {footer && <p className="settings-footer">{footer}</p>}
    </section>
  )
}

/** One row per option with a checkmark on the selected one (like the tvOS app). */
function Choices<T extends string | number>({
  options,
  value,
  title,
  onChange,
  name,
}: {
  options: T[]
  value: T
  title: (v: T) => string
  onChange: (v: T) => void
  name: string
}) {
  return (
    <div role="radiogroup" aria-label={name}>
      {options.map((option) => (
        <button
          key={String(option)}
          role="radio"
          aria-checked={option === value}
          className="settings-row choice"
          onClick={() => onChange(option)}
        >
          <span>{title(option)}</span>
          {option === value && <CheckIcon size={18} />}
        </button>
      ))}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="settings-row toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  )
}

function DetectorStatus({ url, token }: { url: string; token?: string }) {
  const [status, setStatus] = useState<'checking' | 'ok' | 'down'>('checking')
  useEffect(() => {
    let cancelled = false
    setStatus('checking')
    const client = new DetectorClient(normalizeDetectorURL(url), token ?? '')
    const timer = setTimeout(() => {
      void client.isReachable().then((ok) => {
        if (!cancelled) setStatus(ok ? 'ok' : 'down')
      })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [url, token])
  const text = status === 'checking' ? 'Проверяю…' : status === 'ok' ? 'Детектор отвечает' : 'Детектор недоступен'
  return <span className={`status status-${status}`}>{text}</span>
}

export function SettingsPage() {
  const settings = useSettings()
  const { server, api } = useApp()
  const [detectorDraft, setDetectorDraft] = useState(settings.detectorURL)
  const candidates = server ? appModel.candidates(server) : []

  return (
    <div className="settings page-inset">
      <h1>Настройки</h1>

      <Section
        title="Пропуск заставок и титров"
        footer={
          <>
            {skipFooter(settings.skipMode)}
            <br />
            <br />
            Если пропуск срабатывает чуть раньше или позже, чем нужно, поправьте разметку в плеере: кнопка дорожек → «Разметка
            сериала». Поправка и выбранная озвучка запоминаются для каждого сериала.
          </>
        }
      >
        <Choices
          name="Пропуск"
          options={skipModes}
          value={settings.skipMode}
          title={skipModeTitle}
          onChange={(skipMode) => settingsStore.update({ skipMode })}
        />
      </Section>

      <Section title="Следующая серия">
        <Toggle label="Включать автоматически" checked={settings.autoplayNext} onChange={(autoplayNext) => settingsStore.update({ autoplayNext })} />
      </Section>

      <Section title="Отсчёт до следующей серии">
        <Choices
          name="Отсчёт"
          options={countdownOptions}
          value={settings.nextEpisodeCountdown}
          title={(v) => `${v} с`}
          onChange={(nextEpisodeCountdown) => settingsStore.update({ nextEpisodeCountdown })}
        />
      </Section>

      <Section title="Перемотка" footer="Шаг для клавиш ← и → и кнопок перемотки в плеере.">
        <div className="settings-row">
          <span>Назад</span>
          <select value={settings.seekBack} onChange={(e) => settingsStore.update({ seekBack: Number(e.target.value) })}>
            {seekBackOptions.map((v) => (
              <option key={v} value={v}>
                {v} с
              </option>
            ))}
          </select>
        </div>
        <div className="settings-row">
          <span>Вперёд</span>
          <select value={settings.seekForward} onChange={(e) => settingsStore.update({ seekForward: Number(e.target.value) })}>
            {seekForwardOptions.map((v) => (
              <option key={v} value={v}>
                {v} с
              </option>
            ))}
          </select>
        </div>
      </Section>

      <Section
        title="Детектор заставок"
        footer="Сервис, который находит заставки и титры. Если он недоступен, видео просто играет без пропуска."
      >
        <form
          className="settings-row input-row"
          onSubmit={(e) => {
            e.preventDefault()
            settingsStore.update({ detectorURL: normalizeDetectorURL(detectorDraft) })
            setDetectorDraft(normalizeDetectorURL(detectorDraft))
          }}
        >
          <input
            type="url"
            aria-label="Адрес детектора"
            value={detectorDraft}
            onChange={(e) => setDetectorDraft(e.target.value)}
            onBlur={() => settingsStore.update({ detectorURL: normalizeDetectorURL(detectorDraft) })}
            spellCheck={false}
            autoCapitalize="off"
          />
        </form>
        <div className="settings-row">
          <DetectorStatus url={settings.detectorURL} token={api?.token} />
          <button
            className="link-button"
            onClick={() => {
              setDetectorDraft(defaultDetectorURL)
              settingsStore.update({ detectorURL: defaultDetectorURL })
            }}
          >
            Сбросить адрес детектора
          </button>
        </div>
      </Section>

      <Section
        title="Плеер"
        footer="Если файл в этом браузере играет с ошибками, включите — сервер Plex будет готовить поток сам. Действует со следующего запуска видео."
      >
        <Toggle
          label="Всегда через сервер (транскодирование)"
          checked={settings.forceTranscode}
          onChange={(forceTranscode) => settingsStore.update({ forceTranscode })}
        />
      </Section>

      <Section title="Сервер">
        <div className="settings-row">
          <span>Сервер</span>
          <span className="muted">{server?.name ?? '—'}</span>
        </div>
        <div className="settings-row">
          <span>Подключение</span>
          <span className="muted ellipsis">{api?.baseURL ?? '—'}</span>
        </div>
      </Section>

      {server && (
        <Section
          title="Адрес сервера"
          footer={
            window.location.protocol === 'https:'
              ? 'Страница открыта по HTTPS, поэтому доступны только HTTPS-адреса сервера.'
              : undefined
          }
        >
          <Choices
            name="Адрес сервера"
            options={['', ...candidates]}
            value={candidates.includes(settings.preferredConnection) ? settings.preferredConnection : ''}
            title={(v) => (v === '' ? 'Автоматически' : v)}
            onChange={(preferredConnection) => settingsStore.update({ preferredConnection })}
          />
          <button className="settings-row action" onClick={() => void appModel.connect(server)}>
            Переподключиться
          </button>
        </Section>
      )}

      <Section title="Аккаунт">
        <button className="settings-row action" onClick={() => void appModel.switchServer()}>
          Сменить сервер
        </button>
        <button className="settings-row action destructive" onClick={() => appModel.logout()}>
          Выйти из аккаунта Plex
        </button>
      </Section>

      <Section title="О приложении">
        <div className="settings-row">
          <span>Версия</span>
          <span className="muted">
            {APP_NAME} {APP_VERSION}
          </span>
        </div>
      </Section>
    </div>
  )
}
