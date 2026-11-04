import { describe, expect, it } from 'vitest'
import { accountResponse } from './accounts.ts'
import { cloudResponse } from './cloud.ts'
import { devBucket, devDatabase } from './devCloud.ts'
import { b64url, derToRaw } from './passkey.ts'
import { publishResponse } from './publish.ts'
import { apiRoute } from './routes.ts'

/*
 * Accounts, publishing and markers, end to end through the API, with a
 * software passkey (a P-256 key pair made here) standing in for Face ID.
 */

const ORIGIN = 'https://inrl.example'
const PHONE = 'a'.repeat(48)
const PHONE2 = 'c'.repeat(48)

async function setup() {
  const env = { DB: await devDatabase(), MEDIA: devBucket() }
  const call = async (path: string, init: RequestInit & { phone?: string; json?: unknown } = {}) => {
    const headers = new Headers(init.headers)
    if (init.phone !== '') headers.set('X-InRL-Owner', init.phone ?? PHONE)
    const body = init.json !== undefined ? JSON.stringify(init.json) : init.body
    const req = new Request(`${ORIGIN}${path}`, { ...init, body, headers })
    const route = apiRoute(path.split('?')[0])
    const handler = route === 'cloud' ? cloudResponse : route === 'accounts' ? accountResponse : publishResponse
    const res = await handler(req, env)
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, any> }
  }
  return { env, call }
}

/** A passkey like the phone's: the browser's view of create() and get(). */
async function softPasskey() {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey))
  const id = b64url(crypto.getRandomValues(new Uint8Array(20)))
  let counter = 0
  const authData = async (rpId = 'inrl.example') => {
    const out = new Uint8Array(37)
    out.set(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId))))
    out[32] = 0x05 // present + verified
    new DataView(out.buffer).setUint32(33, counter)
    return out
  }
  const clientData = (type: string, challenge: string, origin = ORIGIN) => new TextEncoder().encode(JSON.stringify({ type, challenge, origin }))
  return {
    id,
    create: async (challenge: string, origin?: string) => ({
      id,
      clientDataJSON: b64url(clientData('webauthn.create', challenge, origin)),
      authenticatorData: b64url(await authData()),
      publicKey: b64url(spki),
      alg: -7,
    }),
    get: async (challenge: string, opts: { counter?: number; origin?: string } = {}) => {
      if (opts.counter !== undefined) counter = opts.counter
      const ad = await authData()
      const cd = clientData('webauthn.get', challenge, opts.origin)
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', cd))
      const signed = new Uint8Array([...ad, ...hash])
      const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, signed))
      return { id, clientDataJSON: b64url(cd), authenticatorData: b64url(ad), signature: b64url(rawToDer(raw)) }
    },
  }
}

function rawToDer(raw: Uint8Array) {
  const int = (b: Uint8Array) => {
    let i = 0
    while (i < b.length - 1 && b[i] === 0) i++
    let v = b.subarray(i)
    if (v[0] & 0x80) v = new Uint8Array([0, ...v])
    return [0x02, v.length, ...v]
  }
  const body = [...int(raw.subarray(0, 32)), ...int(raw.subarray(32))]
  return new Uint8Array([0x30, body.length, ...body])
}

async function signUp(call: Awaited<ReturnType<typeof setup>>['call'], pk: Awaited<ReturnType<typeof softPasskey>>, username = 'nico', phone = PHONE) {
  const ch = await call('/api/auth/challenge', { method: 'POST', phone })
  return call('/api/auth/register', {
    method: 'POST',
    phone,
    json: { challengeId: ch.body.id, credential: await pk.create(ch.body.challenge), username, name: 'Nico', userId: 'u' + 'x'.repeat(19) + username.length },
  })
}

describe('passkey helpers', () => {
  it('turns DER signatures into raw ones', () => {
    const raw = new Uint8Array(64).map((_, i) => (i === 0 || i === 32 ? 0x80 : i))
    expect([...derToRaw(rawToDer(raw))]).toEqual([...raw])
    const small = new Uint8Array(64).map((_, i) => (i < 3 || (i >= 32 && i < 34) ? 0 : i))
    expect([...derToRaw(rawToDer(small))]).toEqual([...small])
  })
})

