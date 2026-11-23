import { trackDisplayName } from '../core/mediaTrack'
import { TimeFormat } from '../core/progressTracker'
import { correctionFields, type CorrectionField } from '../core/skipCorrection'
import { CheckIcon, CloseIcon } from '../ui/icons'
import type { PlayerSession, PlayerSnapshot } from './playerSession'

const fieldTitle: Record<CorrectionField, string> = {
  introStart: 'Начало заставки',
  introEnd: 'Конец заставки',
  creditsStart: 'Начало титров',
  creditsEnd: 'Конец титров',
}

/** "0 с", "−2 с", "+2 с" (as on tvOS). */
export function formatOffset(seconds: number): string {
  const value = Math.round(seconds)
  if (value === 0) return '0 с'
  return value < 0 ? `−${-value} с` : `+${value} с`
}

/** "Заставка 0:20–0:45 · Титры 41:10–43:00", with the correction applied. */
export function segmentsSummary(s: PlayerSnapshot): string {
  const parts = s.segments.flatMap((segment) => {
    const name = segment.type === 'intro' ? 'Заставка' : segment.type === 'credits' ? 'Титры' : undefined
    return name ? [`${name} ${TimeFormat.clock(segment.start)}–${TimeFormat.clock(segment.end)}`] : []
  })
  if (s.loading && parts.length === 0) return 'Загрузка разметки…'
  return parts.length === 0 ? 'В этой серии Loge Server ничего не нашёл' : parts.join(' · ')
}

/** Side panel: audio, subtitles and the show's skip correction. */
export function TracksPanel({ session, snapshot: s, onClose }: { session: PlayerSession; snapshot: PlayerSnapshot; onClose: () => void }) {
  return (
    <aside className="tracks-panel glass-strong" aria-label="Дорожки и разметка" onPointerUp={(e) => e.stopPropagation()}>
      <button className="icon-button panel-close" onClick={onClose} aria-label="Закрыть">
        <CloseIcon size={22} />
      </button>

      <h3>Аудио</h3>
      {s.audioTracks.length === 0 && <p className="muted">Нет дорожек</p>}
      {s.audioTracks.map((track) => (
        <button key={track.id} className="panel-row" aria-pressed={s.selectedAudio === track.id} onClick={() => session.selectAudio(track)}>
          <span className="ellipsis">{trackDisplayName(track)}</span>
          {s.selectedAudio === track.id && <CheckIcon size={18} />}
        </button>
      ))}

      <h3>Субтитры</h3>
      <button className="panel-row" aria-pressed={s.selectedSubtitle === undefined} onClick={() => session.selectSubtitle(undefined)}>
        <span>Выключены</span>
        {s.selectedSubtitle === undefined && <CheckIcon size={18} />}
      </button>
      {s.subtitleTracks.map((track) => (
        <button key={track.id} className="panel-row" aria-pressed={s.selectedSubtitle === track.id} onClick={() => session.selectSubtitle(track)}>
          <span className="ellipsis">{trackDisplayName(track)}</span>
          {s.selectedSubtitle === track.id && <CheckIcon size={18} />}
        </button>
      ))}

      <h3>{s.item.type === 'episode' ? 'Разметка сериала' : 'Разметка'}</h3>
      <p className="muted tabular" data-testid="segments-summary">
        {segmentsSummary(s)}
      </p>
      {correctionFields.map((field) => (
        <div key={field} className="offset-row">
          <span>{fieldTitle[field]}</span>
          <button
            className="offset-button"
            onClick={() => session.adjustCorrection(field, -1)}
            aria-label={`${fieldTitle[field]} раньше`}
          >
            −
          </button>
          <span className="offset-value" data-testid={`offset-${field}`}>
            {formatOffset(s.correction[field])}
          </span>
          <button
            className="offset-button"
            onClick={() => session.adjustCorrection(field, 1)}
            aria-label={`${fieldTitle[field]} позже`}
          >
            +
          </button>
        </div>
      ))}
      <p className="muted small">
        Сдвиг относительно разметки Loge Server, для всех серий. Начало — когда срабатывает пропуск или отсчёт, конец — куда перематывается
        видео.
      </p>
      {s.plan && <p className="muted small plan-note">{s.plan.reason}</p>}
    </aside>
  )
}
