import type Hls from 'hls.js'
import type { DetectorClient } from '../core/detectorClient'
import { EpisodeNavigator } from '../core/episodeNavigator'
import { TrackSelector, tracksFromPart, type MediaTrack } from '../core/mediaTrack'
import { browserDefaultAudio, planPlayback, type BrowserCapabilities, type PlaybackPlan } from '../core/playbackPlan'
import { primaryPart, type PlexItem, type PlexPart } from '../core/plexModels'
import type { PlexServerAPI } from '../core/plexServerAPI'
import { ProgressTracker, ResumePolicy, type PlaybackState } from '../core/progressTracker'
import type { Segment } from '../core/segment'
import { SegmentFinder, type FoundSegments } from '../core/segmentFinder'
import {
  audioPreferenceFor,
  audioPreferencesEqual,
  preferencesKey,
  preferredAudio,
  type AudioPreference,
  type ShowPreferencesStore,
  type ShowPreferencesSync,
} from '../core/showPreferences'
import { adjustCorrection, correctionsEqual, NO_CORRECTION, type CorrectionField, type SkipCorrection } from '../core/skipCorrection'
import { SkipController, skipContextFor, type SkipAction, type SkipCountdown, type SkipMode, type SkipPrompt } from '../core/skipPolicy'
import { activeCues, decodeSubtitleBytes, parseSubtitles, type Cue } from '../core/subtitles'
import { newSessionId } from '../platform'

export interface NextEpisodeCard {
  item: PlexItem
  /** Seconds left before autoplay; undefined when waiting for the user. */
  secondsLeft?: number
}

export interface PlayerSnapshot {
  item: PlexItem
  /** File seconds. */
  position: number
  /** File seconds (0 while unknown). */
  duration: number
  paused: boolean
  buffering: boolean
  loading: boolean
  error?: string
  /** The browser refused to start playback without a click. */
  needsGesture: boolean
  skipPrompt: SkipPrompt | null
  skipCountdown: SkipCountdown | null
  nextCard: NextEpisodeCard | null
  audioTracks: MediaTrack[]
  subtitleTracks: MediaTrack[]
  selectedAudio?: number
  selectedSubtitle?: number
  nextEpisode?: PlexItem
  /** Detected segments, corrected (shown on the progress bar). */
  segments: Segment[]
  /** Where they came from: Loge Server, or without it the file's chapters and TheIntroDB. */
  segmentSources?: FoundSegments
  /** Skip correction of the current show. */
  correction: SkipCorrection
  plan?: PlaybackPlan
  finished: boolean
}

export interface PlayerSettings {
  skipMode: SkipMode
  autoplayNext: boolean
  nextEpisodeCountdown: number
  forceTranscode: boolean
}

export interface PlayerDeps {
  api: PlexServerAPI
  detector: () => DetectorClient | null
  settings: () => PlayerSettings
  preferences: ShowPreferencesStore
  preferencesSync: ShowPreferencesSync
  capabilities: BrowserCapabilities
  /** Use the browser's own HLS (Safari) instead of hls.js. */
  nativeHLS: () => boolean
  /** The connection is on the server's LAN. */
  local: boolean
  /** A new item started (next episode): update the URL. */
  onItemChange?: (item: PlexItem) => void
}

type MediaMode = 'direct' | 'transcode'

