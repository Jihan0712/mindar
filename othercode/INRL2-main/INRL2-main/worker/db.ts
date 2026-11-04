/*
 * What the API modules share: the Cloudflare bindings they use (R2, D1),
 * JSON answers, the D1 tables, and who is asking.
 *
 * Who is asking: every phone has a private random key (sent as the
 * `X-InRL-Owner` header; we store only its SHA-256). Before signing in, the
 * phone itself owns its scenes and media. Signing in links the phone to an
 * account (table `phones`); from then on the same header stands for the
 * account, so cloud saving needs no change and the iPhone floor test app,
 * which was handed the phone key, sees the account's scenes too.
 */

/** The parts of Cloudflare's R2 bucket we use (the dev stand-in implements the same). */
export interface Bucket {
  put(key: string, body: ArrayBuffer | ReadableStream | null, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
  head(key: string): Promise<{ size: number; httpMetadata?: { contentType?: string } } | null>
  get(key: string, opts?: { range?: { offset: number; length: number } }): Promise<{ body: ReadableStream; size: number; httpMetadata?: { contentType?: string } } | null>
  delete(keys: string | string[]): Promise<void>
  createMultipartUpload(key: string, opts?: { httpMetadata?: { contentType?: string } }): Promise<{ uploadId: string }>
  resumeMultipartUpload(key: string, uploadId: string): {
    uploadPart(n: number, body: ArrayBuffer | ReadableStream): Promise<{ partNumber: number; etag: string }>
    complete(parts: { partNumber: number; etag: string }[]): Promise<unknown>
  }
}

/** The parts of Cloudflare's D1 database we use. */
export interface Database {
  prepare(sql: string): Statement
  batch(statements: Statement[]): Promise<unknown>
}
export interface Statement {
  bind(...values: unknown[]): Statement
  run(): Promise<unknown>
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
}

export interface CloudEnv {
  MEDIA?: Bucket
  DB?: Database
  /** User names who can read reports and remove content (wrangler.jsonc `vars`), comma-separated. */
  ADMINS?: string
}

export const isAdmin = (env: CloudEnv, username: string | null | undefined) =>
  !!username && (env.ADMINS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(username.toLowerCase())

/**
 * SQL condition: neither the viewer nor the account in `col` blocked the
 * other (bind the viewer twice; '' when signed out matches nothing).
 */
export const notBlocked = (col: string) => `NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ? AND b.blocked = ${col}) OR (b.blocker = ${col} AND b.blocked = ?))`

/** Whether two accounts blocked each other (either way). */
export async function blockedBetween(db: Database, a: string | null, b: string | null) {
  if (!a || !b || a === b) return false
  return !!(await db.prepare('SELECT 1 FROM blocks WHERE (blocker = ? AND blocked = ?) OR (blocker = ? AND blocked = ?)').bind(a, b, b, a).first())
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })
export const fail = (status: number, error: string) => json({ error }, status)

/** Ids we make (scenes, media, posts): lowercase letters and digits. */
export const ID = /^[a-z0-9]{8,40}$/

/**
 * Tables are created once per worker instance. Only the fact that it is done is
 * shared between requests, never the promise: in Workers, a request that awaits
 * I/O started by another request hangs forever if that request is cancelled
 * (video players cancel range requests all the time), which froze every later
 * request, videos included. Running the CREATE … IF NOT EXISTS twice is harmless.
 */
const ready = new WeakSet<Database>()
export async function setUp(db: Database) {
  if (ready.has(db)) return
  await db.batch(
    [
      // Cloud saving (step 2).
      "CREATE TABLE IF NOT EXISTS scenes (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', data TEXT NOT NULL, thumb TEXT, objects INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL)",
      'CREATE INDEX IF NOT EXISTS scenes_owner ON scenes (owner, updated)',
      'CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, owner TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)',
      'CREATE INDEX IF NOT EXISTS media_owner ON media (owner)',
      // Accounts (step 3): passkeys, and the phones signed in to each account.
      "CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL)",
      'CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, account TEXT NOT NULL, public_key TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, used INTEGER NOT NULL)',
      'CREATE INDEX IF NOT EXISTS credentials_account ON credentials (account)',
      'CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, challenge TEXT NOT NULL, created INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS phones (phone TEXT PRIMARY KEY, account TEXT NOT NULL, created INTEGER NOT NULL)',
      // Publishing (step 3): posts (a copy of a scene) and one marker per account.
      "CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, account TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', data TEXT NOT NULL, thumb TEXT, objects INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)",
      'CREATE INDEX IF NOT EXISTS posts_account ON posts (account, created)',
      'CREATE TABLE IF NOT EXISTS markers (code TEXT PRIMARY KEY, account TEXT NOT NULL UNIQUE, seed TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, ready INTEGER NOT NULL DEFAULT 0, matching INTEGER NOT NULL DEFAULT 0, post TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL)',
      // Social layer (step 5): follows, and views counted once per person per day.
      'CREATE TABLE IF NOT EXISTS follows (follower TEXT NOT NULL, followee TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (follower, followee))',
      'CREATE INDEX IF NOT EXISTS follows_followee ON follows (followee, created)',
      'CREATE TABLE IF NOT EXISTS views (post TEXT NOT NULL, viewer TEXT NOT NULL, day INTEGER NOT NULL, PRIMARY KEY (post, viewer, day))',
      // Likes: one per person per post; what notifications are made of (with follows).
      'CREATE TABLE IF NOT EXISTS likes (post TEXT NOT NULL, account TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (post, account))',
      'CREATE INDEX IF NOT EXISTS likes_account ON likes (account)',
      // Comments (C12): text ≤ 300; the post's author can hide them; each can be liked.
      "CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, post TEXT NOT NULL, account TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0)",
      'CREATE INDEX IF NOT EXISTS comments_post ON comments (post, created)',
      'CREATE INDEX IF NOT EXISTS comments_account ON comments (account, created)',
      'CREATE TABLE IF NOT EXISTS comment_likes (comment TEXT NOT NULL, account TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (comment, account))',
      // Safety (piece 8): blocks hide two people from each other; reports go to InRL's admins.
      'CREATE TABLE IF NOT EXISTS blocks (blocker TEXT NOT NULL, blocked TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (blocker, blocked))',
      'CREATE INDEX IF NOT EXISTS blocks_blocked ON blocks (blocked)',
      "CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, reporter TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0)",
    ].map((sql) => db.prepare(sql)),
  )
  // Columns added after their table existed: ADD COLUMN fails once it is there, which is fine.
  for (const sql of COLUMNS) await db.prepare(sql).run().catch(() => {})
  // The throwaway account the step-3 live test left behind (decision 2026-10-07).
  await db.prepare("UPDATE accounts SET hidden = 1 WHERE username = 'tmuxbfper'").run().catch(() => {})
  ready.add(db)
}

const COLUMNS = [
  // Test accounts (made by the automated tests) never show to real people.
  'ALTER TABLE accounts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0',
  // Profiles (step 5): a short bio and a picture (its R2 file, versioned so it caches for good).
  "ALTER TABLE accounts ADD COLUMN bio TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE accounts ADD COLUMN avatar TEXT',
  // Notifications: when the person last opened them (the bell's dot is anything newer).
  'ALTER TABLE accounts ADD COLUMN notes_seen INTEGER NOT NULL DEFAULT 0',
  // Counts kept on the post so lists stay quick; rank = created, nudged up by recent likes.
  'ALTER TABLE posts ADD COLUMN likes INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE posts ADD COLUMN views INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE posts ADD COLUMN comments INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE posts ADD COLUMN featured INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE posts ADD COLUMN rank INTEGER',
]

export function hex(bytes: ArrayBuffer | Uint8Array) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** SHA-256 of the phone key, or null without a (well-formed) key. */
export async function phoneOf(request: Request): Promise<string | null> {
  const key = request.headers.get('X-InRL-Owner') ?? ''
  if (!/^[a-f0-9]{32,64}$/.test(key)) return null
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`inrl-owner:${key}`)))
}

