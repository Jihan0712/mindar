import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccount } from '../account/account'
import { addComment, deleteComment, hideComment, likeComment, loadComments, timeAgo, type Comment } from '../social/social'
import { Avatar } from './Avatar'
import { ReportSheet } from './ReportSheet'
import { ArrowRightIcon, CloseIcon, HeartIcon } from './Icons'
import './CommentsSheet.css'

/*
 * Comments (step 5, Figma C12): a sheet over the post. Add a comment, like
 * one, Reply (starts yours with @name), delete your own; the post's author
 * can hide or delete any; others' comments can be reported. Hidden ones only show (dimmed) to their writer and
 * the post's author. The sheet rises above the iPhone keyboard.
 */

const MAX = 300

export function CommentsSheet({ post, onClose, onCount }: { post: string; onClose: () => void; onCount: (n: number) => void }) {
  const account = useAccount()
  const navigate = useNavigate()
  const [list, setList] = useState<Comment[] | null>(null)
  const [moderator, setModerator] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lift, setLift] = useState(0)
  const [reporting, setReporting] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadComments(post)
      .then((r) => ((setList(r.comments), setModerator(r.moderator))))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [post])

  // Keep the sheet above the keyboard (iOS shrinks the visual viewport, not the page).
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const fit = () => setLift(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    return () => (vv.removeEventListener('resize', fit), vv.removeEventListener('scroll', fit))
  }, [])

  const update = (id: string, change: Partial<Comment>) => setList((l) => l?.map((c) => (c.id === id ? { ...c, ...change } : c)) ?? null)

  async function send() {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    setError('')
    try {
      const r = await addComment(post, t)
      setList((l) => [...(l ?? []), r.comment])
      onCount(r.count)
      setText('')
      requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function act(c: Comment, what: 'like' | 'hide' | 'delete') {
    try {
      if (what === 'like') {
        const on = !c.liked
        update(c.id, { liked: on, likes: c.likes + (on ? 1 : -1) })
        const r = await likeComment(c.id, on)
        update(c.id, { liked: r.liked, likes: r.likes })
      } else if (what === 'hide') {
        const r = await hideComment(c.id, !c.hidden)
        update(c.id, { hidden: r.hidden })
        onCount(r.count)
      } else {
        const r = await deleteComment(c.id)
        setList((l) => l?.filter((x) => x.id !== c.id) ?? null)
        onCount(r.count)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function reply(c: Comment) {
    setText((t) => (t.startsWith(`@${c.author.username} `) ? t : `@${c.author.username} ${t}`))
    input.current?.focus()
  }

  return (
    <div className="cm-veil" onClick={onClose}>
      <section className="cm" role="dialog" aria-label="Comments" style={{ bottom: lift }} onClick={(e) => e.stopPropagation()}>
        <span className="cm-grab" aria-hidden="true" />
        <header className="cm-top">
          <h2 className="t-heading-22">Comments</h2>
          <button className="cm-x" aria-label="Close" onClick={onClose}><CloseIcon size={16} /></button>
        </header>
        <div ref={scroller} className="cm-list">
          {list === null && !error && <p className="t-body-14 cm-muted">Loading…</p>}
          {list?.length === 0 && <p className="t-body-14 cm-muted">No comments yet. Be the first!</p>}
          {list?.map((c) => (
            <article key={c.id} className={`cm-row${c.hidden ? ' is-hidden' : ''}`} data-id={c.id}>
              <Link to={`/u/${c.author.username}`} className="cm-who"><Avatar name={c.author.name || c.author.username} src={c.author.avatar} size={36} /></Link>
              <div className="cm-body">
                <p className="t-body-14-medium">
                  <Link to={`/u/${c.author.username}`}>{c.author.username}</Link> <span className="cm-time">· {timeAgo(c.created)}</span>
                  {c.hidden && <span className="cm-flag t-caption-10">Hidden</span>}
                </p>
                <p className="t-body-14 cm-text">{c.text}</p>
                <p className="cm-acts t-label-12-medium">
                  {account && <button onClick={() => reply(c)}>Reply</button>}
                  {moderator && !c.mine && <button onClick={() => void act(c, 'hide')}>{c.hidden ? 'Unhide' : 'Hide'}</button>}
                  {(c.mine || moderator) && <button onClick={() => void act(c, 'delete')}>Delete</button>}
                  {account && !c.mine && <button onClick={() => setReporting(c.id)}>Report</button>}
                </p>
              </div>
              <button className={`cm-like${c.liked ? ' is-on' : ''}`} aria-label={c.liked ? 'Unlike comment' : 'Like comment'} aria-pressed={c.liked} disabled={!account} onClick={() => void act(c, 'like')}>
                <HeartIcon size={18} active={c.liked} color={c.liked ? 'var(--teal-500)' : 'var(--ink-400)'} />
                {c.likes > 0 && <span className="t-caption-10">{c.likes}</span>}
              </button>
            </article>
          ))}
        </div>
        {error && <p className="t-label-12 cm-error" role="alert">{error}</p>}
        <footer className="cm-add">
          {account ? (
            <>
              <Avatar name={account.name || account.username} src={account.avatar} size={36} />
              <label className="cm-input">
                <textarea
                  ref={input}
                  rows={1}
                  maxLength={MAX}
                  placeholder="Add a comment."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), void send())}
                />
                {text.trim() && (
                  <button className="cm-send" aria-label="Send" disabled={busy} onClick={() => void send()}><ArrowRightIcon size={18} color="#fff" /></button>
                )}
              </label>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => navigate(`/welcome?next=${encodeURIComponent(location.pathname)}`)}>Sign in to comment</button>
          )}
        </footer>
      </section>
      {reporting && <ReportSheet kind="comment" target={reporting} onClose={() => setReporting(null)} />}
    </div>
  )
}