function withQuery(url: string, name: string, value: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(name)}=${encodeURIComponent(value)}`
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

/** Sum of `#EXTINF` durations of a media playlist. */
export function playlistDuration(playlist: string): number {
  let total = 0
  for (const match of playlist.matchAll(/#EXTINF:\s*([\d.]+)/g)) total += Number(match[1]) || 0
  return total
}

let hlsModule: Promise<typeof Hls | undefined> | undefined
function loadHls(): Promise<typeof Hls | undefined> {
  hlsModule ??= import('hls.js').then(
    (m) => m.default,
    () => {
      hlsModule = undefined
      return undefined
    },
  )
  return hlsModule
}

/**
 * Drives one playback session: `<video>` (direct play or Plex HLS), detector segments,
 * Plex progress and episode chaining. The web counterpart of the tvOS PlayerModel.
 * All positions are file seconds; under HLS the stream may start at the transcode offset.
 */
export class PlayerSession {
  private video?: HTMLVideoElement
  private hls?: Hls
  private snapshot: PlayerSnapshot
  private listeners = new Set<() => void>()

  private skip?: SkipController
  private tracker = new ProgressTracker()
  private tracks: MediaTrack[] = []
  private audio?: MediaTrack
  private subtitle?: MediaTrack
  private cues: Cue[] = []
  /** Text subtitle streams Plex could not serve: burned in instead. */
  private failedTextSubtitles = new Set<number>()
  private loadToken = 0
  /** Bumped by every teardown: a media start still in progress then stops (no orphaned transcode). */
  private mediaAttempt = 0

  // Media state
  private mode?: MediaMode
  private transcodeSession?: string
  /** File seconds at which the current HLS stream starts (when its times are relative). */
  private streamOffset = 0
  private relativeStream = false
  /** Native HLS: relative or absolute is decided from the element's duration. */
  private decideTimeline = false
  private pendingSeekTarget?: number
  private restartTimer?: ReturnType<typeof setTimeout>
  private tickTimer?: ReturnType<typeof setInterval>
  private countdownTimer?: ReturnType<typeof setInterval>
  private reachedEnd = false
  private fellBackFromDirect = false
  /** Direct play takes the file from the detector (outside the home network). */
  private directFromDetector = false
  /** The detector didn't give the file: direct play from Plex, then the transcoder. */
  private fellBackFromDetector = false
  private disposed = false
  private detach: (() => void)[] = []

  constructor(
    private readonly deps: PlayerDeps,
    item: PlexItem,
  ) {
    this.snapshot = {
      item,
      position: 0,
      duration: item.duration ? item.duration / 1000 : 0,
      paused: false,
      buffering: true,
      loading: true,
      needsGesture: false,
      skipPrompt: null,
      skipCountdown: null,
      nextCard: null,
      audioTracks: [],
      subtitleTracks: [],
      segments: [],
      correction: { ...NO_CORRECTION },
      finished: false,
    }
  }

  // MARK: Store

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.snapshot

  private set(change: Partial<PlayerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change }
    this.listeners.forEach((l) => l())
  }

  // MARK: Lifecycle

  attach(video: HTMLVideoElement) {
    this.video = video
    const on = <K extends keyof HTMLMediaElementEventMap>(type: K, handler: (e: HTMLMediaElementEventMap[K]) => void) => {
      video.addEventListener(type, handler)
      this.detach.push(() => video.removeEventListener(type, handler))
    }
    on('timeupdate', () => this.onTime())
    on('play', () => this.onPauseChanged(false))
    on('pause', () => this.onPauseChanged(true))
    on('waiting', () => this.set({ buffering: true }))
    on('playing', () => {
      this.reachedEnd = false
      this.set({ buffering: false, needsGesture: false })
    })
    on('canplay', () => this.set({ buffering: false }))
    on('seeked', () => {
      this.pendingSeekTarget = undefined
      this.onTime()
    })
    on('durationchange', () => this.onDuration())
    on('ended', () => this.onEnded())
    on('error', () => this.onMediaError())
    this.tickTimer = setInterval(() => {
      if (!video.paused) this.onTime()
    }, 250)
  }

  start(startAt?: number) {
    void this.load(this.snapshot.item, startAt)
  }

  /** Stops playback, reports the final position. */
  close() {
    if (this.snapshot.finished) return
    // Anything still loading (item, segments, transcode start) must not start the media.
    this.loadToken++
    clearInterval(this.countdownTimer)
    this.reportStopped(true)
    this.teardownMedia()
    this.set({ finished: true })
  }

  dispose() {
    if (this.disposed) return
    this.close()
    this.disposed = true
    clearInterval(this.tickTimer)
    clearInterval(this.countdownTimer)
    clearTimeout(this.restartTimer)
    this.detach.forEach((d) => d())
    this.detach = []
    this.listeners.clear()
  }

  private async load(requested: PlexItem, startAt?: number) {
    if (this.snapshot.finished) return
    const token = ++this.loadToken
    clearInterval(this.countdownTimer)
    this.teardownMedia()
    this.reachedEnd = false
    this.fellBackFromDirect = false
    this.fellBackFromDetector = false
    this.failedTextSubtitles.clear()
    this.cues = []
    this.skip = undefined
    this.tracker = new ProgressTracker()
    const key = preferencesKey(requested)
    this.set({
      item: requested,
      position: startAt ?? 0,
      duration: requested.duration ? requested.duration / 1000 : 0,
      loading: true,
      buffering: true,
      error: undefined,
      needsGesture: false,
      skipPrompt: null,
      skipCountdown: null,
      nextCard: null,
      audioTracks: [],
      subtitleTracks: [],
      selectedAudio: undefined,
      selectedSubtitle: undefined,
      segments: [],
      segmentSources: undefined,
      nextEpisode: undefined,
      plan: undefined,
      correction: this.deps.preferences.preferences(key).correction,
    })

    const { api } = this.deps
    let full = requested
    try {
      full = (await api.item(requested.ratingKey)) ?? requested
    } catch {
      // Use what we have.
    }
    if (token !== this.loadToken) return
    const part = primaryPart(full)
    if (!part) {
      this.set({ item: full, loading: false, error: 'У этого элемента нет файла для воспроизведения.' })
      return
    }
    this.set({ item: full, duration: full.duration ? full.duration / 1000 : this.snapshot.duration })

    // Opening the media is the slow part: start it with what is cached here, the rest loads
    // meanwhile. Loge Server alone may take seconds (its timeout, then the fallback), the
    // episode list of a long show about a second.
    const fullKey = preferencesKey(full)
    const preferences = this.deps.preferences.preferences(fullKey)
    this.tracks = tracksFromPart(part)
    // The dub chosen earlier in this show, if this file has it; else the usual default.
    const remembered = preferences.audio ? preferredAudio(this.tracks, preferences.audio) : undefined
    this.audio = remembered ?? TrackSelector.defaultAudio(this.tracks)
    this.subtitle = TrackSelector.defaultSubtitle(this.tracks, this.audio)
    this.set({
      correction: preferences.correction,
      audioTracks: this.tracks.filter((t) => t.kind === 'audio'),
      subtitleTracks: this.tracks.filter((t) => t.kind === 'sub'),
      selectedAudio: this.audio?.id,
      selectedSubtitle: this.subtitle?.id,
    })
    void this.startMedia(startAt ?? 0, true)

    // The show's correction and dub may have been changed on another device.
    void this.deps.preferencesSync.pull(fullKey).then(() => {
      if (token === this.loadToken) this.applyPulledPreferences(fullKey, preferences.audio)
    })
    // From Loge Server; without it, from the file's chapters and TheIntroDB.
    const detector = this.deps.detector()
    void new SegmentFinder({ detector, show: (ratingKey) => api.item(ratingKey).catch(() => undefined) })
      .find(full)
      .catch((): FoundSegments => ({ segments: [], sources: [] }))
      .then((found) => {
        if (token === this.loadToken) this.applySegments(full, found)
      })
    // Only final credits depend on it, far from the start.
    void this.findNextEpisode(full).then((next) => {
      if (token === this.loadToken) this.applyNextEpisode(next)
    })
  }

  /**
   * The segments arrived, possibly after playback has started: until then the session only
   * reports progress. The current position is judged at once, so an intro the playback is
   * already in (one from 0:00, a resume inside it) is still skipped or counted down.
   */
  private applySegments(item: PlexItem, found: FoundSegments) {
    const context = skipContextFor(this.deps.settings().skipMode, item, this.snapshot.nextEpisode !== undefined)
    const controller = new SkipController(found.segments, context, this.snapshot.correction)
    if (this.snapshot.duration > 0) controller.setDuration(this.snapshot.duration)
    this.skip = controller
    this.set({ segments: controller.segments, segmentSources: found })
    this.tracker.creditsStart = controller.watchedThreshold
    // While the media still opens, its first time update does it (and nothing is reported yet).
    if (!this.snapshot.loading) this.tick()
  }

  private applyNextEpisode(next: PlexItem | undefined) {
    this.set({ nextEpisode: next })
    this.skip?.setHasNextEpisode(next !== undefined)
  }

  /**
   * Loge Server's copy of the show's preferences came after the start. A changed correction
   * applies at once; a changed dub switches the track (it is not a new choice of the user,
   * so nothing is pushed). Nothing changed, nothing is reloaded.
   */
  private applyPulledPreferences(key: string, cachedAudio: AudioPreference | undefined) {
    const preferences = this.deps.preferences.preferences(key)
    if (!correctionsEqual(preferences.correction, this.snapshot.correction)) {
      this.setCorrection(preferences.correction)
      // As if the segments had come with it: the watched point follows the corrected credits.
      if (this.skip) this.tracker.creditsStart = this.skip.watchedThreshold
    }
    if (!audioPreferencesEqual(preferences.audio, cachedAudio)) this.applyRememberedAudio(preferences.audio)
  }

  /** The show's dub from another device, when this file has it and it isn't the one playing. */
  private applyRememberedAudio(preference: AudioPreference | undefined) {
    const track = preference ? preferredAudio(this.tracks, preference) : undefined
    if (!track || track.id === this.audio?.id) return
    this.audio = track
    this.subtitle = TrackSelector.defaultSubtitle(this.tracks, track)
    this.set({ selectedAudio: track.id, selectedSubtitle: this.subtitle?.id })
    this.applyTrackChange()
  }

  private async findNextEpisode(item: PlexItem): Promise<PlexItem | undefined> {
    if (item.type !== 'episode' || !item.grandparentRatingKey) return undefined
    try {
      const episodes = await this.deps.api.allEpisodes(item.grandparentRatingKey)
      return EpisodeNavigator.next(item, episodes)
    } catch {
      return undefined
    }
  }

  // MARK: Media

  private currentPlan(): PlaybackPlan {
    const item = this.snapshot.item
    return planPlayback({
      media: item.media[0],
      part: primaryPart(item),
      tracks: this.tracks,
      audio: this.audio,
      subtitle: this.subtitle,
      capabilities: this.deps.capabilities,
      textSubtitleFailed: this.subtitle ? this.failedTextSubtitles.has(this.subtitle.id) : false,
      forceTranscode: this.deps.settings().forceTranscode || this.fellBackFromDirect,
    })
  }

  /** (Re)starts the media at `fileTime` with the plan for the current tracks. */
  private async startMedia(fileTime: number, autoplay: boolean) {
    const video = this.video
    const part = primaryPart(this.snapshot.item)
    if (!video || !part || this.snapshot.finished) return
    const token = this.loadToken
    const plan = this.currentPlan()
    this.set({ plan, loading: true, buffering: true, error: undefined })
    this.teardownMedia()
    const attempt = this.mediaAttempt
    this.pendingSeekTarget = fileTime > 0 ? fileTime : undefined
    this.mode = plan.mode
    void this.loadSubtitles(plan)

    const ready = () => {
      if (token !== this.loadToken || attempt !== this.mediaAttempt || this.snapshot.finished) return
      this.onMetadata(fileTime)
      if (autoplay || !this.snapshot.paused) this.play()
      this.set({ loading: false })
    }

    if (plan.mode === 'direct') {
      this.streamOffset = 0
      this.relativeStream = false
      video.addEventListener('loadedmetadata', ready, { once: true })
      video.src = this.directURL(part)
      video.load()
      return
    }

    // Transcode: tell Plex which streams to use, then start an HLS session at the offset.
    const burn = plan.subtitles.kind === 'burn' ? plan.subtitles.streamId : undefined
    try {
      await this.deps.api.selectStreams(part, {
        audioStreamID: this.audio?.id,
        subtitleStreamID: burn ?? 0,
      })
    } catch {
      // Older servers or shared libraries: the transcoder uses the file defaults.
    }
    if (token !== this.loadToken || attempt !== this.mediaAttempt) return
    const session = newSessionId()
    this.transcodeSession = session
    this.streamOffset = Math.max(0, Math.floor(fileTime))
    this.relativeStream = this.streamOffset > 0
    const options = {
      item: this.snapshot.item,
      session,
      offset: this.streamOffset,
      local: this.deps.local,
      burnSubtitles: burn !== undefined,
    }
    // Plex 1.43 refuses (400) some starts of a session it hasn't decided on (restarts, in practice).
    const decision = await this.deps.api.transcodeDecision(options).catch(() => undefined)
    if (token !== this.loadToken || this.transcodeSession !== session) return
    if ((decision?.code ?? 0) >= 2000) {
      this.set({
        loading: false,
        error:
          decision?.code === 2013
            ? 'Вне домашней сети Plex не перекодирует видео без Plex Pass или Remote Watch Pass, а браузер не играет этот файл напрямую.'
            : `Plex отказался перекодировать: ${decision?.text ?? 'без объяснения'} (код ${decision?.code}).`,
      })
      return
    }
    const url = this.deps.api.transcodeURL(options)
    // hls.js is loaded only when a transcode is needed (it is most of the bundle).
    const Hls = this.deps.nativeHLS() ? undefined : await loadHls()
    if (token !== this.loadToken || this.transcodeSession !== session) return
    video.addEventListener('loadedmetadata', ready, { once: true })
    if (!Hls || !Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl') === '') {
        this.set({ loading: false, error: 'Этот браузер не умеет воспроизводить HLS.' })
        return
      }
      this.decideTimeline = true
      video.src = url
      video.load()
    } else {
      // Read the media playlist first: its length tells whether the stream's times start
      // at the offset or at 0, so hls.js loads the right segment straight away.
      const media = await this.mediaPlaylist(url)
      if (token !== this.loadToken || this.transcodeSession !== session) return
      this.decideTimeline = false
      this.relativeStream = media.duration !== undefined ? this.isRelative(media.duration) : this.streamOffset > 0
      const { token: plexToken } = this.deps.api
      const hls = new Hls({
        startPosition: Math.max(0, fileTime - (this.relativeStream ? this.streamOffset : 0)),
        maxBufferLength: 60,
        backBufferLength: 60,
        // Playlists and segments of the session carry the token too.
        xhrSetup: (xhr, requestURL) => {
          if (this.isServerURL(requestURL) && !/[?&]X-Plex-Token=/.test(requestURL)) {
            xhr.open('GET', withQuery(requestURL, 'X-Plex-Token', plexToken), true)
          }
        },
      })
      this.hls = hls
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError()
          return
        }
        const status = data.response?.code
        this.set({
          loading: false,
          error: `Сервер Plex не смог подготовить видео${status ? ` (ошибка ${status})` : ''}: ${data.details}`,
        })
      })
      hls.loadSource(media.url)
      hls.attachMedia(video)
    }
  }

  private isServerURL(url: string): boolean {
    try {
      return new URL(url).origin === new URL(this.deps.api.baseURL).origin
    } catch {
      return false
    }
  }

  /**
   * The media playlist behind Plex's `start.m3u8` (a master playlist with one variant)
   * and its total length. Falls back to the master URL when it can't be read.
   */
  private async mediaPlaylist(masterURL: string): Promise<{ url: string; duration?: number }> {
    const { token } = this.deps.api
    try {
      const master = await fetchText(masterURL)
      if (/#EXTINF:/.test(master)) return { url: masterURL, duration: playlistDuration(master) }
      const variant = master
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l !== '' && !l.startsWith('#'))
      if (!variant) return { url: masterURL }
      let levelURL = new URL(variant, masterURL).href
      if (this.isServerURL(levelURL) && !/[?&]X-Plex-Token=/.test(levelURL)) levelURL = withQuery(levelURL, 'X-Plex-Token', token)
      const level = await fetchText(levelURL)
      return { url: levelURL, duration: /#EXT-X-ENDLIST/.test(level) ? playlistDuration(level) : undefined }
    } catch {
      return { url: masterURL }
    }
  }

  private teardownMedia() {
    this.mediaAttempt++
    clearTimeout(this.restartTimer)
    const video = this.video
    if (this.hls) {
      this.hls.destroy()
      this.hls = undefined
    }
    if (this.transcodeSession) {
      const session = this.transcodeSession
      this.transcodeSession = undefined
      this.deps.api.stopTranscode(session).catch(() => {})
    }
    if (video) {
      video.removeAttribute('src')
      try {
        video.load()
      } catch {
        // ignore
      }
    }
    this.mode = undefined
    // Until the next stream says otherwise, file time is the element's own time.
    this.streamOffset = 0
    this.relativeStream = false
  }

  private onMetadata(fileTime: number) {
    const video = this.video
    if (!video) return
    if (this.mode === 'transcode') {
      if (this.decideTimeline) this.relativeStream = this.isRelative(video.duration)
      const streamTime = fileTime - (this.relativeStream ? this.streamOffset : 0)
      if (Math.abs(video.currentTime - streamTime) > 1) video.currentTime = Math.max(0, streamTime)
    } else {
      this.onDuration()
      if (fileTime > 0) video.currentTime = fileTime
      this.applyDirectAudioTrack()
    }
  }

  /**
   * Is the HLS timeline the whole file (Plex VOD playlist) or does it start at the
   * transcode offset? Whichever length the stream's duration is closer to.
   */
  private isRelative(streamDuration: number): boolean {
    if (this.streamOffset <= 0) return false
    const fileDuration = this.snapshot.duration
    if (!Number.isFinite(streamDuration) || streamDuration <= 0 || fileDuration <= 0) return true
    return Math.abs(streamDuration - (fileDuration - this.streamOffset)) < Math.abs(streamDuration - fileDuration)
  }

  /** Safari: pick the chosen audio of the file itself. */
  private applyDirectAudioTrack() {
    const video = this.video as (HTMLVideoElement & { audioTracks?: { length: number; [i: number]: { enabled: boolean } } }) | undefined
    const list = video?.audioTracks
    if (!list || !this.audio) return
    const audio = this.tracks.filter((t) => t.kind === 'audio')
    const index = audio.findIndex((t) => t.id === this.audio?.id)
    if (index < 0 || index >= list.length) return
    for (let i = 0; i < list.length; i++) list[i].enabled = i === index
  }

  private play() {
    const video = this.video
    if (!video) return
    video.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        this.set({ needsGesture: true, paused: true, buffering: false })
      }
    })
  }

  /** Current file position of the media element. */
  fileTime(): number {
    const video = this.video
    if (!video || this.mode === undefined) return this.snapshot.position
    return video.currentTime + (this.relativeStream ? this.streamOffset : 0)
  }

  private seekFile(target: number) {
    const video = this.video
    if (!video) return
    if (this.mode === 'direct') {
      video.currentTime = target
      return
    }
    if (this.mode !== 'transcode') return
    const streamTime = target - (this.relativeStream ? this.streamOffset : 0)
    const seekable = video.seekable
    const end = seekable.length > 0 ? seekable.end(seekable.length - 1) : 0
    if (streamTime >= 0 && streamTime <= end + 1) {
      video.currentTime = streamTime
      return
    }
    // Outside what the transcoder offers: start it again there (coalescing key repeats).
    clearTimeout(this.restartTimer)
    this.set({ buffering: true })
    this.restartTimer = setTimeout(() => void this.startMedia(this.pendingSeekTarget ?? target, !this.snapshot.paused), 400)
  }

  private async loadSubtitles(plan: PlaybackPlan) {
    this.cues = []
    if (plan.subtitles.kind !== 'text') return
    const streamId = plan.subtitles.streamId
    const codec = this.subtitle?.codec
    const token = this.loadToken
    try {
      const response = await fetch(this.deps.api.subtitleURL(streamId))
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const text = decodeSubtitleBytes(new Uint8Array(await response.arrayBuffer()))
      const cues = parseSubtitles(text, codec)
      if (cues.length === 0) throw new Error('no cues')
      if (token !== this.loadToken || this.subtitle?.id !== streamId) return
      this.cues = cues
    } catch {
      if (token !== this.loadToken || this.subtitle?.id !== streamId) return
      // Embedded subtitles Plex won't hand out as a file: burn them in.
      this.failedTextSubtitles.add(streamId)
      this.restartWithCurrentTracks()
    }
  }

  /** Subtitle text to show now. */
  subtitleText(): string {
    if (this.cues.length === 0) return ''
    return activeCues(this.cues, this.fileTime())
      .map((c) => c.text)
      .join('\n')
  }

  private restartWithCurrentTracks() {
    const position = this.pendingSeekTarget ?? this.fileTime()
    void this.startMedia(position, !this.snapshot.paused)
  }

  // MARK: Media events

  private onTime() {
    const video = this.video
    if (!video || this.mode === undefined) return
    const position = this.fileTime()
    if (!Number.isFinite(position)) return
    const target = this.pendingSeekTarget
    if (target !== undefined) {
      // Ignore stale positions until the seek lands.
      if (Math.abs(position - target) > 2) return
      this.pendingSeekTarget = undefined
    }
    this.set({ position })
    this.tick()
  }

  private onDuration() {
    const video = this.video
    // Under HLS the stream may cover only part of the file: keep Plex's duration.
    if (!video || this.mode !== 'direct') return
    const d = video.duration
    if (!Number.isFinite(d) || d <= 0) return
    this.skip?.setDuration(d)
    this.set({ duration: d })
  }

  private onPauseChanged(paused: boolean) {
    if (this.snapshot.loading && paused) return
    this.set({ paused })
    this.report(paused ? 'paused' : 'playing')
  }

  private onEnded() {
    this.reachedEnd = true
    if (this.snapshot.loading || this.snapshot.nextCard) return
    this.markWatchedNow()
    const next = this.snapshot.nextEpisode
    if (next && this.deps.settings().autoplayNext) this.startNextEpisodeCountdown()
    else if (next) this.set({ nextCard: { item: next } })
    else this.close()
  }

  /**
   * At home Plex gives the file itself. Through a public address or the relay Plex gives it
   * only with Plex Pass or Remote Watch Pass (lists and artwork still load), so the detector
   * serves it from its mount of the library.
   */
  private directURL(part: PlexPart): string {
    const detector = this.deps.local || this.fellBackFromDetector ? null : this.deps.detector()
    const url = detector?.fileURL(this.snapshot.item.ratingKey, part)
    this.directFromDetector = url !== undefined
    return url ?? this.deps.api.directPlayURL(part)
  }

  private onMediaError() {
    const video = this.video
    if (!video || this.mode === undefined || !video.error) return
    if (this.mode === 'direct' && this.directFromDetector && !this.fellBackFromDetector) {
      // The detector couldn't give the file (down, an old version): Plex may (Plex Pass).
      this.fellBackFromDetector = true
      void this.startMedia(this.pendingSeekTarget ?? this.snapshot.position, true)
      return
    }
    if (this.mode === 'direct' && !this.fellBackFromDirect) {
      // The browser can't decode this file after all: let Plex convert it.
      this.fellBackFromDirect = true
      void this.startMedia(this.pendingSeekTarget ?? this.snapshot.position, true)
      return
    }
    if (this.hls) return // hls.js reports its own errors
    this.set({ loading: false, error: `Не удалось воспроизвести файл: ${video.error.message || `ошибка ${video.error.code}`}` })
  }

  // MARK: Ticks

  private tick() {
    const skip = this.skip
    if (!skip || this.snapshot.loading) {
      this.report(this.currentState())
      return
    }
    const command = skip.update(this.snapshot.position)
    if (command) {
      if (command.kind === 'seek') this.perform({ kind: 'seek', to: command.to })
      else this.startNextEpisodeCountdown()
    }
    if (!this.snapshot.nextCard) this.set({ skipPrompt: skip.prompt, skipCountdown: skip.countdown })
    else this.set({ skipPrompt: null, skipCountdown: null })
    this.report(this.currentState())
  }

  private currentState(): PlaybackState {
    if (this.snapshot.paused) return 'paused'
    return this.snapshot.buffering ? 'buffering' : 'playing'
  }

  private report(state: PlaybackState) {
    const duration = this.snapshot.duration > 0 ? this.snapshot.duration : undefined
    const reports = this.tracker.update(state, this.snapshot.position, duration)
    const { api } = this.deps
    const item = this.snapshot.item
    for (const report of reports) {
      if (report.kind === 'timeline') {
        api.reportTimeline(item, report.state, report.position, duration, this.transcodeSession).catch(() => {})
      } else {
        api.markWatched(item.ratingKey).catch(() => {})
      }
    }
  }

  /** Final timeline (and scrobble when watched); `keepalive` survives the page closing. */
  reportStopped(keepalive = false) {
    const { position, duration, item, loading, error } = this.snapshot
    if (loading && position === 0 && !error) return
    const watched = this.tracker.isWatched(position, duration > 0 ? duration : undefined)
    const alreadyScrobbled = this.tracker.scrobbled
    const { api } = this.deps
    // Stopped in the final credits: report the end, not a resume point. Plex would keep
    // "continue from 41:10" for an episode it just marked watched (credits start < 90 %).
    const reported = watched && duration > 0 ? duration : position
    api
      .reportTimeline(item, 'stopped', reported, duration > 0 ? duration : undefined, this.transcodeSession, keepalive)
      .catch(() => {})
    if (watched && !alreadyScrobbled) {
      this.tracker.scrobbled = true
      api.markWatched(item.ratingKey).catch(() => {})
    }
  }

  private markWatchedNow() {
    if (this.tracker.scrobbled) return
    this.tracker.scrobbled = true
    this.deps.api.markWatched(this.snapshot.item.ratingKey).catch(() => {})
  }

  // MARK: User actions

  togglePause() {
    const video = this.video
    if (!video) return
    if (video.paused) this.play()
    else video.pause()
  }

  /** ← / → */
  seekBy(seconds: number) {
    this.seekTo((this.pendingSeekTarget ?? this.snapshot.position) + seconds)
  }

  /** A user seek (keys, seek bar). */
  seekTo(position: number) {
    const duration = this.snapshot.duration
    let target = position
    if (duration > 0) target = Math.min(target, duration - 1)
    target = Math.max(0, target)
    this.pendingSeekTarget = target
    this.skip?.userSeeked(target)
    this.set({ position: target, skipCountdown: null })
    this.seekFile(target)
    this.tick()
  }

  performSkip() {
    const prompt = this.snapshot.skipPrompt
    if (!prompt) return
    if (prompt.action.kind === 'seek') this.skip?.userSeeked(prompt.action.to)
    else this.skip?.userInteracted()
    this.perform(prompt.action)
  }

  private perform(action: SkipAction) {
    switch (action.kind) {
      case 'seek':
        this.pendingSeekTarget = action.to
        this.set({ position: action.to, skipPrompt: null })
        this.seekFile(action.to)
        break
      case 'nextEpisode':
        this.playNext()
        break
      case 'finish':
        this.markWatchedNow()
        this.close()
        break
    }
  }

  playNext() {
    const next = this.snapshot.nextEpisode
    if (!next) {
      this.close()
      return
    }
    this.reportStopped()
    this.markWatchedNow()
    this.deps.onItemChange?.(next)
    void this.load(next, ResumePolicy.resumePosition(next))
  }

  /** The user dismissed the "Next episode" card: keep watching the credits. */
  cancelNextEpisode() {
    clearInterval(this.countdownTimer)
    this.skip?.userInteracted()
    this.set({ nextCard: null, skipPrompt: this.skip?.prompt ?? null })
  }

  /** The user doesn't want this skip: the segment plays, with a "Skip" button inside it. */
  cancelSkipCountdown() {
    this.skip?.cancelCountdown()
    this.set({ skipCountdown: null })
  }

  /** The user picked an audio track: remembered for the whole show. */
  selectAudio(track: MediaTrack) {
    if (track.id === this.audio?.id) return
    this.audio = track
    const key = preferencesKey(this.snapshot.item)
    const preference = audioPreferenceFor(track, this.tracks)
    this.deps.preferences.update(key, (p) => ({ ...p, audio: preference }))
    this.deps.preferencesSync.schedulePush()
    this.set({ selectedAudio: track.id })
    this.applyTrackChange()
  }

  /** Subtitles are not remembered (as on tvOS). */
  selectSubtitle(track: MediaTrack | undefined) {
    if (track?.id === this.subtitle?.id) return
    this.subtitle = track
    this.set({ selectedSubtitle: track?.id })
    this.applyTrackChange()
  }

  private applyTrackChange() {
    const before = this.snapshot.plan
    const after = this.currentPlan()
    const sameMedia =
      before &&
      before.mode === after.mode &&
      before.mode === 'direct' &&
      before.subtitles.kind !== 'burn' &&
      after.subtitles.kind !== 'burn' &&
      (this.deps.capabilities.audioTrackSwitching || browserDefaultAudio(this.tracks)?.id === this.audio?.id)
    if (sameMedia) {
      this.set({ plan: after })
      this.applyDirectAudioTrack()
      void this.loadSubtitles(after)
      return
    }
    this.restartWithCurrentTracks()
  }

  /** Moves a boundary of the show's correction by `delta` seconds; applies at once. */
  adjustCorrection(field: CorrectionField, delta: number) {
    const correction = adjustCorrection(this.snapshot.correction, field, delta)
    const key = preferencesKey(this.snapshot.item)
    this.deps.preferences.update(key, (p) => ({ ...p, correction }))
    this.deps.preferencesSync.schedulePush()
    this.setCorrection(correction)
  }

  /** Skips by `correction` from now on (the segments may not be here yet). */
  private setCorrection(correction: SkipCorrection) {
    this.set({ correction })
    const skip = this.skip
    if (!skip) return
    skip.setCorrection(correction)
    this.set({ segments: skip.segments })
    // Paused playback sends no ticks: refresh the button and countdown now.
    if (!this.snapshot.loading) this.tick()
  }

  // MARK: Countdown

  private startNextEpisodeCountdown() {
    const next = this.snapshot.nextEpisode
    if (!next) return
    const settings = this.deps.settings()
    if (!settings.autoplayNext) {
      this.set({ nextCard: { item: next } })
      return
    }
    let remaining = settings.nextEpisodeCountdown
    this.set({ nextCard: { item: next, secondsLeft: remaining }, skipPrompt: null, skipCountdown: null })
    clearInterval(this.countdownTimer)
    this.countdownTimer = setInterval(() => {
      // Pausing freezes the countdown (but not once the file has ended).
      if (this.snapshot.paused && !this.reachedEnd) return
      remaining -= 1
      if (remaining <= 0) {
        clearInterval(this.countdownTimer)
        this.playNext()
        return
      }
      if (this.snapshot.nextCard) this.set({ nextCard: { ...this.snapshot.nextCard, secondsLeft: remaining } })
    }, 1000)
  }
}