describe('accounts API', () => {
  it('signs up with a passkey, moves the phone scenes into the account, signs in on another phone', async () => {
    const { call } = await setup()
    // A scene saved before signing in belongs to the phone.
    const scene = { version: 1, id: 'scene0001', objects: [{ id: 'o1', kind: 'text', text: 'hi' }] }
    expect((await call('/api/scenes/scene0001', { method: 'PUT', json: { scene } })).status).toBe(200)
    expect((await call('/api/me')).body.account).toBeNull()

    expect((await call('/api/auth/username?u=Ni')).body.available).toBe(false)
    expect((await call('/api/auth/username?u=nico')).body.available).toBe(true)

    const pk = await softPasskey()
    const r = await signUp(call, pk)
    expect(r.status).toBe(200)
    expect(r.body.account.username).toBe('nico')
    expect((await call('/api/me')).body.account.username).toBe('nico')
    expect((await call('/api/auth/username?u=nico')).body.available).toBe(false)

    // Same scene list through the same phone key (now the account's).
    expect((await call('/api/scenes')).body.scenes.map((s: { id: string }) => s.id)).toEqual(['scene0001'])

    // Another phone sees nothing until it signs in with the (synced) passkey.
    expect((await call('/api/scenes', { phone: PHONE2 })).body.scenes).toEqual([])
    const ch = await call('/api/auth/challenge', { method: 'POST', phone: PHONE2 })
    const login = await call('/api/auth/login', { method: 'POST', phone: PHONE2, json: { challengeId: ch.body.id, credential: await pk.get(ch.body.challenge) } })
    expect(login.status).toBe(200)
    expect(login.body.account.username).toBe('nico')
    expect((await call('/api/scenes', { phone: PHONE2 })).body.scenes.map((s: { id: string }) => s.id)).toEqual(['scene0001'])

    // Signing out unlinks only that phone.
    expect((await call('/api/auth/logout', { method: 'POST', phone: PHONE2 })).status).toBe(200)
    expect((await call('/api/me', { phone: PHONE2 })).body.account).toBeNull()
    expect((await call('/api/me')).body.account.username).toBe('nico')
  })

  it('refuses replays, other sites, wrong signatures and taken names', async () => {
    const { call } = await setup()
    const pk = await softPasskey()
    expect((await signUp(call, pk)).status).toBe(200)
    expect((await signUp(call, await softPasskey(), 'nico', PHONE2)).status).toBe(409)

    // A challenge works once.
    let ch = await call('/api/auth/challenge', { method: 'POST' })
    const cred = await pk.get(ch.body.challenge)
    expect((await call('/api/auth/login', { method: 'POST', json: { challengeId: ch.body.id, credential: cred } })).status).toBe(200)
    expect((await call('/api/auth/login', { method: 'POST', json: { challengeId: ch.body.id, credential: cred } })).status).toBe(400)

    // Answer made for another site.
    ch = await call('/api/auth/challenge', { method: 'POST' })
    expect((await call('/api/auth/login', { method: 'POST', json: { challengeId: ch.body.id, credential: await pk.get(ch.body.challenge, { origin: 'https://evil.example' }) } })).status).toBe(400)

    // Someone else's key signing for this passkey id.
    const other = await softPasskey()
    ch = await call('/api/auth/challenge', { method: 'POST' })
    const forged = { ...(await other.get(ch.body.challenge)), id: pk.id }
    const res = await call('/api/auth/login', { method: 'POST', json: { challengeId: ch.body.id, credential: forged } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/signature/)
  })
})

describe('publishing API', () => {
  it('publishes posts, makes the marker, shows them on /api/m/:code, keeps post media', async () => {
    const { call, env } = await setup()
    // Not signed in: no publishing.
    expect((await call('/api/posts', { method: 'POST', json: {} })).status).toBe(401)
    await signUp(call, await softPasskey())

    // A video scene: the video must be uploaded first.
    const scene = { version: 1, id: 'scene0002', objects: [{ id: 'o1', kind: 'video', src: 'media:mvideo12345678' }] }
    let r = await call('/api/posts', { method: 'POST', json: { scene, caption: 'First!', attach: true } })
    expect(r.status).toBe(409)
    const put = await cloudResponse(new Request(`${ORIGIN}/api/media/mvideo12345678`, { method: 'PUT', body: new Uint8Array(10), headers: { 'Content-Type': 'video/mp4', 'X-InRL-Owner': PHONE } }), env)
    expect(put.status).toBe(200)

    // Marker first (attach needs one), then the post.
    r = await call('/api/me/marker', { method: 'POST', json: {} })
    const code = r.body.marker.code as string
    expect(code).toMatch(/^[a-z2-9]{7}$/)
    expect(r.body.marker.ready).toBe(false)
    expect((await call(`/api/me/marker/mind`, { method: 'PUT', body: new Uint8Array(5), headers: { 'X-InRL-Matching': '900' } })).status).toBe(409)
    expect((await call(`/api/me/marker/image`, { method: 'PUT', body: new Uint8Array(5) })).status).toBe(200)
    expect((await call(`/api/me/marker/mind`, { method: 'PUT', body: new Uint8Array(5), headers: { 'X-InRL-Matching': '100' } })).status).toBe(422)
    r = await call(`/api/me/marker/mind`, { method: 'PUT', body: new Uint8Array(5), headers: { 'X-InRL-Matching': '900' } })
    expect(r.body.marker.ready).toBe(true)

    r = await call('/api/posts', { method: 'POST', json: { scene, caption: 'First!', attach: true, thumb: 'data:image/jpeg;base64,AA' } })
    expect(r.status).toBe(200)
    const first = r.body.post.id as string
    r = await call('/api/posts', { method: 'POST', json: { scene: { ...scene, objects: [{ id: 'o2', kind: 'text', text: 'two' }] }, caption: 'Second', attach: false } })
    const second = r.body.post.id as string

    // Scanning shows the attached post (not the newest), the owner, and all posts.
    r = await call(`/api/m/${code}`, { phone: '' })
    expect(r.status).toBe(200)
    expect(r.body.owner.username).toBe('nico')
    expect(r.body.post.id).toBe(first)
    expect(r.body.post.scene.objects[0].src).toBe('media:mvideo12345678')
    expect(r.body.posts.map((p: { id: string }) => p.id)).toEqual([second, first])
    // Pictures come on their own, not inside the list.
    expect(r.body.post.thumb).toBe(`/api/posts/${first}/picture`)
    const pic = await publishResponse(new Request(`${ORIGIN}/api/posts/${first}/picture`), env)
    expect(pic.status).toBe(200)
    expect(pic.headers.get('Content-Type')).toBe('image/jpeg')
    expect(r.body.marker.mind).toBe(`/api/markers/${code}-1.mind`)
    expect((await publishResponse(new Request(`${ORIGIN}${r.body.marker.mind}`), env)).status).toBe(200)

    // The draft scene's deletion keeps the post's video.
    await call('/api/scenes/scene0002', { method: 'PUT', json: { scene } })
    r = await call('/api/scenes/scene0002', { method: 'DELETE' })
    expect(r.body.removedMedia).toBe(0)
    expect((await cloudResponse(new Request(`${ORIGIN}/api/media/mvideo12345678`), env)).status).toBe(200)

    // Attach another post; delete it → the marker falls back to the newest.
    expect((await call('/api/me/marker/post', { method: 'PUT', json: { post: second } })).body.marker.post).toBe(second)
    expect((await call(`/api/posts/${second}`, { method: 'DELETE' })).status).toBe(200)
    r = await call(`/api/m/${code}`, { phone: '' })
    expect(r.body.post.id).toBe(first)

    // New design: same code, next version, not ready until its files arrive.
    r = await call('/api/me/marker', { method: 'POST', json: { redesign: true } })
    expect(r.body.marker).toMatchObject({ code, version: 2, ready: false })

    // Others can't touch it.
    expect((await call(`/api/posts/${first}`, { method: 'DELETE', phone: PHONE2 })).status).toBe(401)
  })
})
