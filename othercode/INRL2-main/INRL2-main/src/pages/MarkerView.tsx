import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { GravitySensor, takePrimedGravity } from '../ar/gravity'
import { ArStage, In3DStage } from '../look/stages'
import { buildScene, type SceneHandle } from '../scene/buildScene'
import { sceneSchema, type Scene } from '../scene/schema'
import { getPost, markerPage, type MarkerPage, type PostSummary } from '../account/publish'
import { BackIcon, SoundOffIcon, SoundOnIcon } from '../components/Icons'
import { countView } from '../social/social'
import { ModePill, type ViewMode } from '../components/ModePill'
import './LookTest.css'
import './Studio.css'
import './MarkerView.css'

/*
 * What a marker shows (step 3), at /m/<code>: the link inside every
 * marker's QR code, so the phone's normal camera lands here. Also /scan, the
 * in-app Scan button: the camera opens first, reads the QR code inside the
 * artwork, then tracks that marker in the same camera session.
 *
 * INRL (default): the marker's post on the marker in AR; swipe the strip at
 * the bottom through the owner's other posts (decision 2026-10-06).
 * IN3D: the scene to turn around. (No INART page since 2026-10-07: the switch
 * offers IN3D and INRL; the INART code below is no longer reachable from it.)
 */

type Phase = 'intro' | 'starting' | 'reading' | 'loading' | 'scanning' | 'tracking' | 'error'

/** The step-1 test marker (its QR holds …/m/test): the hand-made test scene. */
async function testPage(): Promise<MarkerPage> {
  const scene = sceneSchema.parse(await (await fetch('/test/scene.json')).json())
  const post = { id: 'test', caption: 'The InRL test scene', thumb: null, objects: scene.objects.length, created: 0 }
  return {
    marker: { code: 'test', seed: '', version: 1, ready: true, matching: 0, post: 'test', image: '/test/marker.png', mind: '/test/marker.mind' },
    owner: { username: 'inrl', name: 'InRL' },
    post: { ...post, scene },
    posts: [post],
  }
}

const loadPage = (code: string) => (code === 'test' ? testPage() : markerPage(code))

