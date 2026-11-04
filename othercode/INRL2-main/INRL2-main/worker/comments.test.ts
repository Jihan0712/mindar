import { describe, expect, it } from 'vitest'
import { commentsResponse, PER_MINUTE } from './comments.ts'
import { phoneOf, setUp } from './db.ts'
import { devBucket, devDatabase } from './devCloud.ts'
import { publishResponse } from './publish.ts'
import { apiRoute } from './routes.ts'
import { socialResponse } from './social.ts'

const ORIGIN = 'https://inrl.example'
const phoneKey = (n: number) => String(n).repeat(48).slice(0, 48)

async function setup() {
  const env = { DB: await devDatabase(), MEDIA: devBucket() }
  await setUp(env.DB)
  const call = async (path: string, init: RequestInit & { phone?: number; json?: unknown } = {}) => {
    const headers = new Headers(init.headers)
    if (init.phone !== undefined) headers.set('X-InRL-Owner', phoneKey(init.phone))
    const body = init.json !== undefined ? JSON.stringify(init.json) : init.body
    const route = apiRoute(path.split('?')[0])
    const handler = route === 'comments' ? commentsResponse : route === 'social' ? socialResponse : publishResponse
    const res = await handler(new Request(`${ORIGIN}${path}`, { ...init, body, headers }), env)
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, any> }
  }
  const person = async (n: number, username: string, hidden = 0) => {
    const id = `acct${username}`.padEnd(16, 'x')
    const phone = await phoneOf(new Request(ORIGIN, { headers: { 'X-InRL-Owner': phoneKey(n) } }))
    await env.DB.prepare('INSERT INTO accounts (id, username, name, created, hidden) VALUES (?, ?, ?, ?, ?)').bind(id, username, username, Date.now(), hidden).run()
    await env.DB.prepare('INSERT INTO phones (phone, account, created) VALUES (?, ?, ?)').bind(phone, id, Date.now()).run()
  }
  const publish = async (n: number) => {
    const r = await call('/api/posts', { method: 'POST', phone: n, json: { scene: { version: 1, id: 's', objects: [{ id: 'o', kind: 'text', text: 'hi' }] } } })
    return r.body.post.id as string
  }
  return { env, call, person, publish }
}

describe('comments', () => {
  it('adds, lists, likes, hides and deletes comments with the right rights', async () => {
    const { env, call, person, publish } = await setup()
    await person(1, 'nico')
    await person(2, 'ana')
    await person(3, 'bob')
    const post = await publish(1)
    const path = `/api/posts/${post}/comments`

    expect((await call(path, { method: 'POST', json: { text: 'hi' } })).status).toBe(401)
    expect((await call(path, { method: 'POST', phone: 2, json: { text: '   ' } })).status).toBe(400)
    expect((await call(path, { method: 'POST', phone: 2, json: { text: 'x'.repeat(301) } })).status).toBe(413)
    const a = await call(path, { method: 'POST', phone: 2, json: { text: 'LOL CUTE!' } })
    expect(a.body).toMatchObject({ count: 1, comment: { text: 'LOL CUTE!', mine: true, author: { username: 'ana' } } })
    const b = (await call(path, { method: 'POST', phone: 3, json: { text: '@ana same' } })).body.comment
    expect((await call(`/api/posts/${post}`)).body.post.comments).toBe(2)

    // Public list, oldest first; the post's author may moderate.
    let list = await call(path)
    expect(list.body.comments.map((c: { text: string }) => c.text)).toEqual(['LOL CUTE!', '@ana same'])
    expect(list.body.moderator).toBe(false)
    expect((await call(path, { phone: 1 })).body.moderator).toBe(true)

    // Likes.
    expect((await call(`/api/comments/${b.id}/like`, { method: 'POST', phone: 1 })).body).toEqual({ liked: true, likes: 1 })
    expect((await call(path, { phone: 1 })).body.comments[1]).toMatchObject({ likes: 1, liked: true })

    // Only the post's author hides; hidden: gone for others, still there for its writer and the author.
    expect((await call(`/api/comments/${b.id}/hide`, { method: 'POST', phone: 2 })).status).toBe(403)
    expect((await call(`/api/comments/${b.id}/hide`, { method: 'POST', phone: 1 })).body).toEqual({ hidden: true, count: 1 })
    expect((await call(path, { phone: 2 })).body.comments).toHaveLength(1)
    expect((await call(path, { phone: 3 })).body.comments[1]).toMatchObject({ hidden: true, mine: true })
    expect((await call(path, { phone: 1 })).body.comments).toHaveLength(2)
    expect((await call(`/api/comments/${b.id}/unhide`, { method: 'POST', phone: 1 })).body.count).toBe(2)

    // Delete: its writer or the post's author, not a third person.
    expect((await call(`/api/comments/${a.body.comment.id}`, { method: 'DELETE', phone: 3 })).status).toBe(403)
    expect((await call(`/api/comments/${a.body.comment.id}`, { method: 'DELETE', phone: 2 })).body.count).toBe(1)
    expect((await call(`/api/comments/${b.id}`, { method: 'DELETE', phone: 1 })).body.count).toBe(0)
    list = await call(path)
    expect(list.body.comments).toEqual([])
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM comment_likes').first<{ n: number }>()).toEqual({ n: 0 })
  })

  it('brakes floods, shows in notifications, goes with the post', async () => {
    const { env, call, person, publish } = await setup()
    await person(1, 'nico')
    await person(2, 'ana')
    const post = await publish(1)
    const path = `/api/posts/${post}/comments`
    for (let i = 0; i < PER_MINUTE; i++) expect((await call(path, { method: 'POST', phone: 2, json: { text: `n${i}` } })).status).toBe(200)
    expect((await call(path, { method: 'POST', phone: 2, json: { text: 'one more' } })).status).toBe(429)
    const items = (await call('/api/notifications', { phone: 1 })).body.items
    expect(items[0]).toMatchObject({ kind: 'comment', person: { username: 'ana' }, post: { id: post }, text: `n${PER_MINUTE - 1}` })
    expect((await call('/api/notifications/new', { phone: 1 })).body.new).toBe(true)
    expect((await call(`/api/posts/${post}`, { method: 'DELETE', phone: 1 })).status).toBe(200)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM comments').first<{ n: number }>()).toEqual({ n: 0 })
    expect((await call(path)).status).toBe(404)
  })
})
