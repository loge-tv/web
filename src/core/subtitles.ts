/** Text subtitles drawn by the player itself (times in file seconds, so they also work under HLS offsets). */
export interface Cue {
  start: number
  end: number
  text: string
}

/** UTF-8 if valid, otherwise Windows-1251 (most Russian SRTs that aren't UTF-8). */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      text = new TextDecoder('windows-1251').decode(bytes)
    } catch {
      text = new TextDecoder('utf-8').decode(bytes)
    }
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** "00:01:02,345" / "01:02.345" / "0:01:02.34" → seconds. */
function parseTimestamp(value: string): number | undefined {
  const m = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/)
  if (!m) return undefined
  const [, h, min, s, frac] = m
  const fraction = frac ? Number(frac.padEnd(3, '0')) / 1000 : 0
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s) + fraction
}

function cleanMarkup(text: string): string {
  return text
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

/** SRT and WebVTT: blocks with a "start --> end" line. */
export function parseSrtOrVtt(text: string): Cue[] {
  const cues: Cue[] = []
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split('\n')
    const timingIndex = lines.findIndex((l) => l.includes('-->'))
    if (timingIndex < 0) continue
    const [from, rest] = lines[timingIndex].split('-->')
    const to = rest.trim().split(/\s+/)[0]
    const start = parseTimestamp(from)
    const end = parseTimestamp(to)
    if (start === undefined || end === undefined || end <= start) continue
    const body = cleanMarkup(lines.slice(timingIndex + 1).join('\n'))
    if (body) cues.push({ start, end, text: body })
  }
  return cues.sort((a, b) => a.start - b.start)
}

/** ASS/SSA: `Dialogue:` lines of the [Events] section, formatting stripped. */
export function parseAss(text: string): Cue[] {
  const cues: Cue[] = []
  let format: string[] = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (/^format:/i.test(line)) {
      format = line.slice(7).split(',').map((f) => f.trim().toLowerCase())
      continue
    }
    if (!/^dialogue:/i.test(line)) continue
    const fields = line.slice(9).split(',')
    const textIndex = format.indexOf('text')
    const value = (name: string) => fields[format.indexOf(name)]?.trim() ?? ''
    const start = parseTimestamp(value('start'))
    const end = parseTimestamp(value('end'))
    const body = cleanMarkup(fields.slice(textIndex).join(',').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' '))
    if (start === undefined || end === undefined || end <= start || !body) continue
    cues.push({ start, end, text: body })
  }
  return cues.sort((a, b) => a.start - b.start)
}

export function parseSubtitles(text: string, codec?: string): Cue[] {
  const kind = (codec ?? '').toLowerCase()
  if (kind === 'ass' || kind === 'ssa' || /^\s*\[script info\]/i.test(text)) return parseAss(text)
  return parseSrtOrVtt(text)
}

/** Cues showing at `time` (several may overlap). */
export function activeCues(cues: Cue[], time: number): Cue[] {
  // Cues are sorted by start; overlapping ones are rare, a linear scan near the start is fine.
  let lo = 0
  let hi = cues.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= time) lo = mid + 1
    else hi = mid
  }
  const result: Cue[] = []
  for (let i = lo - 1; i >= 0 && i >= lo - 20; i--) {
    if (cues[i].end > time) result.unshift(cues[i])
  }
  return result
}
