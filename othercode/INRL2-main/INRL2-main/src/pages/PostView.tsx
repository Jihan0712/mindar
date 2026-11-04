import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAccount } from '../account/account'
import { Avatar } from '../components/Avatar'
import type { NavTab } from '../components/BottomNav'
import { CommentsSheet } from '../components/CommentsSheet'
import { PostStrip } from '../components/PostStrip'
import { SafetyMenu } from '../components/SafetyMenu'
import { BackIcon, CommentIcon, HeartIcon, MoreIcon, PlusIcon, ShareIcon, SoundOffIcon, SoundOnIcon, UndoIcon, ViewsIcon } from '../components/Icons'
import { ModePill, type ViewMode } from '../components/ModePill'
import type { In3DStage } from '../look/stages'
import type { SceneHandle } from '../scene/buildScene'
import { firstFrames } from '../scene/videoReady'
import { loadPost, postCache, useStripList, type LoadedPost } from '../social/posts'
import { count, countView, follow, like, timeAgo } from '../social/social'
import './LookTest.css'
import './PostView.css'

/*
 * One post, full screen (step 5), at /p/<id>: the link people share. Opens
 * straight in IN3D (decisions 2026-10-07): the post's picture shows at once
 * and the 3D fades in over it, on the same backdrop, no marker. The 3D takes
 * every gesture (one finger turns, pinch zooms, two fingers move); a double
 * tap likes (a heart pops) and "Reset view" appears once the view was moved; the posts around it (from the feed or profile it was opened from)
 * sit in a strip of round thumbnails at the bottom, as in Figma C3 / A2 / A4:
 * a carousel that snaps a thumbnail to the middle (that post shows), or tap
 * one. Switching keeps the old scene until the new one is ready, then
 * cross-fades. IN3D opens on the post's framed camera (scene.view). Author, counts and caption sit above it. No
 * bottom bar: ← goes back. INRL: the scene on a real surface, with the same
 * strip (PostInrl, step 6).
 */

type Loaded = LoadedPost
interface State {
  list?: { id: string; thumb?: string | null; caption?: string }[]
  tab?: NavTab
  /** Open with the comments (from a comment notification). */
  comments?: boolean
}

const cache = postCache
const load = loadPost