export default function MarkerView() {
  const { code: routeCode } = useParams()
  const scanning = !routeCode
  const navigate = useNavigate()
  const { state } = useLocation() as { state: { autostart?: boolean } | null }

  const hostRef = useRef<HTMLDivElement>(null)
  const arRef = useRef<ArStage | null>(null)
  const in3dRef = useRef<In3DStage | null>(null)
  const handleRef = useRef<SceneHandle | null>(null)
  const scenes = useRef(new Map<string, Promise<Scene>>())
  const shownId = useRef<string | null>(null)

  const [page, setPage] = useState<MarkerPage | null>(null)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<Phase>(scanning ? 'intro' : 'loading')
  const [mode, setMode] = useState<ViewMode>('INRL')
  const [index, setIndex] = useState(0)
  const [sound, setSound] = useState(false)
  const [playing, setPlaying] = useState(0)
  const [copied, setCopied] = useState(false)
  const [speed, setSpeed] = useState<{ fps: number; hitches: number } | null>(null)

  // Steadiness numbers measured on the phone (as in the InStudio preview), to paste to Claude.
  function copyReport() {
    const stage = arRef.current ?? in3dRef.current
    if (!stage) return
    const h = handleRef.current
    const text = [
      'InRL scan report',
      `Marker ${page?.marker.code ?? '?'} (v${page?.marker.version ?? '?'}, ${page?.marker.matching ?? '?'} matching points) · ${mode} · phase ${phase}`,
      `Post ${current?.id ?? '-'}: ${current?.objects ?? 0} objects, ${h?.videos.length ?? 0} videos/GIFs (${playing} playing)`,
      ...stage.report(),
      `Screen ${innerWidth}×${innerHeight} @${devicePixelRatio}x · ${navigator.userAgent}`,
    ].join('\n')
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const posts = page?.posts ?? []
  const current: PostSummary | null = posts[index] ?? null

  // The marker's details (the link from the QR code). The intro waits for a tap (iOS camera rules).
  useEffect(() => {
    if (!routeCode) return
    let gone = false
    loadPage(routeCode.toLowerCase())
      .then((p) => {
        if (gone) return
        if (p.post) scenes.current.set(p.post.id, Promise.resolve(p.post.scene))
        setPage(p)
        // From a post's INRL button (/m/<code>?post=<id>): that post, else the one on the marker.
        const want = new URLSearchParams(location.search).get('post')
        const wanted = p.posts.findIndex((x) => x.id === want)
        setIndex(wanted >= 0 ? wanted : Math.max(0, p.posts.findIndex((x) => x.id === p.post?.id)))
        setPhase('intro')
      })
      .catch((e) => {
        if (gone) return
        setError(e instanceof Error ? e.message : String(e))
        setPhase('error')
      })
    return () => {
      gone = true
    }
  }, [routeCode])

  useEffect(() => () => stopAll(), [])

  // Safari's own pinch (page zoom, tab overview) would steal two-finger gestures from the 3D view.
  useEffect(() => {
    if (mode === 'INART') return
    const stop = (e: Event) => e.preventDefault()
    document.addEventListener('gesturestart', stop)
    document.addEventListener('gesturechange', stop)
    return () => {
      document.removeEventListener('gesturestart', stop)
      document.removeEventListener('gesturechange', stop)
    }
  }, [mode])

  useEffect(() => {
    const id = setInterval(() => {
      setPlaying(handleRef.current?.videos.filter((v) => !v.paused).length ?? 0)
      const st = (arRef.current ?? in3dRef.current)?.stats()
      setSpeed(st && st.fps ? { fps: st.fps, hitches: st.hitches ?? 0 } : null)
    }, 500)
    return () => clearInterval(id)
  }, [])

  function stopAll() {
    arRef.current?.setContent(null)
    arRef.current?.dispose()
    arRef.current = null
    in3dRef.current?.setContent(null)
    in3dRef.current?.dispose()
    in3dRef.current = null
    handleRef.current?.dispose()
    handleRef.current = null
    shownId.current = null
  }

  function sceneOf(id: string): Promise<Scene> {
    let p = scenes.current.get(id)
    if (!p) {
      p = getPost(id).then((r) => sceneSchema.parse(r.post.scene))
      p.catch(() => scenes.current.delete(id))
      scenes.current.set(id, p)
    }
    return p
  }

  /** Shows a post in whichever stage is open; previous one freed. */
  async function show(id: string) {
    shownId.current = id
    const scene = await sceneOf(id)
    const handle = await buildScene(scene)
    const stage = arRef.current ?? in3dRef.current
    if (shownId.current !== id || !stage) return handle.dispose()
    const old = handleRef.current
    handleRef.current = handle
    stage.setContent(handle)
    if (in3dRef.current) {
      in3dRef.current.setBackground(scene.background.color)
      in3dRef.current.resetView()
    }
    old?.dispose()
    handle.setMuted(!sound)
    void handle.play()
    countView(id)
    // Neighbours load ahead, so swiping is quick.
    const at = posts.findIndex((p) => p.id === id)
    for (const n of [at - 1, at + 1]) if (at >= 0 && posts[n]) void sceneOf(posts[n].id).catch(() => {})
  }

  // Swiping (or tapping the strip) changes the post in the open stage.
  useEffect(() => {
    if (current && (arRef.current || in3dRef.current) && shownId.current !== current.id) void show(current.id).catch(fail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : String(e))
    setPhase('error')
  }

  // ------------------------------------------------------------- INRL

  /** From the tap: iOS only allows camera and motion access from a gesture. */
  function openCamera() {
    stopAll()
    setMode('INRL')
    let gravity = takePrimedGravity()
    if (!gravity) {
      gravity = new GravitySensor()
      void gravity.request()
    }
    setPhase('starting')
    const stage = new ArStage(hostRef.current!, {
      onFound: () => setPhase('tracking'),
      onLost: () => setPhase('scanning'),
    })
    arRef.current = stage
    const run = async () => {
      if (page) {
        await stage.start(gravity, true, true, true, page.marker.mind)
        setPhase('scanning')
        if (current) await show(current.id)
        return
      }
      // In-app scan: read the QR code in the artwork first.
      await stage.openCamera(gravity)
      setPhase('reading')
      const found = await readCode(stage)
      if (arRef.current !== stage) return
      setPhase('loading')
      const p = await loadPage(found)
      if (arRef.current !== stage) return
      if (p.post) scenes.current.set(p.post.id, Promise.resolve(p.post.scene))
      const at = Math.max(0, p.posts.findIndex((x) => x.id === p.post?.id))
      setPage(p)
      setIndex(at)
      await stage.track(p.marker.mind)
      setPhase('scanning')
      if (p.posts[at]) {
        shownId.current = null
        await show(p.posts[at].id)
      }
    }
    run().catch(fail)
  }

  /** Reads frames until an InRL marker's QR code shows up. */
  async function readCode(stage: ArStage): Promise<string> {
    const { QrReader, markerCode } = await import('../marker/qr')
    const reader = new QrReader()
    for (;;) {
      if (arRef.current !== stage) throw new Error('Scanning stopped.')
      const video = stage.video
      const text = video ? reader.read(video) : null
      const code = text ? markerCode(text) : null
      if (code) return code
      await new Promise((r) => setTimeout(r, 150))
    }
  }

  // Coming from the Scan button: it already asked for motion access in its tap.
  useEffect(() => {
    if (scanning && state?.autostart) openCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------------------------- modes

  function switchMode(m: ViewMode) {
    if (m === mode) return
    if (m === 'INRL') return openCamera()
    stopAll()
    setMode(m)
    if (m === 'IN3D' && page) {
      in3dRef.current = new In3DStage(hostRef.current!, null)
      if (current) void show(current.id).catch(fail)
    }
    setPhase('intro')
  }

  function toggleSound() {
    const h = handleRef.current
    if (!h) return
    h.setMuted(sound)
    void h.play()
    setSound(!sound)
  }

  // Swipe along the strip: next / previous post.
  const touch = useRef<{ x: number; t: number } | null>(null)
  function onStripStart(e: React.TouchEvent) {
    touch.current = { x: e.touches[0].clientX, t: Date.now() }
  }
  function onStripEnd(e: React.TouchEvent) {
    const start = touch.current
    touch.current = null
    if (!start) return
    const dx = e.changedTouches[0].clientX - start.x
    if (Math.abs(dx) < 40 || Date.now() - start.t > 600) return
    setIndex((i) => Math.min(posts.length - 1, Math.max(0, i + (dx < 0 ? 1 : -1))))
  }

  const owner = page?.owner
  const who = owner ? owner.name || `@${owner.username}` : ''
  const live = phase === 'scanning' || phase === 'tracking'
  const back = () => (history.length > 1 ? navigate(-1) : navigate('/'))
  const hasVideo = !!handleRef.current?.videos.length

  return (
    <div className="look mv" data-mode={mode} data-phase={phase} data-videos-playing={playing} data-post={current?.id ?? ''} data-code={page?.marker.code ?? ''}>
      <div ref={hostRef} className="look-stage" />

      <header className="look-top mv-top">
        <button className="look-icon" aria-label="Back" onClick={back}><BackIcon color={mode === 'INART' ? undefined : '#fff'} /></button>
        {page ? <ModePill active={mode} onChange={switchMode} /> : <span className="t-label-12-medium mv-title">Scan a marker</span>}
        <span className="look-icon" />
      </header>

      {mode === 'INART' && page && (
        <div className="mv-art">
          <div className="mv-art-card">
            {current?.thumb ? <img src={current.thumb} alt="" /> : <span className="t-body-14">No picture</span>}
          </div>
          <p className="t-body-14-bold">{who}</p>
          {current?.caption && <p className="t-body-14">{current.caption}</p>}
          <button className="btn btn-primary" onClick={openCamera}>See it in real life</button>
        </div>
      )}

      {mode === 'IN3D' && <p className="look-hint mv-tip">One finger turns, pinch zooms, two fingers move</p>}

      {mode === 'INRL' && phase === 'reading' && (
        <div className="mv-scan" aria-hidden="true">
          <svg className="mv-frame" viewBox="0 0 100 100" fill="none" stroke="var(--signal-ar-cyan)" strokeWidth="1.6" strokeLinecap="round">
            <path d="M4 26A22 22 0 0 1 26 4M74 4a22 22 0 0 1 22 22M96 74a22 22 0 0 1-22 22M26 96A22 22 0 0 1 4 74" />
          </svg>
          <p className="look-hint">Point at an InRL marker</p>
        </div>
      )}
      {mode === 'INRL' && phase === 'scanning' && <p className="look-hint">Point your camera at {page?.marker.code === 'test' ? 'the test marker' : `${who}’s marker`}</p>}
      {(phase === 'starting' || (phase === 'loading' && scanning)) && <p className="look-hint">{phase === 'starting' ? 'Starting the camera…' : 'Marker found, loading…'}</p>}

      {live && hasVideo && (
        <button className="studio-sound" style={{ position: 'absolute' }} aria-label={sound ? 'Sound off' : 'Sound on'} onClick={toggleSound}>
          {sound ? <SoundOnIcon color="#fff" /> : <SoundOffIcon color="#fff" />}
        </button>
      )}

      {(live || mode === 'IN3D') && (
        <button className="look-chip mv-report" onClick={copyReport}>{copied ? 'Copied' : 'Copy report'}</button>
      )}
      {speed && mode !== 'INART' && (
        <p className="look-fps" aria-live="off">
          <strong className={speed.fps >= 50 ? 'ok' : speed.fps >= 30 ? 'meh' : 'bad'}>{speed.fps}</strong> fps · {speed.hitches} slow
        </p>
      )}

      {page && posts.length > 1 && mode !== 'INART' && (live || mode === 'IN3D') && (
        <div className="mv-strip" onTouchStart={onStripStart} onTouchEnd={onStripEnd}>
          {posts.map((p, i) => (
            <button key={p.id} className={i === index ? 'is-active' : ''} aria-label={p.caption || `Post ${i + 1}`} onClick={() => setIndex(i)}>
              {p.thumb ? <img src={p.thumb} alt="" /> : <span />}
            </button>
          ))}
        </div>
      )}

      {phase === 'intro' && mode === 'INRL' && (
        <div className="look-sheet mv-sheet">
          {page ? (
            <>
              <p className="t-label-12-medium mv-owner">{owner ? `@${owner.username}` : ''}</p>
              <h1 className="t-heading-22">{page.post ? `${who}’s scene` : `${who} hasn’t posted yet`}</h1>
              {current?.caption && <p className="t-body-14">{current.caption}</p>}
              <p className="t-body-14 mv-muted">Point your camera at the marker, from about 30 cm away.</p>
              {page.post && <button className="btn btn-primary" onClick={openCamera}>Open camera</button>}
              {page.post && <button className="btn btn-secondary" onClick={() => switchMode('IN3D')}>See it in 3D</button>}
            </>
          ) : (
            <>
              <h1 className="t-heading-22">Scan a marker</h1>
              <p className="t-body-14">Point your camera at an InRL marker: the QR code in the middle tells us whose it is, then their scene appears on it.</p>
              <button className="btn btn-primary" onClick={openCamera}>Open camera</button>
              <Link className="btn btn-secondary" to="/">Not now</Link>
            </>
          )}
        </div>
      )}

      {phase === 'error' && (
        <div className="look-sheet">
          <h1 className="t-heading-22">Something went wrong</h1>
          <p className="t-body-14">{error}</p>
          <button className="btn btn-primary" onClick={() => location.reload()}>Try again</button>
          <Link className="btn btn-secondary" to="/">Home</Link>
        </div>
      )}
    </div>
  )
}
