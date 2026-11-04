/*
 * Passkey checks (WebAuthn), with the platform's WebCrypto only: no library,
 * no key, no outside service.
 *
 * Signing up, the phone makes a key pair for this site and gives us the
 * public half (the browser hands it over ready to use, as "SPKI", via
 * `response.getPublicKey()`); we keep it. Signing in, the phone signs our
 * one-time challenge with the private half, which never leaves the phone
 * (Face ID unlocks it), and we check the signature with the stored public
 * key. Attestation (proof of which device made the key) is not asked for:
 * it only matters for corporate security policies.
 */

export const ES256 = -7
export const RS256 = -257

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of u) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const s = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function sha256(data: Uint8Array<ArrayBuffer> | string): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

export class PasskeyError extends Error {}

/** What the browser says it did (clientDataJSON): checks the kind, our challenge and the site. */
export function checkClientData(clientDataJSON: Uint8Array, type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string) {
  let data: { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean }
  try {
    data = JSON.parse(new TextDecoder().decode(clientDataJSON))
  } catch {
    throw new PasskeyError('Unreadable passkey answer.')
  }
  if (data.type !== type) throw new PasskeyError('Wrong kind of passkey answer.')
  if (data.challenge !== challenge) throw new PasskeyError('This sign-in attempt expired. Try again.')
  if (data.origin !== origin) throw new PasskeyError('This passkey answer came from another site.')
  if (data.crossOrigin) throw new PasskeyError('Passkeys must be used on the InRL page itself.')
}

/** The authenticator data: which site it is for, whether the person was present / verified, a counter. */
export async function checkAuthData(authData: Uint8Array<ArrayBuffer>, rpId: string) {
  if (authData.length < 37) throw new PasskeyError('Passkey answer too short.')
  if (!same(authData.subarray(0, 32), await sha256(rpId))) throw new PasskeyError('This passkey is for another site.')
  const flags = authData[32]
  if (!(flags & 0x01)) throw new PasskeyError('The passkey was used without the person present.')
  const signCount = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0)
  return { userVerified: !!(flags & 0x04), signCount }
}

/** WebAuthn ECDSA signatures are DER; WebCrypto wants the two 32-byte numbers side by side. */
export function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  if (der[0] !== 0x30) throw new PasskeyError('Bad signature.')
  let at = 2
  if (der[1] & 0x80) at = 2 + (der[1] & 0x7f)
  const out = new Uint8Array(64)
  for (let k = 0; k < 2; k++) {
    if (der[at] !== 0x02) throw new PasskeyError('Bad signature.')
    let len = der[at + 1]
    let start = at + 2
    at = start + len
    // Strip the sign padding, then right-align into 32 bytes.
    while (len > 32 && der[start] === 0) {
      start++
      len--
    }
    if (len > 32) throw new PasskeyError('Bad signature.')
    out.set(der.subarray(start, start + len), k * 32 + 32 - len)
  }
  return out
}

function importKey(spki: Uint8Array<ArrayBuffer>, alg: number) {
  if (alg === ES256) return crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  if (alg === RS256) return crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  throw new PasskeyError('This kind of passkey is not supported.')
}

/** Checks that a public key the browser handed over is usable (sign-up). */
export async function checkPublicKey(spki: Uint8Array<ArrayBuffer>, alg: number) {
  try {
    await importKey(spki, alg)
  } catch (e) {
    if (e instanceof PasskeyError) throw e
    throw new PasskeyError('Unreadable passkey.')
  }
}

/** Sign-in: the phone's signature over authenticatorData + SHA-256(clientDataJSON). */
export async function verifySignature(spki: Uint8Array<ArrayBuffer>, alg: number, authData: Uint8Array<ArrayBuffer>, clientDataJSON: Uint8Array<ArrayBuffer>, signature: Uint8Array<ArrayBuffer>) {
  const key = await importKey(spki, alg)
  const hash = await sha256(clientDataJSON)
  const signed = new Uint8Array(authData.length + hash.length)
  signed.set(authData)
  signed.set(hash, authData.length)
  const ok =
    alg === ES256
      ? await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(signature), signed)
      : await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed)
  if (!ok) throw new PasskeyError('The passkey signature did not match.')
}
