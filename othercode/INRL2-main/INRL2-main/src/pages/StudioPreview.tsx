import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { GravitySensor } from '../ar/gravity'
import { ArStage } from '../look/stages'
import { buildScene, type SceneHandle } from '../scene/buildScene'
import { emptyScene, loadScene } from '../studio/scenes'
import { BackIcon, SoundOffIcon, SoundOnIcon } from '../components/Icons'
import './LookTest.css'
import './Studio.css'

/*
 * InStudio → preview: the scene being edited, on the test marker in AR.
 * Same tracker, anti-jitter, flat/upright placement and camera reflections
 * as the look test. Personal markers arrive in step 3.
 */

type Phase = 'intro' | 'starting' | 'scanning' | 'tracking' | 'error'

export default function StudioPreview() {
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<ArStage | null>(null)
  const handleRef = useRef<SceneHandle | null>(null)
  const [phase, setPhase] = useState<Phase>('intro')
  const [error, setError] = useState('')
  const [fps, setFps] = useState(0)
  const [camFps, setCamFps] = useState(0)
  const [sound, setSound] = useState(false)
  const [playing, setPlaying] = useState(0)
  const [placement, setPlacement] = useState('flat')
  const [frameLock, setFrameLock] = useState(true)
  const [gyro, setGyro] = useState(true)
  const [gyroOn, setGyroOn] = useState(false)
  const [resolution, setResolution] = useState('')
  const [copied, setCopied] = useState(false)

  // Steadiness report (measured on the phone): hold still facing the marker ~10 s, then copy.
  function copyReport() {
    const stage = stageRef.current
    if (!stage) return
    const text = [
      'InRL AR report',
      `Frame lock ${frameLock ? 'on' : 'off'}, gyro switch ${gyro ? 'on' : 'off'}`,
      ...stage.report(),
      `Scene: ${draft.objects.length} objects (${draft.objects.map((o) => o.kind).join(', ')})`,
      `Screen ${innerWidth}×${innerHeight} @${devicePixelRatio}x · ${navigator.userAgent}`,
    ].join('\n')
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  const { id = '' } = useParams()
  const [draft] = useState(() => loadScene(id) ?? emptyScene(id))
  const back = `/studio/edit/${id}${location.search}`

  useEffect(() => () => {
    stageRef.current?.setContent(null)
    stageRef.current?.dispose()
    handleRef.current?.dispose()
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      if (stageRef.current) {
        const st = stageRef.current.stats()
        setFps(st.fps)
        setCamFps(st.cameraFps ?? 0)
        setGyroOn(!!st.gyro)
        setResolution(st.resolution ?? '')
        setPlacement(st.placement ?? 'flat')
      }
      setPlaying(handleRef.current?.videos.filter((v) => !v.paused).length ?? 0)
    }, 500)
    return () => clearInterval(id)
  }, [])

  // Runs straight from the tap: iOS only allows camera and motion access from a gesture.
  function openCamera(lock = frameLock, useGyro = gyro) {
    const gravity = new GravitySensor()
    void gravity.request()
    setPhase('starting')
    const stage = new ArStage(hostRef.current!, {
      onFound: () => setPhase('tracking'),
      onLost: () => setPhase('scanning'),
    })
    stageRef.current = stage
    Promise.all([stage.start(gravity, true, lock, useGyro), buildScene(draft)])
      .then(([, handle]) => {
        handleRef.current = handle
        stage.setContent(handle)
        // Silent playback starts on its own; the sound button unmutes (from a tap).
        handle.setMuted(true)
        void handle.play()
        setPhase('scanning')
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
        setPhase('error')
      })
  }

  // Restarts the camera with frame lock / gyroscope on or off, to compare (from a tap, so iOS allows it).
  function restart(lock: boolean, useGyro: boolean) {
    setFrameLock(lock)
    setGyro(useGyro)
    stageRef.current?.setContent(null)
    stageRef.current?.dispose()
    handleRef.current?.dispose()
    stageRef.current = null
    handleRef.current = null
    setSound(false)
    openCamera(lock, useGyro)
  }

  function toggleSound() {
    const h = handleRef.current
    if (!h) return
    h.setMuted(sound)
    void h.play()
    setSound(!sound)
  }

  const empty = draft.objects.length === 0
  const hasVideo = draft.objects.some((o) => o.kind === 'video')

  return (
    <div className="look" data-mode="INRL" data-phase={phase} data-videos-playing={playing} data-placement={placement} data-gyro={gyroOn}>
      <div ref={hostRef} className="look-stage" />
      <header className="look-top">
        <Link to={back} className="look-icon" aria-label="Back to InStudio"><BackIcon color="#fff" /></Link>
        <span className="t-label-12-medium" style={{ color: '#fff' }}>Preview on your marker</span>
        <span className="look-icon" />
      </header>

      {fps > 0 && (
        <p className="look-fps" aria-live="off">
          <strong className={fps >= 50 ? 'ok' : fps >= 30 ? 'meh' : 'bad'}>{fps}</strong> fps{camFps > 0 && <> · camera {camFps}</>}{gyroOn && <> · gyro</>}{resolution && <> · {resolution}</>}
        </p>
      )}
      {hasVideo && (phase === 'scanning' || phase === 'tracking') && (
        <button className="studio-sound" style={{ position: 'absolute' }} aria-label={sound ? 'Sound off' : 'Sound on'} onClick={toggleSound}>
          {sound ? <SoundOnIcon color="#fff" /> : <SoundOffIcon color="#fff" />}
        </button>
      )}
      {(phase === 'scanning' || phase === 'tracking') && (
        <div className="studio-lock">
          <button className="look-chip" onClick={() => restart(frameLock, !gyro)}>Gyro {gyro ? 'on' : 'off'}</button>
          <button className="look-chip" onClick={() => restart(!frameLock, gyro)}>Frame lock {frameLock ? 'on' : 'off'}</button>
          <button className="look-chip" onClick={copyReport}>{copied ? 'Copied' : 'Copy report'}</button>
        </div>
      )}
      {phase === 'scanning' && <p className="look-hint">Point your camera at the marker</p>}
      {phase === 'starting' && <p className="look-hint">Starting the camera…</p>}

      {(phase === 'intro' || phase === 'error') && (
        <div className="look-sheet">
          <h1 className="t-heading-22">{phase === 'error' ? 'Something went wrong' : empty ? 'Your scene is empty' : 'See it on your marker'}</h1>
          <p className="t-body-14">
            {phase === 'error'
              ? error
              : empty
                ? 'Add a few objects in InStudio first, then come back here.'
                : `Your ${draft.objects.length} object${draft.objects.length > 1 ? 's' : ''} will stand on the test marker. Point the camera at it from about 30 cm away.`}
          </p>
          {phase === 'error'
            ? <button className="btn btn-primary" onClick={() => location.reload()}>Try again</button>
            : !empty && <button className="btn btn-primary" onClick={() => openCamera()}>Open camera</button>}
          <Link className="btn btn-secondary" to={empty ? back : '/marker'}>{empty ? 'Back to InStudio' : 'I need the marker'}</Link>
        </div>
      )}
    </div>
  )
}