export default function PostView() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const account = useAccount()
  const { state } = useLocation() as { state: State | null }
  const list = useStripList(id, state?.list ?? [])
  const at = list.findIndex((p) => p.id === id)

  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState('') // the post id whose 3D is showing
  const [note, setNote] = useState('')
  const [sound, setSound] = useState(false)
  const soundRef = useRef(false)
  const fadeRef = useRef<HTMLCanvasElement>(null)
  // A heart pops where the scene was double-tapped (like); "Reset view" shows once the view was moved.
  const [pops, setPops] = useState<{ id: number; x: number; y: number }[]>([])
  const [moved, setMoved] = useState(false)
  const [comments, setComments] = useState(!!state?.comments)
  const [menu, setMenu] = useState(false)
  // The post picture covers the screen only until the first 3D scene is up.
  const [started, setStarted] = useState(false)
  useEffect(() => {
    if (ready) setStarted(true)
  }, [ready])
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<In3DStage | null>(null)
  const handleRef = useRef<SceneHandle | null>(null)
  const shown = useRef('')

  useEffect(() => {
    let gone = false
    setError('')
    load(id)
      .then((d) => {
        if (gone) return
        setData(d)
        countView(id)
        void show3D(d).catch((e) => !gone && setError(String(e?.message ?? e)))
      })
      .catch((e) => !gone && setError(e instanceof Error ? e.message : String(e)))
    // The neighbours load ahead, so swiping is quick.
    for (const n of [at - 1, at + 1]) if (at >= 0 && list[n]) void load(list[n].id).catch(() => {})
    return () => {
      gone = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(
    () => () => {
      handleRef.current?.dispose()
      stageRef.current?.setContent(null)
      stageRef.current?.dispose()
    },
    [],
  )

  // Safari's own pinch (page zoom, tab overview) would take the gestures.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault()
    document.addEventListener('gesturestart', stop)
    document.addEventListener('gesturechange', stop)
    return () => {
      document.removeEventListener('gesturestart', stop)
      document.removeEventListener('gesturechange', stop)
    }
  }, [])

  /**
   * One 3D stage for the whole visit; each post swaps its scene in. The old
   * scene stays on screen until the new one (videos included) is ready, then
   * a frozen frame of it fades out over the new one: no blank or black flash.
   */
  async function show3D(d: Loaded) {
    const postId = d.post.id
    shown.current = postId
    const [{ In3DStage }, { buildScene }] = await Promise.all([import('../look/stages'), import('../scene/buildScene')])
    if (!stageRef.current) {
      stageRef.current = new In3DStage(hostRef.current!, null)
      stageRef.current.onDoubleTap = (x, y) => doubleTapRef.current(x, y)
      stageRef.current.onUserMove = () => setMoved(true)
    }
    const stage = stageRef.current
    const handle = await buildScene(d.post.scene)
    if (shown.current !== postId) return handle.dispose()
    handle.setMuted(!soundRef.current)
    void handle.play()
    await firstFrames(handle.videos)
    if (shown.current !== postId) return handle.dispose()
    const old = handleRef.current
    const fade = fadeRef.current
    if (old && fade) {
      stage.freezeInto(fade)
      fade.classList.remove('is-fading')
      void fade.offsetWidth // restart the fade
      fade.classList.add('is-fading')
    }
    handleRef.current = handle
    stage.setStartView(d.post.scene.view)
    stage.setContent(handle)
    stage.setBackground(d.post.scene.background.color)
    stage.resetView()
    setMoved(false)
    old?.dispose()
    setReady(postId)
  }

  /** INRL: the scene on a real surface (step 6, PostInrl), with the same strip. */
  function switchMode(m: ViewMode) {
    if (m === 'INRL') navigate(`/p/${id}/inrl`, { state: { ...state, list } })
  }

  /** The heart (and double tap, which only likes, as on Instagram). Signed out: sign in first. */
  async function toggleLike(on: boolean) {
    const d = data
    if (!d || d.post.id !== id) return
    if (!account) return navigate(`/welcome?next=${encodeURIComponent(`/p/${id}`)}`)
    if (!!d.post.liked === on) return
    const apply = (liked: boolean, likes: number) => {
      const next = { ...d, post: { ...d.post, liked, likes } }
      cache.set(id, Promise.resolve(next))
      setData((cur) => (cur?.post.id === id ? next : cur))
    }
    apply(on, Math.max(0, (d.post.likes ?? 0) + (on ? 1 : -1)))
    try {
      const r = await like(id, on)
      apply(r.liked, r.likes)
    } catch (e) {
      apply(!on, d.post.likes ?? 0)
      flash(e instanceof Error ? e.message : String(e))
    }
  }
  const doubleTapRef = useRef<(x: number, y: number) => void>(() => {})
  doubleTapRef.current = (x, y) => {
    const n = Date.now()
    setPops((p) => [...p, { id: n, x, y }])
    setTimeout(() => setPops((p) => p.filter((q) => q.id !== n)), 900)
    void toggleLike(true)
  }

  /** The "+" on the author's picture (Figma G1): follow without leaving the post. */
  async function followAuthor() {
    if (!data?.owner) return
    if (!account) return navigate(`/welcome?next=${encodeURIComponent(`/p/${id}`)}`)
    const username = data.owner.username
    try {
      await follow(username, true)
      // Every loaded post by them now shows them as followed.
      for (const [k, p] of cache) void p.then((d) => d.owner?.username === username && cache.set(k, Promise.resolve({ ...d, owner: { ...d.owner, followed: true } })))
      setData((d) => d && d.owner && { ...d, owner: { ...d.owner, followed: true } })
      flash(`Following ${data.owner.name || '@' + username}`)
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e))
    }
  }

  function flash(text: string) {
    setNote(text)
    setTimeout(() => setNote(''), 2500)
  }

  function toggleSound() {
    const h = handleRef.current
    if (!h) return
    h.setMuted(sound)
    void h.play()
    soundRef.current = !sound
    setSound(!sound)
  }

  async function share() {
    const url = `${location.origin}/p/${id}`
    const title = data?.owner ? `${data.owner.name || '@' + data.owner.username} on InRL` : 'InRL'
    try {
      if (navigator.share) return await navigator.share({ url, title })
      await navigator.clipboard.writeText(url)
      flash('Link copied')
    } catch {
      // cancelled
    }
  }

  function go(n: number) {
    const next = list[n]
    if (next && next.id !== id) navigate(`/p/${next.id}`, { replace: true, state: { ...state, list } })
  }

  const back = () => (history.length > 1 ? navigate(-1) : navigate('/'))
  const post = data?.post.id === id ? data.post : null
  const owner = data?.owner
  const name = owner ? owner.name || `@${owner.username}` : ''
  const is3D = ready === id
  const hasVideo = is3D && !!handleRef.current?.videos.length

  return (
    <div
      className="look pv"
      data-post={post ? id : ''}
      data-ready={is3D}
      data-strip={list.length > 1 && at >= 0}
      style={{ background: post?.scene.background.color }}
    >
      <div ref={hostRef} className="look-stage" />
      <canvas ref={fadeRef} className="pv-fade" aria-hidden="true" />

      {/* The picture straight away; the 3D fades in over it once built. */}
      {!post && !started && list[at]?.thumb && (
        <div className="pv-art"><img src={list[at].thumb!} alt="" /></div>
      )}
      {post?.thumb && !started && (
        <div key={post.id} className={`pv-art${is3D ? ' is-hidden' : ''}`} style={{ background: post.scene.background.color }}>
          <img src={post.thumb} alt="" />
        </div>
      )}

      <header className="look-top pv-top">
        <button className="look-icon" aria-label="Back" onClick={back}><BackIcon color="#fff" /></button>
        <ModePill active="IN3D" onChange={switchMode} />
        {owner && !owner.me ? (
          <button className="look-icon" aria-label="More options" onClick={() => setMenu(true)}><MoreIcon color="#fff" /></button>
        ) : (
          <span className="look-icon" />
        )}
      </header>

      {post && (
        <>
          <section className="pv-info">
            <div className="pv-who">
              <span className="pv-avatar">
                <Link to={`/u/${owner?.username ?? ''}`} aria-label={`${name}’s profile`}><Avatar name={name} src={owner?.avatar} size={43} /></Link>
                {owner && !owner.me && !owner.followed && (
                  <button className="pv-follow" aria-label={`Follow ${name}`} onClick={() => void followAuthor()}><PlusIcon size={12} color="#fff" /></button>
                )}
              </span>
              <div>
                <Link to={`/u/${owner?.username ?? ''}`} className="pv-name t-heading-16">{name}</Link>
                <p className="t-label-12 pv-counts">
                  <span><HeartIcon active color="#fff" /> {count(post.likes ?? 0)}</span>
                  <span><ViewsIcon color="#fff" /> {count(post.views ?? 0)}</span>
                  <span>{timeAgo(post.created)}</span>
                </p>
              </div>
            </div>
            {post.caption && <p className="t-body-14 pv-caption">{post.caption}</p>}
          </section>
          <aside className="pv-actions">
            {hasVideo && <button aria-label={sound ? 'Sound off' : 'Sound on'} onClick={toggleSound}>{sound ? <SoundOnIcon color="#fff" /> : <SoundOffIcon color="#fff" />}</button>}
            <button aria-label="Share" onClick={() => void share()}><ShareIcon color="#fff" /></button>
            <button className="pv-count" aria-label="Comments" onClick={() => setComments(true)}>
              <CommentIcon size={28} color="#fff" />
              <span className="t-label-12">{count(post.comments ?? 0)}</span>
            </button>
            <button className={`pv-like${post.liked ? ' is-on' : ''}`} aria-label={post.liked ? 'Unlike' : 'Like'} aria-pressed={!!post.liked} onClick={() => void toggleLike(!post.liked)}>
              <HeartIcon size={28} active={!!post.liked} color={post.liked ? 'var(--signal-like)' : '#fff'} />
              <span className="t-label-12">{count(post.likes ?? 0)}</span>
            </button>
          </aside>
        </>
      )}
      {list.length > 1 && at >= 0 && <PostStrip list={list} at={at} smooth={!!ready} onPick={go} />}

      {moved && is3D && (
        <button className="pv-reset" onClick={() => (stageRef.current?.resetView(), setMoved(false))}><UndoIcon size={16} color="#fff" /> Reset view</button>
      )}
      {pops.map((p) => (
        <span key={p.id} className="pv-pop" style={{ left: p.x, top: p.y }} aria-hidden="true"><HeartIcon size={96} active color="var(--signal-like)" /></span>
      ))}
      {comments && post && (
        <CommentsSheet
          post={post.id}
          onClose={() => setComments(false)}
          onCount={(n) => {
            const d = data
            if (!d || d.post.id !== post.id) return
            const next = { ...d, post: { ...d.post, comments: n } }
            cache.set(post.id, Promise.resolve(next))
            setData(next)
          }}
        />
      )}
      {menu && owner && (
        <SafetyMenu
          kind="post"
          target={id}
          username={owner.username}
          onClose={() => setMenu(false)}
          onBlocked={() => {
            setMenu(false)
            for (const [k, p] of cache) void p.then((d) => d.owner?.username === owner.username && cache.delete(k))
            navigate('/', { replace: true })
          }}
        />
      )}
      {note && <p className="pv-note t-body-14-medium" role="status">{note}</p>}
      {!data && !error && !list[at]?.thumb && <p className="look-hint">Loading…</p>}
      {error && (
        <div className="look-sheet">
          <h1 className="t-heading-22">Can’t show this post</h1>
          <p className="t-body-14">{error}</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>Home</button>
        </div>
      )}
    </div>
  )
}
