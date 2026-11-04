import { describe, expect, it } from 'vitest'
import { coverCrop, faceAspect, formatOf, mediaPosition, mediaWidth, SCREENS_FOR } from './placeMedia'

describe('placing photos and videos', () => {
  it('fits pictures to the marker square, long side 0.9', () => {
    expect(mediaWidth('marker', 16 / 9)).toBe(0.9)
    expect(mediaWidth('marker', 9 / 16)).toBeCloseTo(0.506, 3)
  })

  it('keeps screens and cards about 0.6 on the long side', () => {
    expect(mediaWidth('screen', 4 / 3)).toBe(0.6)
    expect(mediaWidth('floating', 3 / 4)).toBe(0.45)
  })

  it('starts on the marker centre, floating a bit up, or on the floor', () => {
    expect(mediaPosition('marker', [0.3, 0.2]).slice(0, 2)).toEqual([0, 0.5])
    expect(mediaPosition('floating', [0.3, 0.2])).toEqual([0.3, 0.15, 0.2])
    expect(mediaPosition('screen', [0.3, 0.2])).toEqual([0.3, 0, 0.2])
  })

  it('sorts phone media into formats and offers screens made for them', () => {
    expect(formatOf(9 / 16)).toBe('portrait')
    expect(formatOf(3 / 4)).toBe('portrait')
    expect(formatOf(16 / 9)).toBe('landscape')
    expect(formatOf(1)).toBe('square')
    expect(SCREENS_FOR.portrait[0]).toBe('phone')
    expect(SCREENS_FOR.landscape[0]).toBe('flat-tv')
    for (const f of ['portrait', 'landscape', 'square'] as const) expect(SCREENS_FOR[f]).toContain('frame')
  })

  it('uses the device shape for fixed screens and crops the media to fill it', () => {
    expect(faceAspect('screen', 'phone', 3 / 4)).toBeCloseTo(9 / 16)
    expect(faceAspect('screen', 'frame', 3 / 4)).toBeCloseTo(3 / 4)
    expect(faceAspect('floating', 'phone', 3 / 4)).toBeCloseTo(3 / 4)
    // a 3:4 photo on a 9:16 phone: sides cropped equally
    const c = coverCrop(3 / 4, 9 / 16)
    expect(c.repeat[0]).toBeCloseTo(0.75)
    expect(c.offset[0]).toBeCloseTo(0.125)
    expect(coverCrop(1, 1)).toEqual({ repeat: [1, 1], offset: [0, 0] })
  })
})
