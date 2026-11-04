import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as THREE from 'three'
import { MarkerTracker } from '../ar/MarkerTracker'
import { GravitySensor } from '../ar/gravity'
import { applyPlacement, PlacementTracker, type Placement } from '../ar/placement'
import { addLights, buildScene, makeShadowCatcher, type SceneHandle } from '../scene/buildScene'
import { loadScene } from '../scene/schema'
import { BackIcon, MenuIcon, SoundOffIcon, SoundOnIcon } from '../components/Icons'
import { ModePill } from '../components/ModePill'
import { DebugPanel, type DebugStats } from './DebugPanel'
import './ArTest.css'

const SCENE_URL = '/test/scene.json'
const MARKER_URL = '/test/marker.mind'

type Phase = 'intro' | 'starting' | 'scanning' | 'tracking' | 'error'

const now = () => performance.now()

export default function ArTest() {
  const stageRef = useRef<HTMLDivElement>(null)
  const trackerRef = useRef<MarkerTracker | null>(null)
  const sceneRef = useRef<SceneHandle | null>(null)
  const [phase, setPhase] = useState<Phase>('intro')
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const [placementAttr, setPlacementAttr] = useState<Placement>('flat')
  const [stats, setStats] = useState<DebugStats>({ fps: 0, startMs: 0, firstFoundMs: null, losses: 0, placement: 'flat', tiltDeg: null, sensor: 'not asked' })
  const gravityRef = useRef<GravitySensor | null>(null)
  const statsRef = useRef(stats)

  function fail(e: unknown) {
    console.error(e)
    setError(e instanceof Error ? e.message : String(e))
    setPhase('error')
  }

  // Load the scene while the person reads the intro, so the tap is instant.
  const scenePromise = useRef<Promise<SceneHandle> | null>(null)
  useEffect(() => {
    scenePromise.current = loadScene(SCENE_URL).then(buildScene)
    scenePromise.current.then((s) => (sceneRef.current = s)).catch((e) => fail(e))
    return () => {
      trackerRef.current?.stop()
      gravityRef.current?.stop()
      sceneRef.current?.dispose()
    }
  }, [])

  // Must run straight from the tap: iOS only unlocks video sound and music
  // when play() is called inside the gesture, before any await.
  function start() {
    // Motion sensor (to tell flat markers from vertical ones). iOS asks for
    // permission, and only from inside a tap, so this must come first.
    const gravity = new GravitySensor()
    gravityRef.current = gravity
    void gravity.request().then(() => update({ sensor: gravity.status }))
    const handle = sceneRef.current
    if (handle) {
      handle.setMuted(false)
      void handle.play().then(() => handle.pause())
    }
    void begin()
  }

  async function begin() {
    setPhase('starting')
    const t0 = now()
    try {
      const handle = sceneRef.current ?? (await scenePromise.current!)
      const tracker = new MarkerTracker({
        container: stageRef.current!,
        targetSrc: MARKER_URL,
        onFound: () => {
          setPhase('tracking')
          void handle.play()
          const s = statsRef.current
          if (s.firstFoundMs === null) update({ firstFoundMs: Math.round(now() - t0) })
        },
        onLost: () => {
          setPhase('scanning')
          handle.pause()
          update({ losses: statsRef.current.losses + 1 })
        },
      })
      trackerRef.current = tracker

      // The scene sits in `content`, which is turned to stand on a flat
      // marker or upright in front of a vertical one (see ar/placement.ts).
      const content = new THREE.Group()
      const { sun } = addLights(content)
      const shadowCatcher = makeShadowCatcher()
      content.add(shadowCatcher, handle.root)
      tracker.anchor.add(content)
      applyPlacement(content, handle.root, 'flat')
      const placement = new PlacementTracker()
      const setPlacement = (p: Placement) => {
        applyPlacement(content, handle.root, p)
        // Floor shadows only make sense when the scene stands on the marker.
        shadowCatcher.visible = p === 'flat'
        setPlacementAttr(p)
        update({ placement: p })
      }

      await tracker.start()
      // The anchor scales marker widths up to MindAR's pixel units, but a
      // shadow camera does not inherit scale, so size its box to match.
      const cam = sun.shadow.camera as THREE.OrthographicCamera
      const k = tracker.markerWidth
      cam.left = cam.bottom = -0.8 * k
      cam.right = cam.top = 0.8 * k
      cam.near = 0.1 * k
      cam.far = 4 * k
      cam.updateProjectionMatrix()

      update({ startMs: Math.round(now() - t0) })
      setPhase('scanning')

      const timer = new THREE.Timer()
      let frames = 0
      let since = now()
      tracker.renderer.setAnimationLoop((time) => {
        timer.update(time)
        handle.update(timer.getDelta())
        const gravity = gravityRef.current
        if (tracker.visible && gravity?.hasReading) {
          if (placement.update(tracker.anchor.matrix, gravity.up)) setPlacement(placement.placement)
        }
        tracker.render()
        frames++
        const t = now()
        if (t - since > 1000) {
          update({ fps: Math.round((frames * 1000) / (t - since)), tiltDeg: tracker.visible && gravityRef.current?.hasReading ? placement.tiltDeg : statsRef.current.tiltDeg })
          frames = 0
          since = t
        }
      })
    } catch (e) {
      fail(e)
    }
  }

  function update(patch: Partial<DebugStats>) {
    statsRef.current = { ...statsRef.current, ...patch }
    setStats(statsRef.current)
  }

  function toggleSound() {
    const next = !muted
    setMuted(next)
    sceneRef.current?.setMuted(next)
  }

  return (
    <div className="ar" data-phase={phase} data-placement={placementAttr}>
      <div ref={stageRef} className="ar-stage" />

      <header className="ar-top">
        <Link to="/" className="ar-icon-btn" aria-label="Back"><BackIcon color="#fff" /></Link>
        <ModePill active="INRL" />
        <button className="ar-icon-btn" aria-label="Test details" onClick={() => setShowDebug((v) => !v)}>
          <MenuIcon color="#fff" />
        </button>
      </header>

      {(phase === 'scanning' || phase === 'starting') && (
        <div className="ar-reticle" aria-hidden="true">
          <span /><span /><span /><span />
        </div>
      )}

      {phase === 'scanning' && <p className="ar-hint">Point your camera at the marker</p>}
      {phase === 'starting' && <p className="ar-hint">Starting the camera…</p>}

      {(phase === 'scanning' || phase === 'tracking') && (
        <button className="ar-sound" onClick={toggleSound} aria-label={muted ? 'Sound on' : 'Sound off'}>
          {muted ? <SoundOffIcon color="#fff" /> : <SoundOnIcon color="#fff" />}
        </button>
      )}

      {phase === 'intro' && (
        <div className="ar-sheet">
          <h1 className="t-heading-22">Bring the test scene to life</h1>
          <p className="t-body-14">
            Have the printed marker ready. When the camera opens, point it at the marker from about 30 cm away.
            Sound will play, so turn your volume up.
          </p>
          <button className="btn btn-primary" onClick={start}>Open camera</button>
          <Link className="btn btn-secondary" to="/marker">I need the marker</Link>
        </div>
      )}

      {phase === 'error' && (
        <div className="ar-sheet">
          <h1 className="t-heading-22">Something went wrong</h1>
          <p className="t-body-14">{error}</p>
          <button className="btn btn-primary" onClick={() => location.reload()}>Try again</button>
          <Link className="btn btn-secondary" to="/">Back</Link>
        </div>
      )}

      {showDebug && <DebugPanel stats={stats} phase={phase} getScene={() => sceneRef.current} onClose={() => setShowDebug(false)} />}
    </div>
  )
}
