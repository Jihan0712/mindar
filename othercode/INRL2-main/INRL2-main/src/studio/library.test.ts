import { describe, expect, it } from 'vitest'
import { LIBRARY, STYLES, TEXT_STYLES } from './library'

describe('InStudio library', () => {
  it('has unique ids', () => {
    const ids = LIBRARY.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('tags every item and text style with known styles (an open list, at least one each)', () => {
    for (const item of [...LIBRARY, ...Object.values(TEXT_STYLES)]) {
      expect(item.styles.length).toBeGreaterThan(0)
      for (const s of item.styles) expect(STYLES[s], `${s} is a known style`).toBeDefined()
    }
  })

  it('offers objects, characters and stickers', () => {
    for (const type of ['object', 'character', 'sticker']) expect(LIBRARY.some((i) => i.type === type)).toBe(true)
  })
})
