import { useEffect, useRef, useState } from 'react'
import { appLink, inNativeApp, listen, post } from '../floor/bridge'
import { FloorStage, type FloorStats } from '../floor/FloorStage'
import { buildScene, type SceneHandle } from '../scene/buildScene'
import { sceneSchema, type Scene } from '../scene/schema'
import { fetchCloudList, fetchScene, phoneKey } from '../studio/cloud'
import { getThumb, listScenes, loadScene, sceneName } from '../studio/scenes'
import { SoundOffIcon, SoundOnIcon } from '../components/Icons'
import './LookTest.css'
import './Studio.css'
import './FloorTest.css'

/*
 * iPhone floor-placement test (/floor). Inside the native test app
 * (ios/FloorTest), the camera and ARKit are underneath this transparent
 * page: aim at the floor, tap to drop a saved scene, walk around it. One
 * finger moves it on the floor, two fingers resize and turn it; swipe the
 * strip at the bottom to swap scenes in the same spot. In Safari, the page
 * hands this phone's scene key to the app instead.
 */

interface Entry { id: string; title: string; thumb: string | null }

const TEST: Entry = { id: 'test', title: 'Test scene', thumb: null }

function entries(): Entry[] {
  const mine = listScenes().filter((m) => m.objects > 0).map((m) => ({ id: m.id, title: sceneName(m), thumb: getThumb(m.id) }))
  return [...mine, TEST]
}

async function sceneFor(id: string): Promise<Scene> {
  if (id === TEST.id) return sceneSchema.parse(await (await fetch('/test/scene.json')).json())
  return loadScene(id) ?? fetchScene(id)
}

export default function FloorTest() {
  return inNativeApp() ? <FloorAr /> : <LinkToApp />
}

/** In Safari: send this phone's key to the test app so the person's scenes show up there. */
function LinkToApp() {
  const [copied, setCopied] = useState(false)
  function copyKey() {
    void navigator.clipboard?.writeText(phoneKey()).then(() => setCopied(true))
  }
  return (
    <div className="floor floor-safari">
      <div className="look-sheet">
        <h1 className="t-heading-22">Floor test</h1>
        <p className="t-body-14">
          This test runs in the <strong>InRL Floor</strong> app installed on your iPhone from the Mac. Tap below to open
          it with the scenes you saved in InStudio.
        </p>
        <a className="btn btn-primary" href={appLink(phoneKey())}>Open my scenes in InRL Floor</a>
        <button className="btn btn-secondary" onClick={copyKey}>{copied ? 'Copied: now open InRL Floor, tap “Use my scenes”' : 'If that does nothing: copy my key'}</button>
      </div>
    </div>
  )
}

type Phase = 'finding' | 'aiming' | 'placed'

