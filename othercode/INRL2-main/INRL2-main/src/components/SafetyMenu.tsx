import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount } from '../account/account'
import { block, type ReportKind } from '../social/social'
import { CloseIcon } from './Icons'
import { ReportSheet } from './ReportSheet'
import './ReportSheet.css'

/*
 * The "•••" menu on someone else's post or profile (step 5, piece 8):
 * Report, or Block (with a word on what it does). Blocking hides the two of
 * you from each other everywhere; it can be undone from your profile's ☰.
 */
export function SafetyMenu({ kind, target, username, onClose, onBlocked }: { kind: Extract<ReportKind, 'post' | 'account'>; target: string; username: string; onClose: () => void; onBlocked: () => void }) {
  const account = useAccount()
  const navigate = useNavigate()
  const [step, setStep] = useState<'menu' | 'report' | 'block'>('menu')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (step === 'report') return <ReportSheet kind={kind} target={target} onClose={onClose} />

  async function doBlock() {
    setBusy(true)
    try {
      await block(username, true)
      onBlocked()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const signIn = () => navigate(`/welcome?next=${encodeURIComponent(location.pathname)}`)
  return (
    <div className="rp-veil" onClick={(e) => ((e.stopPropagation()), onClose())}>
      <div className="rp" role="dialog" aria-label="Options" onClick={(e) => e.stopPropagation()}>
        <button className="rp-close" aria-label="Close" onClick={onClose}><CloseIcon size={14} /></button>
        {step === 'menu' ? (
          <>
            <h2 className="t-heading-18">@{username}</h2>
            <button className="btn btn-secondary" onClick={() => (account ? setStep('report') : signIn())}>{kind === 'post' ? 'Report this post' : `Report @${username}`}</button>
            <button className="btn btn-secondary" onClick={() => (account ? setStep('block') : signIn())}>Block @{username}</button>
          </>
        ) : (
          <>
            <h2 className="t-heading-18">Block @{username}?</h2>
            <p className="t-body-14">You won’t see each other’s posts, comments or likes, and you’ll both stop following each other. They aren’t told. You can unblock them from your profile’s ☰ menu.</p>
            {error && <p className="t-label-12 rp-error" role="alert">{error}</p>}
            <button className="btn rp-danger" disabled={busy} onClick={() => void doBlock()}>{busy ? 'Blocking…' : 'Block'}</button>
            <button className="btn btn-secondary" onClick={() => setStep('menu')}>Cancel</button>
          </>
        )}
      </div>
    </div>
  )
}
