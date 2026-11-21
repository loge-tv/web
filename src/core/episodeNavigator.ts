import { isWatched, progress, type PlexItem } from './plexModels'

const LAST = Number.MAX_SAFE_INTEGER

function sortKey(item: PlexItem): [number, number] {
  const season = item.parentIndex ?? LAST
  return [season === 0 ? LAST : season, item.index ?? LAST]
}

export const EpisodeNavigator = {
  /** Episodes sorted by season and episode number (specials, season 0, go last). */
  ordered(episodes: PlexItem[]): PlexItem[] {
    return episodes
      .filter((e) => e.type === 'episode')
      .map((item, offset) => ({ item, offset, key: sortKey(item) }))
      .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.offset - b.offset)
      .map((e) => e.item)
  },

  /**
   * Episode that follows `current` in the show, or undefined for the last one.
   * Specials (season 0) are never chosen as "next" for a regular episode.
   */
  next(current: PlexItem, episodes: PlexItem[]): PlexItem | undefined {
    const list = EpisodeNavigator.ordered(episodes)
    const i = list.findIndex((e) => e.ratingKey === current.ratingKey)
    if (i < 0 || i + 1 >= list.length) return undefined
    const candidate = list[i + 1]
    if ((current.parentIndex ?? 1) !== 0 && candidate.parentIndex === 0) return undefined
    return candidate
  },

  /** What "Play" on a show starts: the first in-progress or unwatched episode. */
  resumeEpisode(episodes: PlexItem[]): PlexItem | undefined {
    const list = EpisodeNavigator.ordered(episodes).filter((e) => e.parentIndex !== 0)
    const inProgress = list.find((e) => progress(e) !== undefined)
    if (inProgress) return inProgress
    // First unwatched after the last watched one, so gaps from the past do not win.
    let lastWatched = -1
    list.forEach((e, i) => {
      if ((e.viewCount ?? 0) > 0) lastWatched = i
    })
    if (lastWatched >= 0) {
      if (lastWatched + 1 < list.length) return list[lastWatched + 1]
      return list[0]
    }
    return list[0]
  },

  /**
   * The episode of one season that is selected on the show page: the one in progress,
   * else the first unwatched one after the last watched, else the first unwatched, else the first.
   */
  focusEpisode(seasonEpisodes: PlexItem[]): PlexItem | undefined {
    const list = EpisodeNavigator.ordered(seasonEpisodes)
    const inProgress = list.find((e) => progress(e) !== undefined)
    if (inProgress) return inProgress
    let lastWatched = -1
    list.forEach((e, i) => {
      if (isWatched(e)) lastWatched = i
    })
    if (lastWatched >= 0 && lastWatched + 1 < list.length) {
      const next = list.slice(lastWatched + 1).find((e) => !isWatched(e))
      if (next) return next
    }
    return list.find((e) => !isWatched(e)) ?? list[0]
  },
}
