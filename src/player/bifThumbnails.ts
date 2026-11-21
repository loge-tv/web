import { bifFrameAt, parseBif, type BifIndex } from '../core/bif'

/** Plex preview thumbnails of one part, loaded once, served as object URLs. */
export class BifThumbnails {
  private index?: BifIndex
  private data?: ArrayBuffer
  private urls = new Map<number, string>()
  private disposed = false

  constructor(private readonly url: string) {}

  async load(): Promise<boolean> {
    try {
      const response = await fetch(this.url)
      if (!response.ok) return false
      const data = await response.arrayBuffer()
      if (this.disposed) return false
      this.index = parseBif(data)
      this.data = data
      return this.index.frames.length > 0
    } catch {
      return false
    }
  }

  /** Object URL of the frame for `seconds`, or undefined when not loaded. */
  frame(seconds: number): string | undefined {
    if (!this.index || !this.data) return undefined
    const i = bifFrameAt(this.index, seconds)
    if (i < 0) return undefined
    let url = this.urls.get(i)
    if (!url) {
      const { start, end } = this.index.frames[i]
      url = URL.createObjectURL(new Blob([this.data.slice(start, end)], { type: 'image/jpeg' }))
      this.urls.set(i, url)
    }
    return url
  }

  dispose() {
    this.disposed = true
    this.urls.forEach((u) => URL.revokeObjectURL(u))
    this.urls.clear()
    this.data = undefined
    this.index = undefined
  }
}
