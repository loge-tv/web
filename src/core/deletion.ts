import { HTTPError } from './http'
import type { PlexItem } from './plexModels'

// Texts of SkipTV's AppModel.swift (DeletionText, Deletion).

/** Texts about deleting downloads from the server. */
export const DeletionText = {
  failed(error: unknown): string {
    // Which status a server with deletion off answers is not known for sure: the hint goes with
    // any refusal.
    if (error instanceof HTTPError)
      return `Plex не удалил (ошибка ${error.status}). Удалять может только владелец сервера, и в настройках Plex Media Server должно быть включено «Библиотека → Разрешить удаление медиафайлов» (Library → Allow media deletion).`
    return 'Не удалось удалить: нет связи с сервером.'
  },

  partly(failed: number, total: number): string {
    return `Не удалось удалить ${failed} из ${total}.`
  },

  /** «С диска сервера удалится 21 серия.», «…удалятся 3 серии.», «…удалятся 8 серий.» */
  episodesGo(count: number): string {
    const mod10 = count % 10
    const mod100 = count % 100
    const one = mod10 === 1 && mod100 !== 11
    const word = one ? 'серия' : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? 'серии' : 'серий'
    return `С диска сервера ${one ? 'удалится' : 'удалятся'} ${count} ${word}.`
  },

  /** The title of the alert after a refusal. */
  alertTitle: 'Не удалось удалить',
}

/** A deletion waiting for its confirmation. */
export type Deletion =
  | { kind: 'movie'; item: PlexItem }
  | { kind: 'show'; item: PlexItem }
  | { kind: 'season'; item: PlexItem }
  | { kind: 'episode'; item: PlexItem }
  | { kind: 'watched'; items: PlexItem[] }

export function deletionItems(deletion: Deletion): PlexItem[] {
  return deletion.kind === 'watched' ? deletion.items : [deletion.item]
}

export function deletionTitle(deletion: Deletion): string {
  switch (deletion.kind) {
    case 'movie':
    case 'show':
    case 'season':
      return `Удалить «${deletion.item.title}»?`
    case 'episode':
      return `Удалить серию «${deletion.item.title}»?`
    case 'watched':
      return 'Удалить просмотренные серии?'
  }
}

export function deletionMessage(deletion: Deletion): string {
  switch (deletion.kind) {
    case 'movie':
      return 'Файл фильма удалится с диска сервера. Отменить это нельзя.'
    case 'show': {
      const count = deletion.item.leafCount
      return `Все скачанные серии${count !== undefined ? ` (${count})` : ''} удалятся с диска сервера. Отменить это нельзя.`
    }
    case 'season': {
      const count = deletion.item.leafCount
      return `${count !== undefined ? DeletionText.episodesGo(count) : 'Серии сезона удалятся с диска сервера.'} Отменить это нельзя.`
    }
    case 'episode':
      return 'Файл серии удалится с диска сервера. Отменить это нельзя.'
    case 'watched':
      return `${DeletionText.episodesGo(deletion.items.length)} Отменить это нельзя.`
  }
}
