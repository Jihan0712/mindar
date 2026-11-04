import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { GravitySensor } from '../ar/gravity'
import { ArStage, In3DStage, type Stage, type StageStats } from '../look/stages'
import { buildLook, WORLDS, type LookContent, type World } from '../look/worlds'
import { BackIcon } from '../components/Icons'
import { ModePill } from '../components/ModePill'
import './LookTest.css'

/*
 * Look test: the three worlds' 3D text and material samples, in IN3D and in
 * AR on the test marker, with a frame-rate readout. Checks the art direction
 * holds up on a phone before the editor is built around it.
 */

type Mode = 'IN3D' | 'INRL'
type ArPhase = 'intro' | 'starting' | 'scanning' | 'tracking' | 'error'

const WORLD_KEYS = Object.keys(WORLDS) as World[]
const MAX_CHARS = 10

export default function LookTest() {
  const stageHost = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Stage | null>(null)
  const contentRef = useRef<LookContent | null>(null)
  const [mode, setMode] = useState<Mode>('IN3D')
  const [stageId, setStageId] = useState(0)
  const [arPhase, setArPhase] = useState<ArPhase>('intro')
  const [world, setWorld] = useState<World>('streetwear')
  const [variant, setVariant] = useState(WORLDS.streetwear.variants[0])
  const [draft, setDraft] = useState('InRL')
  const [text, setText] = useState('InRL')
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null)
  const [antiJitter, setAntiJitter] = useState(true)
  const [building, setBuilding] = useState(false)
  const [buildMs, setBuildMs] = useState(0)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<StageStats | null>(null)
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Typing rebuilds the text after a short pause, not on every key.
  useEffect(() => {
    const id = setTimeout(() => setText(draft.slice(0, MAX_CHARS)), 350)
    return () => clearTimeout(id)
  }, [draft])

  // IN3D stage. The AR stage is created from the "Open camera" tap instead.
  useEffect(() => {
    if (mode !== 'IN3D') return
    const stage = new In3DStage(stageHost.current!)
    stageRef.current = stage
    return () => {
      stage.setContent(null)
      stage.dispose()
      stageRef.current = null
    }
  }, [mode])

  // (Re)build the content whenever the choice or the stage changes. Declared
  // after the IN3D effect, so that stage already exists when this runs.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    let cancelled = false
    setBuilding(true)
    const t0 = performance.now()
    stage.setWorld(world)
    buildLook({ world, variant, text, photo })
      .then((content) => {
        if (cancelled) return content.dispose()
        stage.setContent(content)
        contentRef.current?.dispose()
        contentRef.current = content
        setBuildMs(Math.round(performance.now() - t0))
        setError('')
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setBuilding(false))
    return () => {
      cancelled = true
    }
  }, [mode, stageId, world, variant, text, photo])

  useEffect(() => () => contentRef.current?.dispose(), [])

  useEffect(() => {
    const id = setInterval(() => stageRef.current && setStats(stageRef.current.stats()), 500)
    return () => clearInterval(id)
  }, [])

  function changeMode(m: string) {
    if (m !== 'IN3D' && m !== 'INRL') return
    if (m === mode) return
    if (mode === 'INRL') {
      stageRef.current?.setContent(null)
      stageRef.current?.dispose()
      stageRef.current = null
    }
    contentRef.current?.dispose()
    contentRef.current = null
    setStats(null)
    setArPhase('intro')
    setMode(m)
  }

  // Runs straight from the tap: iOS only asks for motion access from a gesture.
  function openCamera(withAntiJitter = antiJitter) {
    const gravity = new GravitySensor()
    void gravity.request()
    setArPhase('starting')
    const stage = new ArStage(stageHost.current!, {
      onFound: () => setArPhase('tracking'),
      onLost: () => setArPhase('scanning'),
    })
    stageRef.current = stage
    stage
      .start(gravity, withAntiJitter)
      .then(() => {
        setArPhase('scanning')
        setStageId((n) => n + 1)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
        setArPhase('error')
      })
  }

  // Restarts the camera with anti-jitter on/off, to compare (from a tap, so iOS allows it).
  function toggleAntiJitter() {
    const next = !antiJitter
    setAntiJitter(next)
    stageRef.current?.setContent(null)
    stageRef.current?.dispose()
    stageRef.current = null
    contentRef.current?.dispose()
    contentRef.current = null
    setStats(null)
    openCamera(next)
  }

  function chooseWorld(w: World) {
    setWorld(w)
    setVariant(WORLDS[w].variants[0])
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return
    try {
      // Cap the size (a 12 MP photo would be a 48 MB texture) and copy it to
      // a canvas: three.js can't flip ImageBitmaps, so they came out upside
      // down (text on the toy read mirrored).
      const bmp = await createImageBitmap(file)
      const k = Math.min(1, 1024 / Math.max(bmp.width, bmp.height))
      const c = document.createElement('canvas')
      c.width = Math.round(bmp.width * k)
      c.height = Math.round(bmp.height * k)
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
      bmp.close()
      setPhoto(c)
    } catch {
      setError('That photo could not be opened. Try a JPEG or PNG.')
    }
  }

  const report = [
    `Look test: ${WORLDS[world].label} / ${variant} / "${text}"`,
    `View: ${mode}${mode === 'INRL' ? ` (${arPhase}${stats?.placement ? `, ${stats.placement} marker` : ''})` : ''}`,
    `Frame rate: ${stats?.fps ?? '-'} fps`,
    `Triangles: ${stats ? stats.triangles.toLocaleString('en') : '-'} · draw calls: ${stats?.drawCalls ?? '-'}`,
    `Reflections: ${stats?.reflections ?? '-'}`,
    ...(mode === 'INRL' ? [`Anti-jitter: ${antiJitter ? 'on' : 'off'}`] : []),
    `Build time: ${buildMs} ms`,
    `Screen: ${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
    `Device: ${navigator.userAgent}`,
  ].join('\n')

  const showControls = mode === 'IN3D' || arPhase === 'scanning' || arPhase === 'tracking'

  return (
    <div className="look" data-mode={mode} data-world={world} data-phase={mode === 'INRL' ? arPhase : 'in3d'} data-building={building}>
      <div ref={stageHost} className="look-stage" key={mode} />

      <header className="look-top">
        <Link to="/" className="look-icon" aria-label="Back"><BackIcon color={mode === 'INRL' || world !== 'bubblegum' ? '#fff' : undefined} /></Link>
        <ModePill active={mode} onChange={changeMode} />
        <span className="look-icon" />
      </header>

      {stats && (
        <p className="look-fps" aria-live="off">
          <strong className={stats.fps >= 50 ? 'ok' : stats.fps >= 30 ? 'meh' : 'bad'}>{stats.fps}</strong> fps{stats.cameraFps ? ` · camera ${stats.cameraFps}` : ""} · {Math.round(stats.triangles / 1000)}k tri
        </p>
      )}

      {mode === 'INRL' && arPhase === 'scanning' && <p className="look-hint">Point your camera at the marker</p>}
      {mode === 'INRL' && arPhase === 'starting' && <p className="look-hint">Starting the camera…</p>}

      {mode === 'INRL' && (arPhase === 'intro' || arPhase === 'error') && (
        <div className="look-sheet">
          <h1 className="t-heading-22">{arPhase === 'error' ? 'Something went wrong' : 'Look test in AR'}</h1>
          <p className="t-body-14">
            {arPhase === 'error'
              ? error
              : 'Point the camera at the test marker from about 30 cm away. Chrome will reflect your room, so try it near a window or a lamp too.'}
          </p>
          {arPhase === 'error'
            ? <button className="btn btn-primary" onClick={() => location.reload()}>Try again</button>
            : <button className="btn btn-primary" onClick={() => openCamera()}>Open camera</button>}
          <Link className="btn btn-secondary" to="/marker">I need the marker</Link>
        </div>
      )}

      {showControls && (
        <div className="look-panel">
          <div className="look-worlds" role="tablist">
            {WORLD_KEYS.map((w) => (
              <button key={w} role="tab" aria-selected={w === world} className={w === world ? 'is-active' : ''} onClick={() => chooseWorld(w)}>
                {WORLDS[w].label}
              </button>
            ))}
          </div>
          <div className="look-row">
            {WORLDS[world].variants.length > 1 && WORLDS[world].variants.map((v) => (
              <button key={v} className={`look-chip${v === variant ? ' is-active' : ''}`} onClick={() => setVariant(v)}>{v}</button>
            ))}
            {mode === 'INRL' && (
              <button className={`look-chip${antiJitter ? ' is-active' : ''}`} onClick={toggleAntiJitter}>Anti-jitter {antiJitter ? 'on' : 'off'}</button>
            )}
            {world === 'designers' && (
              <>
                <button className="look-chip" onClick={() => fileRef.current?.click()}>{photo ? 'Change toy photo' : 'Photo on the toy'}</button>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pickPhoto(e.target.files?.[0])} />
              </>
            )}
          </div>
          <div className="look-row">
            <input
              className="look-input"
              value={draft}
              maxLength={MAX_CHARS}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button className="look-chip" onClick={() => navigator.clipboard?.writeText(report).then(() => setCopied(true))}>
              {copied ? 'Copied' : 'Copy report'}
            </button>
          </div>
          {error && mode === 'IN3D' && <p className="look-error t-label-12">{error}</p>}
        </div>
      )}
    </div>
  )
}
