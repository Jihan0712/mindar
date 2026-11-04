import { useState } from 'react'
import { useAccount } from '../account/account'
import { report, REPORT_REASONS, type ReportKind } from '../social/social'
import { CloseIcon } from './Icons'
import './ReportSheet.css'

/*
 * Report (step 5, piece 8): why (one tap), an optional word, Send → thanks.
 * Reports go to InRL's team (/admin). Signed out: sign in first.
 */

const TITLES: Record<ReportKind, string> = { post: 'Report this post', comment: 'Report this comment', account: 'Report this person' }

export function ReportSheet({ kind, target, onClose }: { kind: ReportKind; target: string; onClose: () => void }) {
  const account = useAccount()
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function send() {
    if (!reason) return
    setBusy(true)
    setError('')
    try {
      await report(kind, target, reason, note)
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rp-veil" onClick={(e) => ((e.stopPropagation()), onClose())}>
      <div className="rp" role="dialog" aria-label={TITLES[kind]} onClick={(e) => e.stopPropagation()}>
        <button className="rp-close" aria-label="Close" onClick={onClose}><CloseIcon size={14} /></button>
        <h2 className="t-heading-18">{sent ? 'Thanks for telling us' : TITLES[kind]}</h2>
        {!account ? (
          <p className="t-body-14">Sign in to report something.</p>
        ) : sent ? (
          <>
            <p className="t-body-14">InRL’s team will look at it. The person won’t know who reported it.</p>
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <p className="t-label-12 rp-muted">Why are you reporting it?</p>
            <div className="rp-reasons" role="radiogroup">
              {REPORT_REASONS.map((r) => (
                <button key={r.id} role="radio" aria-checked={reason === r.id} className={reason === r.id ? 'is-on' : ''} onClick={() => setReason(r.id)}>{r.label}</button>
              ))}
            </div>
            {reason && <textarea className="rp-note" rows={2} maxLength={500} placeholder="Anything to add? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />}
            {error && <p className="t-label-12 rp-error" role="alert">{error}</p>}
            <button className="btn btn-primary" disabled={!reason || busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Send report'}</button>
          </>
        )}
      </div>
    </div>
  )
}
