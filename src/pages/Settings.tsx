import { useEffect, useId, useState, type ComponentType, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { appModel } from '../app/appModel'
import { useApp } from '../app/hooks'
import { APP_NAME, APP_VERSION } from '../config'
import { DetectorClient, normalizeDetectorURL } from '../core/detectorClient'
import { skipModes, skipModeTitle, type SkipMode } from '../core/skipPolicy'
import { Language } from '../core/mediaTrack'
import { catalogHubs } from '../core/plexDiscover'
import {
  countdownOptions,
  defaultDetectorURL,
  hasDefaultShelfOrder,
  homeShelfOrder,
  hubShown,
  seekBackOptions,
  seekForwardOptions,
  settingsStore,
  shelfInfo,
  shelfShown,
  useSettings,
} from '../settings'
import { useRecommendations } from '../app/hooks'
import { BackIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, ForwardEndIcon, HomeIcon, PlayIcon, ServerIcon } from '../ui/icons'

/** Pages of the settings screen, the same in every Loge app (ids as in the Apple app). */
const settingsPages: { id: string; title: string; icon: ComponentType<{ size?: number }>; content: ComponentType }[] = [
  { id: 'playback', title: 'Плеер', icon: PlayIcon, content: PlaybackSettings },
  // «Главная» and «Обзор» share a page, a section each.
  { id: 'home', title: 'Главная и Обзор', icon: HomeIcon, content: HomeSettings },
  { id: 'detector', title: 'Loge Server', icon: ForwardEndIcon, content: DetectorSettings },
  { id: 'server', title: 'Сервер и аккаунт', icon: ServerIcon, content: ServerSettings },
]

/** Opened from the list: «Настройки» goes back in history, so browser Back lands on the list too. */
interface FromList {
  fromList?: boolean
}

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

function Section({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section">
      {title && <h2>{title}</h2>}
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

function Toggle({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const detailId = useId()
  return (
    <label className="settings-row toggle">
      <span className="settings-text">
        <span>{label}</span>
        {detail && (
          <span className="settings-detail" id={detailId}>
            {detail}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        aria-describedby={detail ? detailId : undefined}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
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
  const text = status === 'checking' ? 'Проверяю…' : status === 'ok' ? 'Loge Server отвечает' : 'Loge Server недоступен'
  return <span className={`status status-${status}`}>{text}</span>
}

/** The settings screen: a list of pages, the version below it. */
export function SettingsPage() {
  return (
    <div className="settings page-inset">
      <h1>Настройки</h1>
      <Section>
        <nav aria-label="Разделы настроек">
          {settingsPages.map(({ id, title, icon: Icon }) => (
            <Link key={id} to={`/settings/${id}`} state={{ fromList: true } satisfies FromList} className="settings-row settings-link">
              <span className="settings-icon">
                <Icon size={18} />
              </span>
              <span className="grow">{title}</span>
              <ChevronRightIcon size={18} />
            </Link>
          ))}
        </nav>
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

/** One page of settings (`#/settings/<id>`), with a way back to the list. */
export function SettingsSubpage() {
  const { page: id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const page = settingsPages.find((p) => p.id === id)
  if (!page) return <Navigate to="/settings" replace />
  const fromList = (location.state as FromList | null)?.fromList
  const Content = page.content
  return (
    <div className="settings page-inset">
      <button
        className="settings-back"
        onClick={() => (fromList ? navigate(-1) : navigate('/settings', { replace: true }))}
      >
        <BackIcon size={18} /> Настройки
      </button>
      <h1>{page.title}</h1>
      <Content />
    </div>
  )
}

/** «Предпочитаемый язык»: the footer, same as the Apple apps. */
export const LanguageText = {
  footer:
    'Озвучка выбирается на этом языке — лучшая по качеству (5.1 лучше стерео). На нём же ищется трейлер. Озвучка, выбранная в плеере, запоминается для сериала и главнее этой настройки.',
}

function PlaybackSettings() {
  const settings = useSettings()
  return (
    <>
      <Section title="Язык" footer={LanguageText.footer}>
        <label className="settings-row">
          <span>Предпочитаемый язык</span>
          <select
            aria-label="Предпочитаемый язык"
            value={settings.preferredLanguage}
            onChange={(e) => settingsStore.update({ preferredLanguage: e.target.value })}
          >
            {Language.choices.map((code) => (
              <option key={code} value={code}>
                {Language.name(code)}
              </option>
            ))}
          </select>
        </label>
      </Section>

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
        title="Транскодирование"
        footer="Если файл в этом браузере играет с ошибками, включите — сервер Plex будет готовить поток сам. Действует со следующего запуска видео."
      >
        <Toggle
          label="Всегда через сервер (транскодирование)"
          checked={settings.forceTranscode}
          onChange={(forceTranscode) => settingsStore.update({ forceTranscode })}
        />
      </Section>
    </>
  )
}

/** Texts of the «Главная и Обзор» page (same as the Apple apps, the moving hint is the web's). */
export const HomeSettingsText = {
  moveShelf: 'Порядок полок — как на Главной: переставьте полку стрелками ↑ и ↓ слева.',
  footer: 'В пустом поиске список Plex виден всегда. Рекомендации TMDB приходят через детектор: без него или без ключа TMDB на нём их нет.',
  tmdbMissing:
    'Детектор ответил, что ключа TMDB на нём нет: полок «Похожее на сервере» и «Потому что вы смотрели…» не будет, пока на нём не задан TMDB_API_KEY.',
  resetOrder: 'Вернуть порядок по умолчанию',
  exploreFooter: 'Готовые подборки каталога Plex на странице «Обзор». Если выключить все, она пропадёт.',
}

function HomeSettings() {
  const settings = useSettings()
  const { sections } = useApp()
  const { unavailable } = useRecommendations()
  const order = homeShelfOrder(settings, sections)
  return (
    <>
      <Section
        title="Полки Главной"
        footer={
          <>
            {HomeSettingsText.moveShelf}
            <br />
            <br />
            {HomeSettingsText.footer}
            {unavailable && (
              <>
                <br />
                <br />
                {HomeSettingsText.tmdbMissing}
              </>
            )}
          </>
        }
      >
        {order.map((id, index) => {
          const { title, detail } = shelfInfo(id, sections)
          return (
            <div key={id} className="settings-row shelf-setting">
              <div className="move-buttons">
                <button
                  className="move-button"
                  aria-label={`«${title}» выше`}
                  title="Выше"
                  disabled={index === 0}
                  onClick={() => settingsStore.moveShelf(id, -1, sections)}
                >
                  <ChevronUpIcon size={18} />
                </button>
                <button
                  className="move-button"
                  aria-label={`«${title}» ниже`}
                  title="Ниже"
                  disabled={index === order.length - 1}
                  onClick={() => settingsStore.moveShelf(id, 1, sections)}
                >
                  <ChevronDownIcon size={18} />
                </button>
              </div>
              <Toggle label={title} detail={detail} checked={shelfShown(settings, id)} onChange={(shown) => settingsStore.setShelfShown(id, shown)} />
            </div>
          )
        })}
      </Section>
      <Section>
        <button
          className="settings-row action"
          disabled={hasDefaultShelfOrder(settings, sections)}
          onClick={() => settingsStore.resetShelfOrder()}
        >
          {HomeSettingsText.resetOrder}
        </button>
      </Section>
      <Section title="Подборки «Обзора»" footer={HomeSettingsText.exploreFooter}>
        {catalogHubs.map((hub) => (
          <Toggle
            key={hub.id}
            label={hub.title}
            detail={hub.detail}
            checked={hubShown(settings, hub.id)}
            onChange={(shown) => settingsStore.setHubShown(hub.id, shown)}
          />
        ))}
      </Section>
    </>
  )
}

function DetectorSettings() {
  const settings = useSettings()
  const { api } = useApp()
  const [detectorDraft, setDetectorDraft] = useState(settings.detectorURL)
  return (
    <Section footer="Сервис, который находит заставки и титры. Если он недоступен, видео просто играет без пропуска.">
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
          aria-label="Адрес Loge Server"
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
          Сбросить адрес Loge Server
        </button>
      </div>
    </Section>
  )
}

function ServerSettings() {
  const settings = useSettings()
  const { server, api } = useApp()
  const candidates = server ? appModel.candidates(server) : []
  return (
    <>
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
    </>
  )
}
