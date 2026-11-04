/*
 * Accounts (step 3): sign up and sign in with a passkey (Face ID / Touch ID),
 * no password, no email service, no outside key.
 *
 *   POST /api/auth/challenge   → { id, challenge }  one-time, 5 minutes
 *   GET  /api/auth/username?u= → { available, reason? }
 *   POST /api/auth/register    { challengeId, credential, username, name } → { account }
 *   POST /api/auth/login       { challengeId, credential } → { account }
 *   POST /api/auth/logout      unlinks this phone
 *   GET  /api/me               → { account | null }
 *   PATCH /api/me              { name }
 *
 * Signing up or in links the phone (its `X-InRL-Owner` key) to the account
 * and moves the phone's own scenes and media into it (see db.ts).
 */

import { accountOwner, fail, isAdmin, json, randomId, setUp, whoIs, type CloudEnv, type Database } from './db.ts'
import { b64url, checkAuthData, checkClientData, checkPublicKey, fromB64url, PasskeyError, verifySignature } from './passkey.ts'

const CHALLENGE_TTL = 5 * 60 * 1000
export const USERNAME = /^[a-z0-9](?:[a-z0-9._]{1,18}[a-z0-9])$/
const RESERVED = new Set(['inrl', 'admin', 'support', 'help', 'api', 'test', 'me', 'studio', 'scan', 'marker', 'markers', 'settings', 'login', 'signin', 'signup', 'about', 'official', 'team'])

export interface Account {
  id: string
  username: string
  name: string
  bio?: string
  /** Picture URL, or null (a letter is shown). */
  avatar?: string | null
}

export const BIO_MAX = 150

export function usernameProblem(u: string): string | null {
  if (u.length < 3) return 'At least 3 characters.'
  if (u.length > 20) return 'At most 20 characters.'
  if (!USERNAME.test(u)) return 'Letters, numbers, dots and underscores; start and end with a letter or number.'
  if (RESERVED.has(u)) return 'That name is reserved.'
  return null
}

async function newChallenge(db: Database) {
  const id = randomId(20)
  const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const now = Date.now()
  await db.batch([
    db.prepare('DELETE FROM challenges WHERE created < ?').bind(now - CHALLENGE_TTL),
    db.prepare('INSERT INTO challenges (id, challenge, created) VALUES (?, ?, ?)').bind(id, challenge, now),
  ])
  return { id, challenge }
}

/** Each challenge works once. */
async function takeChallenge(db: Database, id: unknown): Promise<string> {
  if (typeof id !== 'string') throw new PasskeyError('Missing challenge.')
  const row = await db.prepare('SELECT challenge, created FROM challenges WHERE id = ?').bind(id).first<{ challenge: string; created: number }>()
  await db.prepare('DELETE FROM challenges WHERE id = ?').bind(id).run()
  if (!row || Date.now() - row.created > CHALLENGE_TTL) throw new PasskeyError('This sign-in attempt expired. Try again.')
  return row.challenge
}

/** Links this phone to the account and moves the phone's own scenes and media into it. */
async function linkPhone(db: Database, phone: string, account: string) {
  const owner = accountOwner(account)
  await db.batch([
    db.prepare('UPDATE scenes SET owner = ? WHERE owner = ?').bind(owner, phone),
    db.prepare('UPDATE media SET owner = ? WHERE owner = ?').bind(owner, phone),
    db.prepare('INSERT INTO phones (phone, account, created) VALUES (?, ?, ?) ON CONFLICT(phone) DO UPDATE SET account = excluded.account').bind(phone, account, Date.now()),
  ])
}

export async function getAccount(db: Database, id: string): Promise<Account | null> {
  return db.prepare('SELECT id, username, name, bio, avatar FROM accounts WHERE id = ?').bind(id).first<Account>()
}

type Body = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')

