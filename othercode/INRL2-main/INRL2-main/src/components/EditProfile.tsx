import { useEffect, useRef, useState } from 'react'
import { updateAvatar, updateProfile, type Account } from '../account/account'
import { Avatar } from './Avatar'
import { CameraIcon, CloseIcon } from './Icons'
import './EditProfile.css'

/*
 * Edit Profile (step 5, decision 2026-10-07; Figma F25's picture circle):
 * a profile picture chosen from the phone and placed in a circle (drag to
 * move, pinch or the slider to zoom), the name and a short bio.
 */

const BIO_MAX = 150
const OUT = 400 // the saved picture, square JPEG
const VIEW = 240 // the circle on screen

interface Placing {
  url: string
  w: number
  h: number
  x: number
  y: number
  zoom: number
}

export function EditProfile({ account, onClose }: { account: Account; onClose: () => void }) {
  const [name, setName] = useState(account.name)
  const [bio, setBio] = useState(account.bio ?? '')
  const [placing, setPlacing] = useState<Placing | null>(null)
  const [removed, setRemoved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const url = placing?.url
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
    },
    [url],
  )

  function pick(f: File | undefined) {
    if (!f) return
    const url = URL.createObjectURL(f)
    const img = new Image()
    img.onload = () => setPlacing({ url, w: img.naturalWidth, h: img.naturalHeight, x: 0, y: 0, zoom: 1 })
    img.onerror = () => setError('This picture can’t be opened. Try another one.')
    img.src = url
    setRemoved(false)
  }

  // The picture covers the circle at zoom 1; x / y move its centre (in circle pixels).
  const base = placing ? Math.max(VIEW / placing.w, VIEW / placing.h) : 1
  const clampXY = (p: Placing, x: number, y: number) => {
    const s = base * p.zoom
    const mx = Math.max(0, (p.w * s - VIEW) / 2)
    const my = Math.max(0, (p.h * s - VIEW) / 2)
    return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) }
  }

  // Drag with one finger, pinch with two.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const start = useRef<{ x: number; y: number; zoom: number; d: number; px: number; py: number } | null>(null)
  const begin = () => {
    const pts = [...pointers.current.values()]
    if (!placing || !pts.length) return
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length
    const d = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0
    start.current = { x: placing.x, y: placing.y, zoom: placing.zoom, d, px: cx, py: cy }
  }
  function onDown(e: React.PointerEvent) {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    begin()
  }
  function onMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId) || !placing || !start.current) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length
    const s0 = start.current
    const zoom = pts.length > 1 && s0.d ? Math.min(4, Math.max(1, (s0.zoom * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) / s0.d)) : placing.zoom
    const next = { ...placing, zoom }
    setPlacing({ ...next, ...clampXY(next, s0.x + cx - s0.px, s0.y + cy - s0.py) })
  }
  function onUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    begin()
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      if (placing && imgRef.current) {
        const c = document.createElement('canvas')
        c.width = c.height = OUT
        const k = OUT / VIEW
        const s = base * placing.zoom * k
        const ctx = c.getContext('2d')!
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, OUT, OUT)
        ctx.drawImage(imgRef.current, OUT / 2 + placing.x * k - (placing.w * s) / 2, OUT / 2 + placing.y * k - (placing.h * s) / 2, placing.w * s, placing.h * s)
        const blob = await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('Could not save the picture.'))), 'image/jpeg', 0.85))
        await updateAvatar(blob)
      } else if (removed) await updateAvatar(null)
      if (name.trim() !== account.name || bio.trim() !== (account.bio ?? '')) await updateProfile({ name: name.trim(), bio: bio.trim() })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const s = base * (placing?.zoom ?? 1)
  return (
    <div className="pf-veil" onClick={onClose}>
      <div className="pf-sheet ep" role="dialog" aria-label="Edit Profile" onClick={(e) => e.stopPropagation()}>
        <button className="pf-close" aria-label="Close" onClick={onClose}><CloseIcon size={14} /></button>
        <h2 className="t-heading-22">Edit Profile</h2>

        {placing ? (
          <>
            <div className="ep-crop" style={{ width: VIEW, height: VIEW }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              <img
                ref={imgRef}
                src={placing.url}
                alt=""
                draggable={false}
                style={{ width: placing.w * s, height: placing.h * s, transform: `translate(${placing.x - (placing.w * s - VIEW) / 2}px, ${placing.y - (placing.h * s - VIEW) / 2}px)` }}
              />
            </div>
            <input
              className="ep-zoom"
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={placing.zoom}
              aria-label="Zoom"
              onChange={(e) => {
                const next = { ...placing, zoom: Number(e.target.value) }
                setPlacing({ ...next, ...clampXY(next, placing.x, placing.y) })
              }}
            />
            <p className="t-label-12 ep-muted">Drag to move, pinch or slide to zoom.</p>
          </>
        ) : (
          <button className="ep-pick" onClick={() => file.current?.click()} aria-label="Add a profile picture">
            {account.avatar && !removed ? <Avatar name={account.name || account.username} src={account.avatar} size={96} /> : <span className="ep-empty"><CameraIcon size={36} color="var(--ink-500)" /></span>}
          </button>
        )}
        <div className="ep-links">
          <button className="t-label-12-medium" onClick={() => file.current?.click()}>{account.avatar || placing ? 'Choose another picture' : 'Add a Profile Picture'}</button>
          {(account.avatar || placing) && !removed && (
            <button className="t-label-12-medium" onClick={() => (setPlacing(null), setRemoved(true))}>Remove</button>
          )}
        </div>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />

        <input className="ep-input" name="name" placeholder="Full Name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <label className="ep-bio">
          <textarea name="bio" placeholder="A few words about you" maxLength={BIO_MAX} rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
          <span className="t-caption-10">{bio.length}/{BIO_MAX}</span>
        </label>
        {error && <p className="t-label-12 pf-error" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}
