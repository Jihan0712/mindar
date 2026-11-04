import { useEffect, useState } from 'react'
import type { SceneHandle } from '../scene/buildScene'

export interface DebugStats {
  fps: number
  /** Time from tapping "Open camera" to the camera running. */
  startMs: number
  /** Time from the tap to the marker first being recognised. */
  firstFoundMs: number | null
  /** How many times tracking was lost after being found. */
  losses: number
  /** Whether the scene stands on the marker or upright in front of it. */
  placement: 'flat' | 'vertical'
  /** Marker tilt from horizontal: 0 = lying flat, 90 = upright. */
  tiltDeg: number | null
  /** Motion sensor permission. */
  sensor: string
}

function mediaState(m: HTMLMediaElement | null | undefined) {
  if (!m) return 'none'
  if (m.error) return `error ${m.error.code}`
  return `${m.paused ? 'paused' : 'playing'} ${m.currentTime.toFixed(1)}s${m.muted ? ' (muted)' : ''}`
}

/** Test readout. "Copy report" gives a text block to paste back to Claude. */
export function DebugPanel({ stats, phase, getScene, onClose }: { stats: DebugStats; phase: string; getScene: () => SceneHandle | null; onClose: () => void }) {
  const [, tick] = useState(0)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [])

  const scene = getScene()
  const rows: [string, string][] = [
    ['State', phase],
    ['Frame rate', `${stats.fps} fps`],
    ['Camera start', stats.startMs ? `${(stats.startMs / 1000).toFixed(1)} s` : '-'],
    ['First recognised', stats.firstFoundMs !== null ? `${(stats.firstFoundMs / 1000).toFixed(1)} s` : '-'],
    ['Times lost', String(stats.losses)],
    ['Marker', `${stats.placement}${stats.tiltDeg !== null ? ` (tilted ${stats.tiltDeg}°)` : ''}`],
    ['Motion sensor', stats.sensor],
    ['Video', mediaState(scene?.videos[0])],
    ['Music', mediaState(scene?.music)],
    ['Screen', `${innerWidth}×${innerHeight} @${devicePixelRatio}x`],
    ['Device', navigator.userAgent],
  ]
  const report = rows.map(([k, v]) => `${k}: ${v}`).join('\n')

  return (
    <div className="ar-debug">
      <div className="ar-debug-head">
        <strong className="t-body-14-bold">Test details</strong>
        <button onClick={onClose} aria-label="Close">✕</button>
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      <button
        className="btn btn-primary"
        onClick={() => navigator.clipboard?.writeText(report).then(() => setCopied(true))}
      >
        {copied ? 'Copied' : 'Copy report'}
      </button>
    </div>
  )
}
