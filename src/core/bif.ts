/**
 * BIF ("Base Index Frames", Roku format used by Plex for preview thumbnails):
 * 8-byte magic, version, image count, frame interval (ms, 0 = 1000), header padded
 * to 64 bytes, then `count + 1` index entries of (timestamp, offset), uint32 LE;
 * the last entry's timestamp is 0xffffffff and its offset is the end of the data.
 */
export interface BifIndex {
  /** Milliseconds per timestamp unit. */
  intervalMs: number
  frames: { timeMs: number; start: number; end: number }[]
}

const MAGIC = [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]

export function parseBif(buffer: ArrayBuffer): BifIndex {
  const view = new DataView(buffer)
  if (buffer.byteLength < 64) throw new Error('BIF: too short')
  for (let i = 0; i < MAGIC.length; i++) {
    if (view.getUint8(i) !== MAGIC[i]) throw new Error('BIF: bad magic')
  }
  const count = view.getUint32(12, true)
  const interval = view.getUint32(16, true) || 1000
  const frames: BifIndex['frames'] = []
  for (let i = 0; i < count; i++) {
    const at = 64 + i * 8
    if (at + 16 > buffer.byteLength) break
    const timestamp = view.getUint32(at, true)
    const start = view.getUint32(at + 4, true)
    const end = view.getUint32(at + 12, true)
    if (timestamp === 0xffffffff || end <= start || end > buffer.byteLength) break
    frames.push({ timeMs: timestamp * interval, start, end })
  }
  return { intervalMs: interval, frames }
}

/** Index of the frame shown at `seconds` (the last frame not after it). */
export function bifFrameAt(index: BifIndex, seconds: number): number {
  const ms = seconds * 1000
  let lo = 0
  let hi = index.frames.length - 1
  if (hi < 0) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (index.frames[mid].timeMs <= ms) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Builds a BIF from JPEG frames (tests and the fake server). */
export function buildBif(images: Uint8Array[], intervalMs: number): Uint8Array {
  const header = 64 + (images.length + 1) * 8
  const total = header + images.reduce((n, img) => n + img.length, 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  MAGIC.forEach((b, i) => view.setUint8(i, b))
  view.setUint32(8, 0, true)
  view.setUint32(12, images.length, true)
  view.setUint32(16, intervalMs, true)
  let offset = header
  images.forEach((img, i) => {
    view.setUint32(64 + i * 8, i, true)
    view.setUint32(64 + i * 8 + 4, offset, true)
    out.set(img, offset)
    offset += img.length
  })
  view.setUint32(64 + images.length * 8, 0xffffffff, true)
  view.setUint32(64 + images.length * 8 + 4, offset, true)
  return out
}
