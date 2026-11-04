import { useSyncExternalStore } from 'react'
import { api, newPhoneKey, syncAll } from '../studio/cloud'
import { forgetAllScenes, listScenes } from '../studio/scenes'

/*
 * The signed-in account, phone side (step 3). Sign-in is a passkey (Face ID /
 * Touch ID, kept in iCloud Keychain): no password. The server (worker/
 * accounts.ts) links this phone's key to the account, so cloud saving and
 * everything else keep sending the same key.
 *
 * The account is cached in localStorage so screens know at once whether
 * someone is signed in; `refreshAccount()` checks with the server.
 */

export interface Account {
  id: string
  username: string
  name: string
  bio?: string
  /** Profile picture URL, or null: a letter is shown. */
  avatar?: string | null
  /** Part of InRL's team: can read reports (/admin). */
  admin?: boolean
}

const KEY = 'inrl.account'
const events = new EventTarget()

function read(): Account | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null')
  } catch {
    return null
  }
}
let current: Account | null = read()

function setAccount(a: Account | null) {
  current = a
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a))
    else localStorage.removeItem(KEY)
  } catch {
    // private mode: kept for this visit
  }
  events.dispatchEvent(new Event('change'))
}

export const getAccount = () => current

export function useAccount(): Account | null {
  return useSyncExternalStore(
    (fn) => {
      events.addEventListener('change', fn)
      return () => events.removeEventListener('change', fn)
    },
    () => current,
  )
}

/** Asks the server who this phone is signed in as (e.g. after signing out on another screen). */
export async function refreshAccount() {
  const { account } = await api<{ account: Account | null }>('/api/me')
  if (JSON.stringify(account) !== JSON.stringify(current)) setAccount(account)
  return account
}

export async function updateName(name: string) {
  await updateProfile({ name })
}

/** Edit Profile: name and/or bio. */
export async function updateProfile(changes: { name?: string; bio?: string }) {
  const { account } = await api<{ account: Account }>('/api/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  })
  setAccount(account)
  return account
}

/** The profile picture (a square JPEG, already cropped), or null to remove it. */
export async function updateAvatar(jpeg: Blob | null) {
  const { avatar } = await api<{ avatar: string | null }>('/api/me/avatar', jpeg ? { method: 'PUT', body: jpeg, headers: { 'Content-Type': 'image/jpeg' } } : { method: 'DELETE' })
  if (current) setAccount({ ...current, avatar })
  return avatar
}

/** Whether this browser can make and use passkeys at all. */
export function passkeysSupported() {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials?.create
}

export async function checkUsername(u: string): Promise<{ available: boolean; reason?: string }> {
  return api(`/api/auth/username?u=${encodeURIComponent(u)}`)
}

// ------------------------------------------------------------- passkeys

const b64url = (buf: ArrayBuffer) => {
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64url = (text: string) => {
  const s = text.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))
}

export interface Challenge { id: string; challenge: string; at: number }

/**
 * Safari only shows the passkey sheet when it is asked for straight from a
 * tap, so the server's one-time challenge is fetched beforehand (when the
 * screen opens) and the tap calls the passkey API first thing.
 */
export async function prepareChallenge(): Promise<Challenge> {
  const ch = await api<{ id: string; challenge: string }>('/api/auth/challenge', { method: 'POST' })
  return { ...ch, at: Date.now() }
}
/** Challenges live 5 minutes on the server; refresh a little before. */
export const challengeFresh = (ch: Challenge | null): ch is Challenge => !!ch && Date.now() - ch.at < 4 * 60_000

const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** Turns the browser's passkey errors into words. Cancelling returns null (not an error to show). */
function passkeyProblem(e: unknown): string | null {
  const name = (e as DOMException)?.name
  if (name === 'NotAllowedError' || name === 'AbortError') return null
  if (name === 'InvalidStateError') return 'This phone already has an InRL passkey. Use “I already have an account”.'
  if (name === 'SecurityError') return 'Passkeys only work on the InRL site itself.'
  return e instanceof Error ? e.message : String(e)
}

export class Cancelled extends Error {}

/** Makes a passkey for a new account and signs this phone in. Call from the tap, with a prepared challenge. */
export async function signUp(username: string, name: string, ch: Challenge): Promise<Account> {
  const userId = Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')
  let cred: PublicKeyCredential
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        rp: { name: 'InRL', id: location.hostname },
        user: { id: new TextEncoder().encode(userId), name: `@${username}`, displayName: name || `@${username}` },
        challenge: fromB64url(ch.challenge),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
        attestation: 'none',
        timeout: 120_000,
      },
    })) as PublicKeyCredential
  } catch (e) {
    const problem = passkeyProblem(e)
    throw problem ? new Error(problem) : new Cancelled()
  }
  const res = cred.response as AuthenticatorAttestationResponse
  const publicKey = res.getPublicKey?.()
  if (!publicKey) throw new Error('This browser is too old for passkeys. Update iOS, then try again.')
  const { account } = await post<{ account: Account }>('/api/auth/register', {
    challengeId: ch.id,
    userId,
    username,
    name,
    credential: {
      id: cred.id,
      clientDataJSON: b64url(res.clientDataJSON),
      authenticatorData: b64url(res.getAuthenticatorData()),
      publicKey: b64url(publicKey),
      alg: res.getPublicKeyAlgorithm(),
    },
  })
  setAccount(account)
  return account
}

/** Signs in with an existing passkey (the phone offers the ones it has for this site). Call from the tap. */
export async function signIn(ch: Challenge): Promise<Account> {
  let cred: PublicKeyCredential
  try {
    cred = (await navigator.credentials.get({
      publicKey: { challenge: fromB64url(ch.challenge), rpId: location.hostname, userVerification: 'preferred', timeout: 120_000 },
    })) as PublicKeyCredential
  } catch (e) {
    const problem = passkeyProblem(e)
    throw problem ? new Error(problem) : new Cancelled()
  }
  const res = cred.response as AuthenticatorAssertionResponse
  const { account } = await post<{ account: Account }>('/api/auth/login', {
    challengeId: ch.id,
    credential: {
      id: cred.id,
      clientDataJSON: b64url(res.clientDataJSON),
      authenticatorData: b64url(res.authenticatorData),
      signature: b64url(res.signature),
    },
  })
  setAccount(account)
  return account
}

/**
 * Signs this phone out. Its scenes belong to the account, so they must all be
 * in the cloud first; then the phone forgets them and gets a fresh key.
 */
export async function signOut() {
  await syncAll()
  if (listScenes().some((m) => m.cloud !== 'saved')) throw new Error('Some scenes are not saved in the cloud yet. Connect to the internet, then try again.')
  await post('/api/auth/logout', {})
  forgetAllScenes()
  newPhoneKey()
  setAccount(null)
}
