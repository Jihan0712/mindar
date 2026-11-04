import { describe, expect, it } from 'vitest'
import { cloudResponse, mediaIds, SINGLE_MAX } from './cloud.ts'
import { devBucket, devDatabase } from './devCloud.ts'

const PHONE = 'a'.repeat(32)
const OTHER = 'b'.repeat(32)

async function setup() {
  const env = { DB: await devDatabase(), MEDIA: devBucket() }
  const call = (path: string, init: RequestInit & { owner?: string } = {}) => {
    const headers = new Headers(init.headers)
    if (init.owner !== '') headers.set('X-InRL-Owner', init.owner ?? PHONE)
    return cloudResponse(new Request(`http://x${path}`, { ...init, headers }), env)
  }
  return { env, call }
}

const scene = (id: string, src = 'media:mvideo12345678') => ({
  version: 1, id, title: '', objects: [{ id: 'o1', kind: 'video', src }],
})

describe('cloud saving API', () => {
  it('saves, lists, reads and deletes a scene with its video', async () => {
    const { call } = await setup()
    const video = new Uint8Array(1000).map((_, i) => i % 256)
    let r = await call('/api/media/mvideo12345678', { method: 'PUT', body: video, headers: { 'Content-Type': 'video/mp4' } })
    expect(r.status).toBe(200)

    r = await call('/api/scenes/scene0001', { method: 'PUT', body: JSON.stringify({ scene: scene('scene0001'), thumb: 'data:image/jpeg;base64,AAAA' }) })
    expect(r.status).toBe(200)

    r = await call('/api/scenes')
    const list = (await r.json()) as { scenes: { id: string; objects: number; thumb: string }[] }
    expect(list.scenes.map((s) => [s.id, s.objects])).toEqual([['scene0001', 1]])
    expect(list.scenes[0].thumb).toContain('data:image/jpeg')

    r = await call('/api/scenes/scene0001')
    expect(((await r.json()) as { scene: { id: string } }).scene.id).toBe('scene0001')

    // Public byte ranges, as iPhone Safari asks for video.
    r = await call('/api/media/mvideo12345678', { owner: '', headers: { Range: 'bytes=10-19' } })
    expect(r.status).toBe(206)
    expect(r.headers.get('Content-Range')).toBe('bytes 10-19/1000')
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])

    r = await call('/api/scenes/scene0001', { method: 'DELETE' })
    expect(((await r.json()) as { removedMedia: number }).removedMedia).toBe(1)
    expect((await call('/api/media/mvideo12345678')).status).toBe(404)
  })

  it('keeps media another scene still uses', async () => {
    const { call } = await setup()
    await call('/api/media/mshared1234567', { method: 'PUT', body: new Uint8Array(10), headers: { 'Content-Type': 'image/jpeg' } })
    for (const id of ['scenea001', 'sceneb001']) await call(`/api/scenes/${id}`, { method: 'PUT', body: JSON.stringify({ scene: scene(id, 'media:mshared1234567') }) })
    await call('/api/scenes/scenea001', { method: 'DELETE' })
    expect((await call('/api/media/mshared1234567')).status).toBe(200)
  })

  it('keeps phones apart', async () => {
    const { call } = await setup()
    await call('/api/scenes/scene0001', { method: 'PUT', body: JSON.stringify({ scene: scene('scene0001') }) })
    expect((await call('/api/scenes/scene0001', { owner: OTHER })).status).toBe(403)
    expect((await call('/api/scenes/scene0001', { owner: OTHER, method: 'PUT', body: JSON.stringify({ scene: scene('scene0001') }) })).status).toBe(403)
    expect((await call('/api/scenes/scene0001', { owner: OTHER, method: 'DELETE' })).status).toBe(403)
    expect(((await (await call('/api/scenes', { owner: OTHER })).json()) as { scenes: unknown[] }).scenes).toEqual([])
    expect((await call('/api/scenes', { owner: '' })).status).toBe(401)
  })

  it('uploads a big video in parts', async () => {
    const { call } = await setup()
    const size = SINGLE_MAX + 5
    let r = await call('/api/media/mbigvideo12345/parts', { method: 'POST', headers: { 'Content-Type': 'video/mp4', 'X-InRL-Size': String(size) } })
    const { uploadId } = (await r.json()) as { uploadId: string }
    const done = []
    for (const [n, len] of [[1, SINGLE_MAX], [2, 5]]) {
      r = await call(`/api/media/mbigvideo12345/parts/${encodeURIComponent(uploadId)}/${n}`, { method: 'PUT', body: new Uint8Array(len).fill(n) })
      done.push(await r.json())
    }
    r = await call(`/api/media/mbigvideo12345/parts/${encodeURIComponent(uploadId)}`, { method: 'POST', body: JSON.stringify({ parts: done }) })
    expect(r.status).toBe(200)
    r = await call('/api/media/mbigvideo12345', { headers: { Range: `bytes=-6` } })
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([1, 2, 2, 2, 2, 2])
  })

  it('finds the media a scene uses', () => {
    expect(mediaIds(JSON.stringify({ objects: [{ src: 'media:abc123' }, { src: '/test/a.mp4' }, { src: 'media:abc123' }] }))).toEqual(['abc123'])
  })
})
