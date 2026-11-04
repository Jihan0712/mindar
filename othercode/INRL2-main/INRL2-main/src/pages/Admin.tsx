import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { refreshAccount, useAccount } from '../account/account'
import { BackIcon } from '../components/Icons'
import { adminDone, adminRemove, adminReports, REPORT_REASONS, timeAgo, type AdminReport } from '../social/social'
import './Admin.css'

/*
 * Reports, for InRL's team (step 5, piece 8; reached from the profile's ☰
 * when your account is an admin). Each report shows what it points at, who
 * sent it and why; "Remove" deletes the post or comment (or hides the
 * account from everyone else), "Dismiss" files it.
 */

const KIND: Record<string, string> = { post: 'Post', comment: 'Comment', account: 'Person' }
const reasonLabel = (id: string) => REPORT_REASONS.find((r) => r.id === id)?.label ?? id

export default function Admin() {
  const account = useAccount()
  const navigate = useNavigate()
  const [all, setAll] = useState(false)
  const [list, setList] = useState<AdminReport[] | null>(null)
  const [error, setError] = useState('')
  const [armed, setArmed] = useState<string | null>(null)

  useEffect(() => {
    void refreshAccount().catch(() => {})
  }, [])
  function load() {
    adminReports(all)
      .then((r) => ((setList(r), setError(''))))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }
  useEffect(() => {
    if (account?.admin) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.admin, all])

  async function run(fn: () => Promise<void>) {
    setArmed(null)
    try {
      await fn()
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <main className="ad">
      <header className="ad-top">
        <button className="ad-icon" aria-label="Back" onClick={() => (history.length > 1 ? navigate(-1) : navigate('/me'))}><BackIcon /></button>
        <h1 className="t-heading-18">Reports</h1>
        <span className="ad-icon" />
      </header>
      {!account?.admin ? (
        <p className="t-body-14 ad-muted">Only InRL’s team can see reports.</p>
      ) : (
        <>
          <label className="ad-all t-label-12"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show handled reports too</label>
          {list?.length === 0 && <p className="t-body-14 ad-muted">No reports to handle. 🎉</p>}
          {list?.map((r) => (
            <article key={r.id} className={`ad-card${r.done ? ' is-done' : ''}`} data-kind={r.kind}>
              <p className="t-label-12 ad-meta">
                <b>{KIND[r.kind]}</b> · {reasonLabel(r.reason)} · from @{r.reporter} · {timeAgo(r.created)}
                {r.done && ' · handled'}
              </p>
              {r.note && <p className="t-body-14 ad-note">“{r.note}”</p>}
              {r.what ? (
                <Link to={r.what.link} className="ad-what">
                  {r.what.thumb && <img src={r.what.thumb} alt="" />}
                  <span className="t-body-14">
                    {r.kind === 'post' && (r.what.caption || '(no caption)')}
                    {r.kind === 'comment' && `“${r.what.text}”`}
                    {r.kind === 'account' && `${r.what.name || ''} @${r.what.by}${r.what.hidden ? ' (hidden)' : ''}`}
                    {r.kind !== 'account' && <span className="ad-muted"> by @{r.what.by}</span>}
                  </span>
                </Link>
              ) : (
                <p className="t-body-14 ad-muted">Already gone.</p>
              )}
              {!r.done && (
                <div className="ad-acts">
                  {r.what && (
                    armed === r.id ? (
                      <button className="btn ad-danger" onClick={() => void run(() => adminRemove(r.kind, r.target))}>{r.kind === 'account' ? 'Hide this person for good?' : 'Remove for good?'}</button>
                    ) : (
                      <button className="btn btn-secondary" onClick={() => setArmed(r.id)}>{r.kind === 'account' ? 'Hide this person' : `Remove the ${r.kind}`}</button>
                    )
                  )}
                  <button className="btn btn-secondary" onClick={() => void run(() => adminDone(r.id))}>Dismiss</button>
                </div>
              )}
            </article>
          ))}
        </>
      )}
      {error && <p className="t-label-12 ad-error" role="alert">{error}</p>}
    </main>
  )
}
