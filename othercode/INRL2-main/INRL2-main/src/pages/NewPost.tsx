import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAccount } from '../account/account'
import { myPosts, postPictureKey, publishScene } from '../account/publish'
import { getThumb, loadScene } from '../studio/scenes'
import { Avatar } from '../components/Avatar'
import { BackIcon } from '../components/Icons'
import { Published } from './Published'
import './NewPost.css'

/*
 * New Post (Figma E18r3, redone 2026-10-07): the framed picture, a caption
 * (150 characters), a "Show on my marker" switch (on for a first post, then
 * off: printed markers only change when asked) and Post → Published
 * Successfully (E19r3, ~2.5 s) → the new post, full screen in IN3D.
 * Not signed in: Post leads to sign-in first and comes back here. The song
 * row waits for music (later).
 */

const CAPTION_MAX = 150

export default function NewPost() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const account = useAccount()
  const [scene] = useState(() => loadScene(id))
  const [picture] = useState(() => {
    try {
      return sessionStorage.getItem(postPictureKey(id)) ?? getThumb(id)
    } catch {
      return getThumb(id)
    }
  })
  const [caption, setCaption] = useState('')
  const [attach, setAttach] = useState(false)
  const touched = useRef(false)
  const [posted, setPosted] = useState<string | null>(null)
  // Your posts, newest first: the strip under the new post when you land on it.
  const [mine, setMine] = useState<{ id: string; thumb: string | null; caption: string }[]>([])
  // A first post goes on the marker (it has nothing to show yet); later ones only when asked.
  useEffect(() => {
    if (!account) return
    myPosts().then((list) => !touched.current && setAttach(list.length === 0)).catch(() => {})
  }, [account])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const back = `/studio/edit/${id}${location.search}`

  async function publish() {
    if (!account) return navigate(`/welcome?next=${encodeURIComponent(`/studio/post/${id}`)}`)
    setBusy(true)
    setError('')
    try {
      const post = await publishScene(id, caption, attach, picture)
      setPosted(post.id)
      setDone(true)
      myPosts().then(setMine).catch(() => {})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const empty = !scene || scene.objects.length === 0

  return (
    <main className="np">
      <header className="np-top">
        <Link to={back} className="np-icon" aria-label="Back to InStudio"><BackIcon /></Link>
        <h1 className="t-heading-18">New Post</h1>
        <span className="np-icon" />
      </header>

      <div className="np-who">
        <Avatar name={account?.name || account?.username || '?'} src={account?.avatar} size={32} />
        <span className="t-body-14-bold">{account ? account.name || `@${account.username}` : 'Not signed in yet'}</span>
      </div>

      <div className="np-picture" style={{ background: scene?.background.color }}>
        {picture ? <img src={picture} alt="Your scene" /> : <span className="t-body-14">No picture yet</span>}
      </div>

      <label className="np-caption">
        <span className="sr-only">Caption</span>
        <textarea
          placeholder="Say something about your post..."
          maxLength={CAPTION_MAX}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={3}
        />
        <span className="np-count t-caption-10">{caption.length}/{CAPTION_MAX}</span>
      </label>

      <div className="np-actions">
        <label className="np-switch">
          <span>
            <strong className="t-body-14-bold">Show on my marker</strong>
            <span className="t-label-12">Your marker (and anything you printed it on) will show this post.</span>
          </span>
          <input type="checkbox" role="switch" checked={attach} onChange={(e) => ((touched.current = true), setAttach(e.target.checked))} />
        </label>
        <button className="btn btn-primary" disabled={busy || empty} onClick={() => void publish()}>
          {busy ? 'Posting…' : account ? 'Post' : 'Sign in to post'}
        </button>
        {empty && <p className="t-label-12 np-note">Add something to your scene first.</p>}
        {error && <p className="t-label-12 np-error" role="alert">{error}</p>}
        <Link className="t-label-12 np-preview" to={`/studio/preview/${id}${location.search}`}>Try it on the test marker first</Link>
      </div>

      {done && posted && (
        <Published after={2500} onDone={() => navigate(`/p/${posted}`, { replace: true, state: { list: mine.some((p) => p.id === posted) ? mine : [{ id: posted }, ...mine], tab: 'profile' } })} />
      )}
    </main>
  )
}
