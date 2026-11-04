import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Cancelled, challengeFresh, checkUsername, passkeysSupported, prepareChallenge, signIn, signUp, useAccount, type Account, type Challenge } from '../account/account'
import { BackIcon } from '../components/Icons'
import { Logo } from '../components/Logo'
import './Welcome.css'

/*
 * Sign up / sign in (step 3), after Figma's onboarding row: F1 (splash with
 * the sign-in choice on a white sheet), F25 (Set up Your Profile: full name,
 * user name, Next), F26 (Hello, NAME @username).
 *
 * Sign-in is a passkey (Face ID): "Create my account" asks for a name and a
 * user name, then Face ID makes the passkey; "I already have an account"
 * asks Face ID for the saved one. Figma's Google / Apple / email + code +
 * password screens are replaced (decision to confirm with Nico).
 *
 * ?next=<path> is where to go afterwards (e.g. back to New Post).
 */

type Step = 'start' | 'profile' | 'hello'

const ART = ['chrome-heart', 'clay-star', 'cloud-buddy', 'glass-crystal', 'heart-buddy', 'chrome-ring', 'text-candy', 'blank-toy']

export default function Welcome() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/me'
  const signedIn = useAccount()
  const [step, setStep] = useState<Step>('start')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [check, setCheck] = useState<{ for: string; available: boolean; reason?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [account, setAccount] = useState<Account | null>(null)
  const supported = passkeysSupported()
  // A fresh one-time challenge is always ready before the tap (Safari needs the passkey call to come straight from it).
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!supported || signedIn) return
    let gone = false
    const load = () =>
      prepareChallenge()
        .then((ch) => !gone && setChallenge(ch))
        .catch(() => !gone && setError('No connection. Check the internet and try again.'))
    void load()
    const t = setInterval(load, 3.5 * 60_000)
    return () => {
      gone = true
      clearInterval(t)
    }
  }, [supported, signedIn, round])

  // Live check of the user name, a moment after typing stops.
  useEffect(() => {
    const u = username.trim().toLowerCase()
    if (u.length < 3) return
    const t = setTimeout(() => {
      checkUsername(u)
        .then((r) => setCheck({ for: u, ...r }))
        .catch(() => {})
    }, 350)
    return () => clearTimeout(t)
  }, [username])

  const u = username.trim().toLowerCase()
  const usernameNote = u.length > 0 && u.length < 3 ? 'At least 3 characters.' : check?.for === u ? (check.available ? '' : check.reason) : ''
  const ready = challengeFresh(challenge)
  const canCreate = name.trim().length > 0 && u.length >= 3 && check?.for === u && check.available && !busy && ready

  /** Runs from the tap: the passkey call is the first thing that happens. */
  async function run(fn: (ch: Challenge) => Promise<Account>) {
    if (!challengeFresh(challenge)) return setRound((r) => r + 1)
    const ch = challenge
    setChallenge(null) // each challenge works once
    setBusy(true)
    setError('')
    try {
      setAccount(await fn(ch))
      setStep('hello')
    } catch (e) {
      if (!(e instanceof Cancelled)) setError(e instanceof Error ? e.message : String(e))
      setRound((r) => r + 1)
    } finally {
      setBusy(false)
    }
  }

  const shown = account ?? signedIn

  if (step === 'hello' && shown) {
    return (
      <main className="wl wl-page" data-step="hello">
        <Top onBack={() => navigate(next)} />
        <div className="wl-hello">
          <span className="wl-avatar wl-avatar-big" aria-hidden="true">{(shown.name || shown.username).slice(0, 1).toUpperCase()}</span>
          <p className="t-heading-22">Hello,</p>
          <h1 className="wl-display">{shown.name || shown.username}</h1>
          <p className="t-body-14 wl-handle">@{shown.username}</p>
          <button className="btn btn-primary" onClick={() => navigate(next, { replace: true })}>Continue</button>
        </div>
      </main>
    )
  }

  if (step === 'profile') {
    return (
      <main className="wl wl-page" data-step="profile">
        <Top onBack={() => setStep('start')} />
        <form
          className="wl-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (canCreate) void run((ch) => signUp(u, name.trim(), ch))
          }}
        >
          <h1 className="t-heading-22 wl-title">Set up Your Profile</h1>
          <span className="wl-avatar" aria-hidden="true">{(name.trim() || u || '?').slice(0, 1).toUpperCase()}</span>
          <input className="wl-input" name="name" placeholder="Full Name" autoComplete="name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className="wl-input"
            name="username"
            placeholder="User Name"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={20}
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ''))}
          />
          {usernameNote && <p className="t-label-12 wl-note">{usernameNote}</p>}
          <button className="btn btn-primary" type="submit" disabled={!canCreate}>{busy ? 'Waiting for Face ID…' : 'Next'}</button>
          <p className="t-label-12 wl-small">Next, your iPhone saves an InRL passkey with Face ID. No password to remember; it syncs to your other Apple devices through iCloud Keychain.</p>
          {error && <p className="t-label-12 wl-error" role="alert">{error}</p>}
        </form>
      </main>
    )
  }

  return (
    <main className="wl wl-splash" data-step="start">
      <div className="wl-hero" aria-hidden="true">
        {ART.map((a, i) => <img key={a} className={`wl-art wl-art-${i}`} src={`/studio/thumbs/${a}.png`} alt="" />)}
        <p className="wl-logo"><Logo height={70} color="#fff" /></p>
      </div>
      <button className="wl-back" aria-label="Back" onClick={() => (history.length > 1 ? navigate(-1) : navigate('/'))}><BackIcon color="#fff" /></button>
      <section className="wl-sheet">
        {signedIn ? (
          <>
            <p className="t-body-14 wl-center">Signed in as <strong>@{signedIn.username}</strong>.</p>
            <button className="btn btn-primary" onClick={() => navigate(next, { replace: true })}>Continue</button>
          </>
        ) : supported ? (
          <>
            <button className="btn btn-primary" onClick={() => setStep('profile')} disabled={busy}>Create my account</button>
            <button className="btn btn-secondary" onClick={() => void run(signIn)} disabled={busy || !ready}>{busy ? 'Waiting for Face ID…' : 'I already have an account'}</button>
            <p className="t-label-12 wl-small">Signing in uses a passkey with Face ID: no password, no email.</p>
          </>
        ) : (
          <p className="t-body-14 wl-center">This browser can’t use passkeys. On iPhone, open InRL in Safari (iOS 16 or later).</p>
        )}
        {error && <p className="t-label-12 wl-error" role="alert">{error}</p>}
      </section>
    </main>
  )
}

function Top({ onBack }: { onBack: () => void }) {
  return (
    <header className="wl-top">
      <button className="wl-icon" aria-label="Back" onClick={onBack}><BackIcon /></button>
      <p className="wl-logo wl-logo-small"><Logo height={27} /></p>
      <span className="wl-icon" />
    </header>
  )
}