function FloorAr() {
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<FloorStage | null>(null)
  const handles = useRef(new Map<string, Promise<SceneHandle | null>>())
  /** The scene on screen (for the report, which must copy straight from the tap). */
  const shown = useRef<SceneHandle | null>(null)
  /** Videos the watchdog had to reload (shown in the report). */
  const retries = useRef(0)
  const [list, setList] = useState<Entry[]>(entries)
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('finding')
  const [stats, setStats] = useState<FloorStats | null>(null)
  const [sound, setSound] = useState(false)
  const [hasVideo, setHasVideo] = useState(false)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState('')
  const current = list[Math.min(index, list.length - 1)]

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
        setPhase((p) => (p === 'placed' ? p : f.hit ? 'aiming' : 'finding'))
      },
      (m) => setNotice(m),
    )
    const t = setInterval(() => setStats({ ...stage.stats() }), 500)
    // Watchdog: in the app's web view, our own videos sometimes never start loading on a
    // later launch (stuck at "nothing loaded", likely the pieces cached the first time).
    // Reload such a video fresh, past the cache (the server ignores the query).
    const stuckSince = new Map<HTMLVideoElement, number>()
    const watchdog = setInterval(() => {
      const now = performance.now()
      for (const v of shown.current?.videos ?? []) {
        if (v.readyState > 0 || !v.currentSrc.includes('/api/media/')) {
          stuckSince.delete(v)
          continue
        }
        const since = stuckSince.get(v) ?? now
        stuckSince.set(v, since)
        if (now - since > 3000) {
          stuckSince.delete(v)
          const url = new URL(v.currentSrc)
          url.searchParams.set('fresh', String(Date.now()))
          v.src = url.toString()
          v.load()
          void v.play().catch(() => {})
          retries.current++
        }
      }
    }, 1000)
    // Scenes saved only in the cloud (this phone's key) join the list.
    let linked = false
    try {
      linked = localStorage.getItem('inrl.floor.linked') === '1'
      localStorage.removeItem('inrl.floor.linked')
    } catch { /* no storage */ }
    fetchCloudList()
      .then(() => {
        const next = entries()
        setList(next)
        if (linked) setNotice(`Linked to your phone: ${next.length - 1} scene${next.length === 2 ? '' : 's'} found`)
      })
      .catch((e) => linked && setNotice(`Linked, but your scenes could not load: ${e instanceof Error ? e.message : e}`))
    return () => {
      stop()
      clearInterval(t)
      clearInterval(watchdog)
      stage.dispose()
      for (const p of map.values()) void p.then((h) => h?.dispose())
    }
  }, [])

  function handleFor(id: string) {
    let p = handles.current.get(id)
    if (!p) {
      p = sceneFor(id).then(buildScene).catch((e) => {
        console.error(e)
        handles.current.delete(id)
        return null
      })
      handles.current.set(id, p)
    }
    return p
  }

  // Show the chosen scene; keep its neighbours ready so swiping is instant; free the rest.
  useEffect(() => {
    if (!current) return
    let live = true
    const map = handles.current
    const keep = new Set([-1, 0, 1].map((d) => list[(index + d + list.length) % list.length]?.id))
    for (const [id, p] of handles.current) {
      if (!keep.has(id)) {
        handles.current.delete(id)
        void p.then((h) => h?.dispose())
      }
    }
    setLoading(true)
    void handleFor(current.id).then((h) => {
      if (!live) return
      setLoading(false)
      const stage = stageRef.current
      if (!stage) return
      for (const v of h?.videos ?? []) v.currentTime = 0
      stage.setContent(h)
      shown.current = h
      setHasVideo(!!h?.videos.length)
      h?.setMuted(!sound)
      void h?.play()
      for (const id of keep) if (id) void handleFor(id)
    })
    return () => {
      live = false
      void map.get(current.id)?.then((h) => h?.pause())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, list.length])

  function go(step: number) {
    setIndex((i) => (i + step + list.length) % list.length)
    post({ type: 'haptic' })
  }

  // ---------------------------------------------------------- gestures

  const g = useRef({ moved: false, x: 0, y: 0, start: null as null | { x: number; z: number }, from: null as null | { x: number; z: number }, d0: 0, a0: 0, unit0: 0, yaw0: 0 })

  function twoFinger(t: React.TouchList) {
    const dx = t[1].clientX - t[0].clientX
    const dy = t[1].clientY - t[0].clientY
    return { d: Math.hypot(dx, dy), a: Math.atan2(dy, dx) }
  }

  function onTouchStart(e: React.TouchEvent) {
    const stage = stageRef.current
    if (!stage) return
    const s = g.current
    if (e.touches.length === 1) {
      s.moved = false
      s.x = e.touches[0].clientX
      s.y = e.touches[0].clientY
      const p = stage.floorPoint(s.x, s.y)
      s.start = p && { x: p.x, z: p.z }
      s.from = stage.place && { x: stage.place.pos.x, z: stage.place.pos.z }
    } else if (e.touches.length === 2 && stage.place) {
      s.moved = true
      const { d, a } = twoFinger(e.touches)
      s.d0 = d
      s.a0 = a
      s.unit0 = stage.unit
      s.yaw0 = stage.place.yaw
    }
    if (stage.place) stage.gesturing = true
  }

  function onTouchMove(e: React.TouchEvent) {
    const stage = stageRef.current
    if (!stage?.place) return
    const s = g.current
    if (e.touches.length === 1) {
      const t = e.touches[0]
      if (Math.hypot(t.clientX - s.x, t.clientY - s.y) > 8) s.moved = true
      if (!s.moved || !s.start || !s.from) return
      const p = stage.floorPoint(t.clientX, t.clientY)
      if (p) stage.moveTo(s.from.x + p.x - s.start.x, s.from.z + p.z - s.start.z)
    } else if (e.touches.length === 2 && s.d0 > 0) {
      const { d, a } = twoFinger(e.touches)
      stage.setUnit(s.unit0 * (d / s.d0))
      stage.place.yaw = s.yaw0 - (a - s.a0)
      stage.turnBy(0)
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    const stage = stageRef.current
    if (!stage) return
    const s = g.current
    if (e.touches.length > 0) {
      // One finger left after a pinch: carry on moving from here, without a jump.
      if (e.touches.length === 1 && stage.place) {
        s.x = e.touches[0].clientX
        s.y = e.touches[0].clientY
        const p = stage.floorPoint(s.x, s.y)
        s.start = p && { x: p.x, z: p.z }
        s.from = { x: stage.place.pos.x, z: stage.place.pos.z }
      }
      s.d0 = 0
      return
    }
    if (!stage.place && !s.moved) {
      if (stage.placeAtAim()) {
        setPhase('placed')
        // Sound only from a tap (iOS); the first drop is that tap.
        void handles.current.get(current.id)?.then((h) => h?.play())
      }
    } else if (stage.place && s.moved) {
      stage.commit()
    }
    stage.gesturing = false
  }

  // Swipe strip: left/right swaps the scene in the same spot.
  const swipe = useRef({ x: 0, t: 0 })

  function toggleSound() {
    void handles.current.get(current.id)?.then((h) => {
      if (!h) return
      h.setMuted(sound)
      void h.play()
    })
    setSound(!sound)
  }

  function replace() {
    stageRef.current?.unplace()
    setPhase('finding')
  }

  function copyReport() {
    const st = stageRef.current?.stats()
    const stage = stageRef.current
    // Video state, to see where playback gets stuck (ready 0–4, network 0–3, error code 1–4).
    const h = shown.current
    const videos = (h?.videos ?? []).map((v, i) => {
      const src = v.currentSrc.replace(location.origin, '').slice(0, 40)
      return `Video ${i + 1}: ${v.paused ? 'paused' : 'playing'} · ready ${v.readyState} · network ${v.networkState} · error ${v.error?.code ?? '-'} · at ${v.currentTime.toFixed(1)}/${(v.duration || 0).toFixed(1)} s · ${v.muted ? 'muted' : 'sound'} · ${src}`
    })
    const text = [
      'InRL floor test report',
      st && `Drawing ${st.fps} fps · ARKit frames received ${st.frames}/s · bridge delay ${st.delay} ms (worst ${st.delayMax})`,
      st && `Tracking: ${st.track} · floors found ${st.planes}`,
      stage && `Scene: ${current.title} · 1 unit = ${stage.unit.toFixed(2)} m · placed ${stage.place ? 'yes' : 'no'}`,
      ...videos,
      `Videos reloaded by the watchdog: ${retries.current}`,
      `Screen ${innerWidth}×${innerHeight} @${devicePixelRatio}x · ${navigator.userAgent}`,
    ].filter(Boolean).join('\n')
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const hint = phase === 'finding'
      ? 'Move your phone slowly to find the floor'
      : phase === 'aiming'
        ? 'Tap to drop your scene here'
        : ''

  return (
    <div className="floor" data-phase={phase}>
      <div
        ref={hostRef}
        className="look-stage"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      />

      {stats && (
        <p className="look-fps floor-readout" aria-live="off">
          <strong className={stats.fps >= 50 ? 'ok' : stats.fps >= 30 ? 'meh' : 'bad'}>{stats.fps}</strong> fps · ARKit {stats.frames} · delay {stats.delay} ms
          {stats.track !== 'normal' && <> · {stats.track}</>}
        </p>
      )}
      <div className="studio-lock floor-tools">
        {phase === 'placed' && <button className="look-chip" onClick={replace}>Place again</button>}
        <button className="look-chip" onClick={copyReport}>{copied ? 'Copied' : 'Copy report'}</button>
        <button className="look-chip" onClick={() => { post({ type: 'reset' }); replace() }}>Restart</button>
        {list.length === 1 && <button className="look-chip" onClick={() => post({ type: 'paste' })}>Use my scenes</button>}
      </div>

      {hint && <p className="look-hint">{hint}</p>}
      {notice && <button className="look-chip floor-notice" onClick={() => setNotice('')}>{notice}</button>}

      {hasVideo && phase === 'placed' && (
        <button className="studio-sound floor-sound" aria-label={sound ? 'Sound off' : 'Sound on'} onClick={toggleSound}>
          {sound ? <SoundOnIcon color="#fff" /> : <SoundOffIcon color="#fff" />}
        </button>
      )}

      <div
        className="floor-strip"
        onTouchStart={(e) => {
          swipe.current = { x: e.touches[0].clientX, t: performance.now() }
        }}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - swipe.current.x
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1)
        }}
      >
        {list.length > 1 && (
          <button className="floor-thumb is-side" aria-label="Previous scene" onClick={() => go(-1)}>
            <Thumb entry={list[(index - 1 + list.length) % list.length]} />
          </button>
        )}
        <div className="floor-thumb is-current" data-loading={loading}>
          <Thumb entry={current} />
          <span className="floor-title">{current.title}</span>
        </div>
        {list.length > 1 && (
          <button className="floor-thumb is-side" aria-label="Next scene" onClick={() => go(1)}>
            <Thumb entry={list[(index + 1) % list.length]} />
          </button>
        )}
      </div>
    </div>
  )
}

function Thumb({ entry }: { entry: Entry }) {
  return entry.thumb ? <img src={entry.thumb} alt="" /> : <span className="floor-thumb-blank">{entry.title.slice(0, 1)}</span>
}
