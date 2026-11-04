import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { BackIcon, MenuIcon, SoundOffIcon, SoundOnIcon } from '../components/Icons'
import { ModePill, type ViewMode } from '../components/ModePill'
import { PostStrip, type StripPost } from '../components/PostStrip'
import { inNativeApp, listen, openInAppLink, post } from '../floor/bridge'
import { FloorStage, type FloorStats } from '../floor/FloorStage'
import { useSurfaceGestures } from '../floor/gestures'
import { buildScene, type SceneHandle } from '../scene/buildScene'
import { firstFrames } from '../scene/videoReady'
import { loadPost, useStripList, type LoadedPost } from '../social/posts'
import { countView } from '../social/social'
import { markerPage } from '../account/publish'
import { markerCode } from '../marker/qr'
import { phoneKey } from '../studio/cloud'
import './LookTest.css'
import './PostView.css'
import './PostInrl.css'

/*
 * INRL of a post without a marker (step 6, Figma A4 / A41), at
 * /p/<id>/inrl. Inside the iPhone test app (ios/FloorTest, ARKit under this
 * transparent page): move the phone to find a table or the floor, the white
 * aim mark sits on it, tap to drop the scene. One finger slides it, pinch
 * resizes, twist turns. The strip at the bottom holds the same posts as the
 * post viewer it came from (feed, profile, Discover): swiping drops the
 * next scene in the same spot, at the same size. ← and IN3D go back to the
 * post viewer on the post showing.
 *
 * Elsewhere (Safari, desktop, Android until step 6's Android piece): a sheet
 * offers the test app on iPhone, or the author's marker.
 *
 * The strip's posts come from the viewer (router state) or, when opened
 * from Safari in the app, from `?list=id,id,…`.
 */

interface State {
  list?: StripPost[]
}

/** Where the aim mark looks for a surface, as a share of the screen height from the top. */
const AIM_Y = 0.6

const picture = (id: string) => `/api/posts/${id}/picture`

export default function PostInrl() {
  const { id = '' } = useParams()
  const { state, search } = useLocation() as { state: State | null; search: string }
  const fromUrl = new URLSearchParams(search).get('list')
  let given: StripPost[] = state?.list ?? (fromUrl ? fromUrl.split(',').filter(Boolean).map((p) => ({ id: p, thumb: picture(p) })) : [])
  if (!given.some((p) => p.id === id)) given = [{ id, thumb: picture(id) }]
  const list = useStripList(id, given)
  const at = list.findIndex((p) => p.id === id)
  return inNativeApp() ? <OnSurface id={id} list={list} at={at} /> : <Elsewhere id={id} list={list} at={at} />
}

/** finding / aiming / placed: on a surface; reading: a marker's QR was read, waiting to see its artwork; marker: the scene is on it. */
type Phase = 'finding' | 'aiming' | 'placed' | 'reading' | 'marker'

/** What a marker's QR leads to: the artwork to follow and its owner's posts. */
async function markerInfo(code: string): Promise<{ image: string; ready: boolean; post: string | null; name: string; list: StripPost[] }> {
  if (code === 'test') return { image: '/test/marker.png', ready: true, post: 'test', name: 'InRL', list: [{ id: 'test', thumb: null, caption: 'The InRL test scene' }] }
  const page = await markerPage(code)
  const list: StripPost[] = page.posts.map((p) => ({ id: p.id, thumb: p.thumb, caption: p.caption }))
  const post = page.post?.id ?? null
  if (post && !list.some((p) => p.id === post)) list.unshift({ id: post, thumb: page.post!.thumb, caption: page.post!.caption })
  return { image: page.marker.image, ready: page.marker.ready, post, name: page.owner ? page.owner.name || `@${page.owner.username}` : '', list }
}

