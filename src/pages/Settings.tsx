import { useEffect, useId, useState, type ComponentType, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { appModel } from '../app/appModel'
import { useApp } from '../app/hooks'
import tmdbLogo from '../assets/tmdb-logo.svg'
import { APP_NAME, APP_VERSION } from '../config'
import { normalizeSepiaServerURL } from '../core/sepiaServerClient'
import { statusText, type Verdict } from '../core/sepiaServer'
import { skipModes, skipModeTitle, type SkipMode } from '../core/skipPolicy'
import { Language } from '../core/mediaTrack'
import { catalogHubs } from '../core/plexDiscover'
import {
  countdownOptions,
  exploreHubOrder,
  hasDefaultHubOrder,
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
import { SepiaServerAddressForm, SepiaServerFinder } from './SepiaServerConnect'
import { BackIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, ForwardEndIcon, HomeIcon, PlayIcon, ServerIcon } from '../ui/icons'

/** Pages of the settings screen, the same in every app of the family (ids as in the Apple app). */
const settingsPages: { id: string; title: string; icon: ComponentType<{ size?: number }>; content: ComponentType }[] = [
  { id: 'playback', title: 'Плеер', icon: PlayIcon, content: PlaybackSettings },
  // «Главная» and «Обзор» share a page, a section each.
  { id: 'home', title: 'Главная и Обзор', icon: HomeIcon, content: HomeSettings },
  { id: 'sepia-server', title: 'Sepia Server', icon: ForwardEndIcon, content: SepiaServerSettings },
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
      return 'За 5 секунд до заставки появляется отсчёт с кнопкой «Не пропускать», и заставка пропускается, как только начнётся. Так же — в первой серии сезона. Перед финальными титрами — карточка «Следующая серия» с отсчётом.'
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

/** Whether the kept Sepia Server answers for this Plex server and takes its token. */
function SepiaServerStatus({ url }: { url: string }) {
  const { api, server } = useApp()
  const [round, setRound] = useState(0)
  const base = normalizeSepiaServerURL(url)
  // A new address (or «Проверить снова») drops the old state at once and is checked right away;
  // a late answer about an earlier check is thrown away.
  const [checked, setChecked] = useState<{ url: string; round: number; verdict: Verdict } | undefined>()
  useEffect(() => {
    if (!base || !api || !server) return
    let cancelled = false
    // Kept already: the user agreed to this address.
    void appModel.checkSepiaServer(base, true).then((verdict) => {
      if (!cancelled) setChecked({ url: base, round, verdict })
    })
    return () => {
      cancelled = true
    }
  }, [base, api, server, round])
  if (!base) return <span className="status">Не задан</span>
  const verdict = checked?.url === base && checked.round === round ? checked.verdict : undefined
  const state = !verdict ? 'checking' : verdict.kind === 'ok' ? 'ok' : 'down'
  return (
    <>
      <span className={`status status-${state}`} role="status">
        {statusText(verdict, server?.name ?? '')}
      </span>
      {/* Not when connected, and not for an address the browser won't ask (agreed with Apple). */}
      {verdict && verdict.kind !== 'ok' && verdict.kind !== 'blocked' && (
        <button className="btn btn-secondary" onClick={() => setRound((n) => n + 1)}>
          Проверить снова
        </button>
      )}
    </>
  )
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
      <Section title="О приложении" footer={<TMDBNotice />}>
        <div className="settings-row">
          <span>Версия</span>
          <span className="muted">
            {APP_NAME} {APP_VERSION}
          </span>
        </div>
        <div className="settings-row">
          <span>Рекомендации и трейлеры</span>
          <img className="tmdb-logo" src={tmdbLogo} alt="TMDB" />
        </div>
      </Section>
    </div>
  )
}

/**
 * TMDB's terms (§3) want this sentence, word for word, with one of their logos (as it is, less
 * prominent than the app's own) in an "About" or "Credits" section: titles, recommendations and
 * trailers come from TMDB through the TMDB proxy. The logo is in the bundle, nothing is loaded from TMDB.
 */
function TMDBNotice() {
  return (
    <>
      <span lang="en">This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.</span>{' '}
      Sepia TV использует TMDB и API TMDB, но не одобрен, не сертифицирован и никак иначе не утверждён TMDB.
    </>
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

      <Section title="Отсчёт до следующей серии" footer={PlaybackSettingsText.nextEpisodeCountdownFooter}>
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

/** Texts of the «Плеер» page (same as the Apple apps). */
const PlaybackSettingsText = {
  nextEpisodeCountdownFooter:
    'Отсчёт идёт перед финальными титрами: как только они начинаются, включается следующая серия. «Титры» на карточке отменяет его. Без автоматического включения карточка ждёт на титрах.',
}

/** Texts of the «Главная и Обзор» page (same as the Apple apps, the moving hint is the web's). */
export const HomeSettingsText = {
  moveShelf: 'Порядок полок — как на Главной: переставьте полку стрелками ↑ и ↓ слева.',
  footer: 'В пустом поиске список Plex виден всегда.',
  resetOrder: 'Вернуть порядок по умолчанию',
  moveHub: 'Порядок подборок — как в «Обзоре»: переставьте подборку стрелками ↑ и ↓ слева.',
  resetHubOrder: 'Вернуть порядок подборок по умолчанию',
  exploreFooter: 'Готовые подборки каталога Plex на странице «Обзор». Если выключить все, она пропадёт.',
}

function HomeSettings() {
  const settings = useSettings()
  const { sections } = useApp()
  const order = homeShelfOrder(settings, sections)
  const hubs = exploreHubOrder(settings)
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
          </>
        }
      >
        {order.map((id, index) => {
          const { title, detail } = shelfInfo(id, sections)
          return (
            <MovableRow
              key={id}
              className="shelf-setting"
              title={title}
              detail={detail}
              first={index === 0}
              last={index === order.length - 1}
              onMove={(offset) => settingsStore.moveShelf(id, offset, sections)}
              checked={shelfShown(settings, id)}
              onChange={(shown) => settingsStore.setShelfShown(id, shown)}
            />
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
      <Section
        title="Подборки «Обзора»"
        footer={
          <>
            {HomeSettingsText.moveHub}
            <br />
            <br />
            {HomeSettingsText.exploreFooter}
          </>
        }
      >
        {hubs.map((id, index) => {
          const hub = catalogHubs.find((h) => h.id === id)!
          return (
            <MovableRow
              key={id}
              className="hub-setting"
              title={hub.title}
              detail={hub.detail}
              first={index === 0}
              last={index === hubs.length - 1}
              onMove={(offset) => settingsStore.moveHub(id, offset)}
              checked={hubShown(settings, id)}
              onChange={(shown) => settingsStore.setHubShown(id, shown)}
            />
          )
        })}
      </Section>
      <Section>
        <button className="settings-row action" disabled={hasDefaultHubOrder(settings)} onClick={() => settingsStore.resetHubOrder()}>
          {HomeSettingsText.resetHubOrder}
        </button>
      </Section>
    </>
  )
}

/** A shelf or a collection: ↑ and ↓ move it among its own list, the switch turns it on or off. */
function MovableRow({
  className,
  title,
  detail,
  first,
  last,
  onMove,
  checked,
  onChange,
}: {
  className: string
  title: string
  detail: string
  first: boolean
  last: boolean
  onMove: (offset: number) => void
  checked: boolean
  onChange: (shown: boolean) => void
}) {
  return (
    <div className={`settings-row movable-setting ${className}`}>
      <div className="move-buttons">
        <button className="move-button" aria-label={`«${title}» выше`} title="Выше" disabled={first} onClick={() => onMove(-1)}>
          <ChevronUpIcon size={18} />
        </button>
        <button className="move-button" aria-label={`«${title}» ниже`} title="Ниже" disabled={last} onClick={() => onMove(1)}>
          <ChevronDownIcon size={18} />
        </button>
      </div>
      <Toggle label={title} detail={detail} checked={checked} onChange={onChange} />
    </div>
  )
}

function SepiaServerSettings() {
  const settings = useSettings()
  const [finding, setFinding] = useState(0)
  return (
    <Section footer="Адрес вашего Sepia Server: с ним заставки и титры находятся точнее. Без него они берутся из глав файла и TheIntroDB.">
      <div className="settings-row">
        <span className="grow sepia-address">{settings.sepiaServerURL || 'Sepia Server'}</span>
        <SepiaServerStatus url={settings.sepiaServerURL} />
      </div>
      <div className="settings-row sepia-settings">
        {finding > 0 && <SepiaServerFinder key={finding} />}
        <SepiaServerAddressForm key={settings.sepiaServerURL} initial={settings.sepiaServerURL} />
        <div className="row gap wrap">
          <button className="btn btn-secondary" onClick={() => setFinding((n) => n + 1)}>
            Найти
          </button>
          {settings.sepiaServerURL && (
            <button className="link-button" onClick={() => appModel.setSepiaServer('')}>
              Убрать адрес Sepia Server
            </button>
          )}
        </div>
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
