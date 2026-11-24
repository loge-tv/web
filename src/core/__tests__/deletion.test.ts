import { describe, expect, it } from 'vitest'
import { deletionItems, deletionMessage, deletionTitle, DeletionText } from '../deletion'
import { HTTPError } from '../http'
import { parseItem, type PlexItem } from '../plexModels'

const item = (raw: object): PlexItem => parseItem(raw)!

describe('deletion texts', () => {
  it('counts episodes in Russian', () => {
    expect(DeletionText.episodesGo(1)).toBe('С диска сервера удалится 1 серия.')
    expect(DeletionText.episodesGo(21)).toBe('С диска сервера удалится 21 серия.')
    expect(DeletionText.episodesGo(3)).toBe('С диска сервера удалятся 3 серии.')
    expect(DeletionText.episodesGo(8)).toBe('С диска сервера удалятся 8 серий.')
    expect(DeletionText.episodesGo(11)).toBe('С диска сервера удалятся 11 серий.')
    expect(DeletionText.episodesGo(12)).toBe('С диска сервера удалятся 12 серий.')
    expect(DeletionText.episodesGo(22)).toBe('С диска сервера удалятся 22 серии.')
  })

  it('a refusal tells how to allow deletion; no answer is a connection problem', () => {
    const refused = DeletionText.failed(new HTTPError(403))
    expect(refused).toContain('Plex не удалил (ошибка 403).')
    expect(refused).toContain('(Library → Allow media deletion)')
    expect(DeletionText.failed(new TypeError('Failed to fetch'))).toBe('Не удалось удалить: нет связи с сервером.')
    expect(DeletionText.partly(2, 5)).toBe('Не удалось удалить 2 из 5.')
  })

  it('confirmations name what goes', () => {
    const movie = item({ ratingKey: '1', type: 'movie', title: 'Фильм' })
    const show = item({ ratingKey: '2', type: 'show', title: 'Сериал', leafCount: 21 })
    const season = item({ ratingKey: '3', type: 'season', title: 'Сезон 2', leafCount: 8 })
    const bare = item({ ratingKey: '4', type: 'season', title: 'Сезон 3' })
    const episode = item({ ratingKey: '5', type: 'episode', title: 'Пилот' })
    expect(deletionTitle({ kind: 'movie', item: movie })).toBe('Удалить «Фильм»?')
    expect(deletionMessage({ kind: 'movie', item: movie })).toBe('Файл фильма удалится с диска сервера. Отменить это нельзя.')
    expect(deletionMessage({ kind: 'show', item: show })).toBe('Все скачанные серии (21) удалятся с диска сервера. Отменить это нельзя.')
    expect(deletionMessage({ kind: 'season', item: season })).toBe('С диска сервера удалятся 8 серий. Отменить это нельзя.')
    expect(deletionMessage({ kind: 'season', item: bare })).toBe('Серии сезона удалятся с диска сервера. Отменить это нельзя.')
    expect(deletionTitle({ kind: 'episode', item: episode })).toBe('Удалить серию «Пилот»?')
    const watched = { kind: 'watched' as const, items: [episode, episode, episode] }
    expect(deletionTitle(watched)).toBe('Удалить просмотренные серии?')
    expect(deletionMessage(watched)).toBe('С диска сервера удалятся 3 серии. Отменить это нельзя.')
    expect(deletionItems(watched)).toHaveLength(3)
    expect(deletionItems({ kind: 'show', item: show })).toEqual([show])
  })
})
