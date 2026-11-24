import { describe, expect, it } from 'vitest'
import { parseYouTubeMessage, trailerFailureText, TrailerText, youTubeEmbedURL, youTubeHandshake } from '../youtubeEmbed'

const video = { key: 'dQw4w9WgXcQ', name: '', type: 'Trailer', language: 'ru', official: true }

describe('YouTube embed', () => {
  it('the player URL asks for its messages, to the page’s origin', () => {
    const url = new URL(youTubeEmbedURL('https://www.youtube.com', video, 'en', 'https://loge.example'))
    expect(url.origin + url.pathname).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      autoplay: '1',
      playsinline: '1',
      rel: '0',
      hl: 'en',
      cc_lang_pref: 'en',
      enablejsapi: '1',
      origin: 'https://loge.example',
    })
    // A language that isn't an id-like word doesn't go into the URL.
    expect(new URL(youTubeEmbedURL('https://www.youtube.com', video, 'x&y=1', 'o')).searchParams.get('hl')).toBe('ru')
  })

  it('the page says «listening» and subscribes to the errors, as the IFrame API does', () => {
    expect(youTubeHandshake(1).map((m) => JSON.parse(m))).toEqual([
      { event: 'listening', id: 1, channel: 'widget' },
      { event: 'command', func: 'addEventListener', args: ['onError'], id: 1, channel: 'widget' },
    ])
  })

  it('player messages: JSON strings or objects; anything else is not one', () => {
    expect(parseYouTubeMessage('{"event":"onError","info":150,"id":1,"channel":"widget"}')).toEqual({ event: 'onError', info: 150 })
    expect(parseYouTubeMessage({ event: 'onReady', info: null })).toEqual({ event: 'onReady', info: null })
    expect(parseYouTubeMessage('not json')).toBeNull()
    expect(parseYouTubeMessage('{"info":1}')).toBeNull()
    expect(parseYouTubeMessage(42)).toBeNull()
    expect(parseYouTubeMessage(null)).toBeNull()
  })

  it('what the app says in the frame’s place', () => {
    expect(trailerFailureText({ kind: 'network' })).toBe(TrailerText.network)
    expect(trailerFailureText({ kind: 'player', code: 150 })).toBe(TrailerText.notEmbeddable)
    expect(trailerFailureText({ kind: 'player', code: 101 })).toBe(TrailerText.notEmbeddable)
    expect(trailerFailureText({ kind: 'player', code: 100 })).toBe(TrailerText.removed)
    expect(trailerFailureText({ kind: 'player', code: 5 })).toBe(TrailerText.playerError)
    expect(trailerFailureText({ kind: 'player', code: NaN })).toBe(TrailerText.playerError)
  })
})
