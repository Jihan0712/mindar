import { describe, expect, it } from 'vitest'
import { giphyRequest, giphyResponse, trimGiphy } from '../../worker/giphy'

const item = (id: string) => ({
  id,
  title: `GIF ${id}`,
  images: {
    original: { url: `https://media.giphy.com/${id}.gif`, width: '480', height: '270', mp4: `https://media.giphy.com/${id}.mp4` },
    original_mp4: { mp4: `https://media.giphy.com/${id}-o.mp4` },
    fixed_width: { webp: `https://media.giphy.com/${id}-200.webp` },
  },
})

describe('GIF search (worker)', () => {
  it('searches, or lists trending GIFs without a query, safely rated', () => {
    const s = giphyRequest(new URL('https://x/api/giphy?q=  cats &offset=24'), 'KEY')
    expect(s.api.pathname).toBe('/v1/gifs/search')
    expect(s.api.searchParams.get('q')).toBe('cats')
    expect(s.api.searchParams.get('rating')).toBe('pg')
    expect(s.offset).toBe(24)
    expect(giphyRequest(new URL('https://x/api/giphy'), 'KEY').api.pathname).toBe('/v1/gifs/trending')
  })

  it('keeps only what the editor needs, with the MP4 for 3D and the next page', () => {
    const page = trimGiphy({ data: [item('a'), { id: 'broken' }, item('b')], pagination: { total_count: 50, count: 3 } }, 0)
    expect(page.gifs.map((g) => g.id)).toEqual(['a', 'b'])
    expect(page.gifs[0]).toMatchObject({ mp4: 'https://media.giphy.com/a-o.mp4', preview: 'https://media.giphy.com/a-200.webp', width: 480, height: 270 })
    expect(page.next).toBe(3)
  })

  it('never answers without the key, and never sends the key to the phone', async () => {
    expect((await giphyResponse(new Request('https://x/api/giphy'), undefined)).status).toBe(503)
    const fake = (async () => new Response(JSON.stringify({ data: [item('a')], pagination: { total_count: 1, count: 1 } }))) as unknown as typeof fetch
    const text = await (await giphyResponse(new Request('https://x/api/giphy?q=hi'), 'SECRET', fake)).text()
    expect(text).not.toContain('SECRET')
  })
})
