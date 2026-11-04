import { describe, expect, it } from 'vitest'
import { count, timeAgo } from './social'

describe('feed labels', () => {
  it('says how long ago', () => {
    const now = Date.UTC(2026, 9, 7, 12)
    expect(timeAgo(now - 10_000, now)).toBe('now')
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5m')
    expect(timeAgo(now - 4 * 3_600_000, now)).toBe('4h')
    expect(timeAgo(now - 3 * 86_400_000, now)).toBe('3d')
    expect(timeAgo(now - 15 * 86_400_000, now)).toBe('2w')
  })
  it('shortens big numbers', () => {
    expect(count(212)).toBe('212')
    expect(count(1200)).toBe('1.2K')
    expect(count(3000)).toBe('3K')
    expect(count(35_600)).toBe('36K')
    expect(count(2_500_000)).toBe('2.5M')
  })
})
