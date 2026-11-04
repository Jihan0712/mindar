/**
 * Reads a "Range: bytes=…" header for a file of `size` bytes. iPhone Safari
 * asks for video and audio in pieces and won't play media served whole.
 * Returns null for no range (send it all) or 'invalid' (answer 416).
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  let start: number, end: number
  if (m && m[1] !== '') {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  } else if (m && m[2] !== '') {
    // Suffix range: the last N bytes.
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else return 'invalid'
  if (start > end || start >= size) return 'invalid'
  return { start, end }
}