/** The owner string of an account's scenes, media and posts. */
export const accountOwner = (account: string) => `a:${account}`

/**
 * Who owns what this request touches: the signed-in account the phone is
 * linked to, else the phone itself. Call after setUp().
 */
export async function whoIs(request: Request, db: Database): Promise<{ owner: string; phone: string; account: string | null } | null> {
  const phone = await phoneOf(request)
  if (!phone) return null
  const row = await db.prepare('SELECT account FROM phones WHERE phone = ?').bind(phone).first<{ account: string }>()
  return row ? { owner: accountOwner(row.account), phone, account: row.account } : { owner: phone, phone, account: null }
}

/** Random id from our alphabet. */
export function randomId(length = 16, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789') {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

/** Ids of the person's own media a scene uses ("media:<id>" sources). */
export function mediaIds(data: string): string[] {
  return [...new Set([...data.matchAll(/"media:([a-z0-9]+)"/g)].map((m) => m[1]))]
}

/** Every media id an owner's scenes and posts still use (posts keep their media alive). */
export async function usedMedia(db: Database, owner: string): Promise<Set<string>> {
  const scenes = await db.prepare('SELECT data FROM scenes WHERE owner = ?').bind(owner).all<{ data: string }>()
  const used = new Set(scenes.results.flatMap((r) => mediaIds(r.data)))
  if (owner.startsWith('a:')) {
    const posts = await db.prepare('SELECT data FROM posts WHERE account = ?').bind(owner.slice(2)).all<{ data: string }>()
    for (const r of posts.results) for (const m of mediaIds(r.data)) used.add(m)
  }
  return used
}