function OnSurface({ id, list, at }: { id: string; list: StripPost[]; at: number }) {
  const navigate = useNavigate()
  const { state, search } = useLocation()
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<FloorStage | null>(null)
  const handles = useRef(new Map<string, Promise<SceneHandle | null>>())
  /** The scene on screen and its post. */
  const shown = useRef<{ id: string; handle: SceneHandle | null } | null>(null)
  const [phase, setPhase] = useState<Phase>('finding')
  const [data, setData] = useState<LoadedPost | null>(null)
  const [showing, setShowing] = useState('') // the post whose scene is on the surface
  const [stats, setStats] = useState<FloorStats | null>(null)
  const [sound, setSound] = useState(false)
  const soundRef = useRef(false)
  const [menu, setMenu] = useState(false)
  const [note, setNote] = useState('')
  const fromSafari = new URLSearchParams(search).get('from') === 'safari'
  // No surface after a while: a more helpful hint.
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (phase !== 'finding') return setSlow(false)
    const t = setTimeout(() => setSlow(true), 6000)
    return () => clearTimeout(t)
  }, [phase])

  // The page is drawn over the camera: no background anywhere.
  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')]
    const before = els.map((e) => e?.style.background ?? '')
    els.forEach((e) => e && (e.style.background = 'transparent'))
    return () => els.forEach((e, i) => e && (e.style.background = before[i]))
  }, [])

  useEffect(() => {
    const stage = new FloorStage(hostRef.current!)
    stageRef.current = stage
    ;(window as { __floorStage?: FloorStage }).__floorStage = stage // for automated tests
    const map = handles.current
    const stop = listen(
      (f) => {
        stage.onFrame(f)
        setPhase((p) => (p === 'placed' || p === 'reading' || p === 'marker' ? p : f.hit ? 'aiming' : 'finding'))
      },
      (m) => setNote(m),
      (text) => qrRef.current(text),
    )
    stage.onMarkerFound = () => setPhase('marker')
    // Aim lower than the middle (as in A4): a table sits below the eye line,
    // the middle of the screen often looks at the wall behind it.
    post({ type: 'aim', y: AIM_Y })
    const t = setInterval(() => setStats({ ...stage.stats() }), 500)
    return () => {
      stop()
      clearInterval(t)
      stage.dispose()
      for (const p of map.values()) void p.then((h) => h?.dispose())
      map.clear()
    }
  }, [])

  function handleFor(postId: string) {
    let p = handles.current.get(postId)
    if (!p) {
      p = loadPost(postId)
        .then((d) => buildScene(d.post.scene))
        .catch((e) => {
          console.error(e)
          handles.current.delete(postId)
          return null
        })
      handles.current.set(postId, p)
    }
    return p
  }

  // Show this post's scene in the same spot; keep its neighbours ready so swiping is quick; free the rest.
  useEffect(() => {
    let live = true
    const map = handles.current
    const keep = new Set([at - 1, at, at + 1].map((i) => list[i]?.id).filter(Boolean))
    for (const [k, p] of map) {
      if (!keep.has(k) && k !== shown.current?.id) {
        map.delete(k)
        void p.then((h) => h?.dispose())
      }
    }
    loadPost(id)
      .then((d) => live && setData(d))
      .catch((e) => live && setNote(e instanceof Error ? e.message : String(e)))
    countView(id)
    void handleFor(id).then(async (h) => {
      if (!live) return
      if (h) {
        for (const v of h.videos) v.currentTime = 0
        h.setMuted(!soundRef.current)
        void h.play()
        await firstFrames(h.videos)
      }
      const stage = stageRef.current
      if (!live || !stage) return
      const old = shown.current
      stage.setContent(h, true)
      shown.current = { id, handle: h }
      setShowing(id)
      // The previous scene stops; it is freed unless it is a neighbour.
      if (old && old.id !== id) {
        old.handle?.pause()
        if (!keep.has(old.id)) {
          map.delete(old.id)
          old.handle?.dispose()
        }
      }
      for (const k of keep) if (k) void handleFor(k)
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const gestures = useSurfaceGestures(stageRef, () => {
    setPhase('placed')
    // Sound only starts from a tap (iOS); placing is that tap.
    void shown.current?.handle?.play()
  })

  function go(i: number) {
    const next = list[i]
    if (!next || next.id === id) return
    navigate(`/p/${next.id}/inrl${search}`, { replace: true, state: { ...state, list } })
    post({ type: 'haptic' })
  }

  /**
   * Back to IN3D. Opened from Safari ("Open in the InRL test app"), that is
   * Safari's post viewer: the app sends you back there, so it feels like one
   * product; the app itself rests on the post.
   */
  function switchMode(m: ViewMode) {
    if (m !== 'IN3D') return
    if (fromSafari) post({ type: 'openSafari', url: `${location.origin}/p/${id}` })
    navigate(`/p/${id}`, { replace: true, state: { ...state, list } })
  }

  /** ←: opened by Scan (the feed), back there; otherwise to the post in IN3D. */
  function back() {
    if ((state as { scan?: boolean } | null)?.scan) navigate(-1)
    else switchMode('IN3D')
  }

  function toggleSound() {
    const h = shown.current?.handle
    if (!h) return
    h.setMuted(sound)
    void h.play()
    soundRef.current = !sound
    setSound(!sound)
  }

  function placeAgain() {
    stageRef.current?.unplace()
    setPhase('finding')
    setMenu(false)
  }

  // ------------------------------------------------------------ markers
  // The app reads QR codes in the camera picture. An InRL marker's: follow
  // its artwork, and its post appears on it (one scene at a time); the strip
  // becomes the marker owner's posts. "Place on a surface instead" leaves it
  // and ignores that marker until it has been out of sight for 3 s.
  const reading = useRef('')
  const ignored = useRef<{ code: string; seen: number } | null>(null)
  const qrRef = useRef<(text: string) => void>(() => {})
  qrRef.current = (text) => {
    const code = markerCode(text)
    const stage = stageRef.current
    if (!code || !stage) return
    const now = performance.now()
    const ig = ignored.current
    if (ig?.code === code) {
      if (now - ig.seen < 3000) return void (ig.seen = now)
      ignored.current = null
    }
    if (code === stage.marker?.id || code === reading.current) return
    reading.current = code
    const before = phase
    setPhase('reading')
    markerInfo(code)
      .then((m) => {
        if (reading.current !== code) return
        reading.current = ''
        if (!m.ready || !m.post) {
          setPhase(before === 'reading' || before === 'marker' ? 'finding' : before)
          ignored.current = { code, seen: performance.now() }
          return flash(`${m.name || 'This marker'} has nothing to show yet`)
        }
        stage.followMarker(code)
        post({ type: 'trackImage', id: code, url: new URL(m.image, location.origin).href, width: 0.2 })
        navigate(`/p/${m.post}/inrl${search}`, { replace: true, state: { ...(state as object), list: m.list, marker: code } })
      })
      .catch((e) => {
        reading.current = ''
        setPhase('finding')
        ignored.current = { code, seen: performance.now() }
        flash(e instanceof Error ? e.message : String(e))
      })
  }

  function leaveMarker() {
    const stage = stageRef.current
    if (stage?.marker) ignored.current = { code: stage.marker.id, seen: performance.now() }
    post({ type: 'clearImage' })
    stage?.leaveMarker()
    setPhase('finding')
    setMenu(false)
  }

  function flash(text: string) {
    setNote(text)
    setTimeout(() => setNote(''), 2500)
  }

  function copyReport() {
    const st = stageRef.current?.stats()
    const stage = stageRef.current
    const h = shown.current?.handle
    const videos = (h?.videos ?? []).map((v, i) => `Video ${i + 1}: ${v.paused ? 'paused' : 'playing'} · ready ${v.readyState} · ${v.muted ? 'muted' : 'sound'}`)
    const text = [
      'InRL INRL report',
      st && `Drawing ${st.fps} fps · ARKit frames received ${st.frames}/s · bridge delay ${st.delay} ms (worst ${st.delayMax})`,
      st && `Tracking: ${st.track} · surfaces found ${st.planes}`,
      stage && `Post ${id} (${at + 1} of ${list.length}) · 1 unit = ${stage.unit.toFixed(2)} m · placed ${stage.place ? 'yes' : 'no'}`,
      stage?.marker && `Marker ${stage.marker.id} · seen ${stage.marker.found ? 'yes' : 'no'} · ${stage.marker.tracked ? 'tracked' : 'not in view'} · width ${(stage.marker.w * 100).toFixed(1)} cm · ${stage.marker.placement}`,
      ...videos,
      st?.lowPower && 'Low Power Mode: on',
      `Screen ${innerWidth}×${innerHeight} @${devicePixelRatio}x · ${navigator.userAgent}`,
    ].filter(Boolean).join('\n')
    void navigator.clipboard?.writeText(text).then(() => {
      setNote('Report copied')
      setTimeout(() => setNote(''), 2000)
    })
    setMenu(false)
  }

  const owner = data?.post.id === id ? data.owner : null
  const name = owner ? owner.name || `@${owner.username}` : ''
  const caption = data?.post.id === id ? data.post.caption : ''
  const hasVideo = showing === id && !!shown.current?.handle?.videos.length
  const lowPower = !!stats?.lowPower
  const hint =
    phase === 'finding'
      ? slow
        ? 'Still looking: tilt the phone down towards the surface, step back a little, and turn on a light if it’s dim'
        : 'Point at a marker, or at a table or the floor, and move your phone slowly'
      : phase === 'aiming'
        ? 'Tap to place, or point at a marker'
        : phase === 'reading'
          ? 'Marker found: hold your phone steady on it'
          : ''

  return (
    <div className="look pv inrl" data-phase={phase} data-post={id} data-showing={showing} data-strip={list.length > 1}>
      <div
        ref={hostRef}
        className="look-stage"
        {...gestures}
        onTouchEnd={(e) => {
          gestures.onTouchEnd(e)
          // On a marker there is no tap to place: any tap starts the videos (iOS, and Low Power Mode, need one).
          if (phase === 'marker') void shown.current?.handle?.play()
        }}
      />

      <header className="look-top pv-top">
        <button className="look-icon" aria-label="Back" onClick={back}><BackIcon color="#fff" /></button>
        <ModePill active="INRL" onChange={switchMode} />
        <button className="look-icon" aria-label="Menu" onClick={() => setMenu(true)}><MenuIcon color="#fff" /></button>
      </header>

      {stats && (
        <p className="look-fps inrl-readout" aria-live="off">
          <strong className={stats.fps >= 50 ? 'ok' : stats.fps >= 30 ? 'meh' : 'bad'}>{stats.fps}</strong> fps
          {stats.track !== 'normal' && <> · {stats.track}</>}
        </p>
      )}

      {hint && <p className="look-hint inrl-hint">{hint}</p>}

      <section className="pv-info inrl-info">
        {owner && (
          <Link to={`/u/${owner.username}`} className="pv-who">
            <Avatar name={name} src={owner.avatar} size={32} />
            <span className="pv-name t-heading-16">{name}</span>
          </Link>
        )}
        {caption && <p className="t-body-14 inrl-caption">{caption}</p>}
      </section>
      {lowPower && <p className="look-fps inrl-lowpower">Low Power Mode: 30 fps, tap the scene to start videos</p>}
      {hasVideo && (phase === 'placed' || phase === 'marker') && (
        <aside className="pv-actions">
          <button aria-label={sound ? 'Sound off' : 'Sound on'} onClick={toggleSound}>{sound ? <SoundOnIcon color="#fff" /> : <SoundOffIcon color="#fff" />}</button>
        </aside>
      )}
      {list.length > 1 && <PostStrip list={list} at={at} smooth onPick={go} />}

      {menu && (
        <div className="look-sheet inrl-menu" role="dialog" aria-label="Menu">
          {phase === 'placed' && <button className="btn btn-secondary" onClick={placeAgain}>Place again</button>}
          {(phase === 'marker' || phase === 'reading') && <button className="btn btn-secondary" onClick={leaveMarker}>Place on a surface instead</button>}
          <button className="btn btn-secondary" onClick={copyReport}>Copy test report</button>
          <button className="btn btn-secondary" onClick={() => setMenu(false)}>Close</button>
        </div>
      )}
      {note && <p className="pv-note t-body-14-medium" role="status">{note}</p>}
    </div>
  )
}

/** Safari, desktop, Android (for now): where table mode works, or the author's marker. */
function Elsewhere({ id, list, at }: { id: string; list: StripPost[]; at: number }) {
  const navigate = useNavigate()
  const { state } = useLocation()
  const [data, setData] = useState<LoadedPost | null>(null)
  useEffect(() => {
    let live = true
    loadPost(id).then((d) => live && setData(d)).catch(() => {})
    return () => {
      live = false
    }
  }, [id])
  const iPhone = /iPhone|iPad|iPod/.test(navigator.userAgent)
  // The app gets the posts around this one, so its strip matches.
  const around = list.slice(Math.max(0, at - 30), at + 30).map((p) => p.id)
  const path = `/p/${id}/inrl?list=${around.join(',')}&from=safari`
  const owner = data?.owner
  const name = owner ? owner.name || `@${owner.username}` : ''
  const back = () => navigate(`/p/${id}`, { replace: true, state: { ...state, list } })

  return (
    <div className="look pv inrl-elsewhere" style={{ background: data?.post.scene.background.color }}>
      {data?.post.thumb && <div className="pv-art"><img src={data.post.thumb} alt="" /></div>}
      <header className="look-top pv-top">
        <button className="look-icon" aria-label="Back" onClick={back}><BackIcon color="#fff" /></button>
        <ModePill active="INRL" onChange={(m) => m === 'IN3D' && back()} />
        <span className="look-icon" />
      </header>
      <div className="look-sheet">
        <h1 className="t-heading-22">See it on your table</h1>
        <p className="t-body-14">
          {iPhone
            ? 'For now, placing a scene on a table or the floor works in the InRL test app. If it is on this iPhone, open the post there.'
            : 'For now, placing a scene on a table or the floor works in the InRL test app on iPhone. Android is coming.'}
        </p>
        {iPhone && <a className="btn btn-primary" href={openInAppLink(path, phoneKey())}>Open in the InRL test app</a>}
        {data?.marker && (
          <button className="btn btn-secondary" onClick={() => navigate(`/m/${data.marker!.code}?post=${id}`)}>See it on {name}’s marker</button>
        )}
        <button className="btn btn-secondary" onClick={back}>Back to IN3D</button>
      </div>
    </div>
  )
}