export async function accountResponse(request: Request, env: CloudEnv): Promise<Response> {
  const db = env.DB
  if (!db) return fail(503, 'Accounts are not set up on this server yet.')
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method
  // The site the passkey belongs to: this address (the browser checks it too).
  const origin = url.origin
  const rpId = url.hostname

  try {
    await setUp(db)

    if (path === '/api/auth/challenge' && method === 'POST') return json(await newChallenge(db))

    if (path === '/api/auth/username' && method === 'GET') {
      const u = (url.searchParams.get('u') ?? '').toLowerCase()
      const problem = usernameProblem(u)
      if (problem) return json({ available: false, reason: problem })
      const taken = await db.prepare('SELECT 1 FROM accounts WHERE username = ?').bind(u).first()
      return json(taken ? { available: false, reason: 'That name is taken.' } : { available: true })
    }

    const who = await whoIs(request, db)
    if (!who) return fail(401, 'Missing phone key.')

    if (path === '/api/me') {
      if (method === 'GET') {
        const account = who.account ? await getAccount(db, who.account) : null
        return json({ account: account && { ...account, admin: isAdmin(env, account.username) } })
      }
      if (method === 'PATCH') {
        if (!who.account) return fail(401, 'Sign in first.')
        const body = (await request.json()) as Body
        // Edit Profile: name and/or bio (each only when sent).
        const now = await getAccount(db, who.account)
        const name = 'name' in body ? str(body.name).trim().slice(0, 40) : (now?.name ?? '')
        const bio = 'bio' in body ? str(body.bio).trim().replace(/\n{3,}/g, '\n\n').slice(0, BIO_MAX) : (now?.bio ?? '')
        await db.prepare('UPDATE accounts SET name = ?, bio = ? WHERE id = ?').bind(name, bio, who.account).run()
        return json({ account: await getAccount(db, who.account) })
      }
      return fail(405, 'Method not allowed')
    }

    if (method !== 'POST') return fail(405, 'Method not allowed')
    const body = (await request.json().catch(() => ({}))) as Body

    if (path === '/api/auth/register') {
      const challenge = await takeChallenge(db, body.challengeId)
      const cred = (body.credential ?? {}) as Body
      const username = str(body.username).toLowerCase()
      const problem = usernameProblem(username)
      if (problem) return fail(400, problem)
      const name = str(body.name).trim().slice(0, 40)
      const credId = str(cred.id)
      if (!/^[A-Za-z0-9_-]{16,1400}$/.test(credId)) throw new PasskeyError('Missing passkey.')
      checkClientData(fromB64url(str(cred.clientDataJSON)), 'webauthn.create', challenge, origin)
      await checkAuthData(fromB64url(str(cred.authenticatorData)), rpId)
      const spki = fromB64url(str(cred.publicKey))
      const alg = Number(cred.alg)
      await checkPublicKey(spki, alg)
      if (await db.prepare('SELECT 1 FROM accounts WHERE username = ?').bind(username).first()) return fail(409, 'That name is taken.')
      // The account id is the passkey's "user handle" the phone made up.
      const id = str(body.userId)
      if (!/^[a-z0-9]{16,40}$/.test(id) || (await getAccount(db, id))) return fail(400, 'Bad account id.')
      const now = Date.now()
      await db.batch([
        db.prepare('INSERT INTO accounts (id, username, name, created, hidden) VALUES (?, ?, ?, ?, ?)').bind(id, username, name, now, request.headers.get('X-InRL-Test') === '1' ? 1 : 0),
        db.prepare('INSERT INTO credentials (id, account, public_key, alg, created, used) VALUES (?, ?, ?, ?, ?, ?)').bind(credId, id, b64url(spki), alg, now, now),
      ])
      await linkPhone(db, who.phone, id)
      return json({ account: await getAccount(db, id) })
    }

    if (path === '/api/auth/login') {
      const challenge = await takeChallenge(db, body.challengeId)
      const cred = (body.credential ?? {}) as Body
      const row = await db
        .prepare('SELECT account, public_key, alg, sign_count FROM credentials WHERE id = ?')
        .bind(str(cred.id))
        .first<{ account: string; public_key: string; alg: number; sign_count: number }>()
      if (!row) return fail(404, 'This passkey is not known here. Was its account deleted?')
      const clientData = fromB64url(str(cred.clientDataJSON))
      const authData = fromB64url(str(cred.authenticatorData))
      checkClientData(clientData, 'webauthn.get', challenge, origin)
      const { signCount } = await checkAuthData(authData, rpId)
      await verifySignature(fromB64url(row.public_key), row.alg, authData, clientData, fromB64url(str(cred.signature)))
      // Synced passkeys (iCloud Keychain) always report 0; a counter that goes backwards means a cloned key.
      if (signCount !== 0 && signCount <= row.sign_count) throw new PasskeyError('This passkey looks copied. Sign in again.')
      await db.prepare('UPDATE credentials SET sign_count = ?, used = ? WHERE id = ?').bind(signCount, Date.now(), str(cred.id)).run()
      await linkPhone(db, who.phone, row.account)
      return json({ account: await getAccount(db, row.account) })
    }

    if (path === '/api/auth/logout') {
      await db.prepare('DELETE FROM phones WHERE phone = ?').bind(who.phone).run()
      return json({ ok: true })
    }

    return fail(404, 'Not found')
  } catch (e) {
    if (e instanceof PasskeyError) return fail(400, e.message)
    if (e instanceof Response) return e
    return fail(500, e instanceof Error ? e.message : String(e))
  }
}
