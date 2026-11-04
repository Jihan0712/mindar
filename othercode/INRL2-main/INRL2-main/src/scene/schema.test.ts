import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAX_TEXT_CHARS, TEXT_STYLE_IDS } from '../studio/library'
import { MAX_OBJECTS, sceneSchema, textObjectSchema } from './schema'

describe('scene format', () => {
  it('accepts the step-1 test scene', () => {
    const raw = JSON.parse(readFileSync('public/test/scene.json', 'utf8'))
    const scene = sceneSchema.parse(raw)
    expect(scene.objects.map((o) => o.kind).sort()).toEqual(['image', 'model', 'model', 'video'])
  })

  it('fills in defaults so editors can save minimal objects', () => {
    const scene = sceneSchema.parse({ version: 1, id: 's', objects: [{ id: 'a', kind: 'model', src: '/a.glb' }] })
    expect(scene.objects[0].transform).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 })
    expect(scene.background.color).toBe('#E1E8E9')
  })

  it(`refuses more than ${MAX_OBJECTS} objects`, () => {
    const objects = Array.from({ length: MAX_OBJECTS + 1 }, (_, i) => ({ id: `o${i}`, kind: 'image', src: '/p.jpg' }))
    expect(() => sceneSchema.parse({ version: 1, id: 's', objects })).toThrow()
  })

  it('accepts InStudio text and library objects', () => {
    const scene = sceneSchema.parse({
      version: 1,
      id: 's',
      objects: [
        { id: 't', kind: 'text', text: 'Hello', style: 'candy', transform: { position: [0.1, 0, 0], rotation: [0, 30, 0], scale: 1.4 } },
        { id: 'i', kind: 'item', item: 'chrome-blob' },
      ],
    })
    expect(scene.objects.map((o) => o.kind)).toEqual(['text', 'item'])
  })

  it('knows the same text styles and length as the library', () => {
    expect(textObjectSchema.shape.style.options).toEqual(TEXT_STYLE_IDS)
    expect(() => textObjectSchema.parse({ id: 't', kind: 'text', style: 'foil', text: 'x'.repeat(MAX_TEXT_CHARS + 1) })).toThrow()
  })
})
