import { useRef } from 'react'
import type { FloorStage } from './FloorStage'

/*
 * Fingers on a scene standing on a real surface (same as the floor test):
 * a tap drops it on the aim mark; once placed, one finger slides it across
 * the surface, two fingers pinch to resize and twist to turn it. Lifting one
 * of two fingers carries on moving from there, without a jump. On a marker
 * the scene stays where the marker is: no gestures.
 */
export function useSurfaceGestures(stageRef: { current: FloorStage | null }, onPlaced: () => void) {
  const g = useRef({ moved: false, x: 0, y: 0, start: null as null | { x: number; z: number }, from: null as null | { x: number; z: number }, d0: 0, a0: 0, unit0: 0, yaw0: 0 })

  function twoFinger(t: React.TouchList) {
    const dx = t[1].clientX - t[0].clientX
    const dy = t[1].clientY - t[0].clientY
    return { d: Math.hypot(dx, dy), a: Math.atan2(dy, dx) }
  }

  function grab(stage: FloorStage, x: number, y: number) {
    const s = g.current
    s.x = x
    s.y = y
    const p = stage.floorPoint(x, y)
    s.start = p && { x: p.x, z: p.z }
    s.from = stage.place && { x: stage.place.pos.x, z: stage.place.pos.z }
  }

  function onTouchStart(e: React.TouchEvent) {
    const stage = stageRef.current
    if (!stage || stage.marker?.found) return
    const s = g.current
    if (e.touches.length === 1) {
      s.moved = false
      grab(stage, e.touches[0].clientX, e.touches[0].clientY)
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
    if (!stage?.place || stage.marker?.found) return
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
    if (!stage || stage.marker?.found) return
    const s = g.current
    if (e.touches.length > 0) {
      if (e.touches.length === 1 && stage.place) grab(stage, e.touches[0].clientX, e.touches[0].clientY)
      s.d0 = 0
      return
    }
    if (!stage.place && !s.moved) {
      if (stage.placeAtAim()) onPlaced()
    } else if (stage.place && s.moved) {
      stage.commit()
    }
    stage.gesturing = false
  }

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd }
}
