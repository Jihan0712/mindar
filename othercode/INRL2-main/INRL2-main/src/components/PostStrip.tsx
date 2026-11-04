import { useEffect, useRef, useState } from 'react'

export interface StripPost {
  id: string
  thumb?: string | null
  caption?: string
}

/**
 * The strip of round post thumbnails at the bottom of a post (Figma C3 / A2 /
 * A4), in IN3D and INRL. A scrolling carousel: it moves with the finger
 * (with momentum) and snaps a thumbnail into the middle; when it settles
 * there, `onPick` gets that post. Tapping a thumbnail scrolls it to the
 * middle. Styles: `.pv-strip` in PostView.css.
 */
export function PostStrip({ list, at, smooth, onPick }: { list: StripPost[]; at: number; smooth: boolean; onPick: (i: number) => void }) {
  const stripRef = useRef<HTMLDivElement>(null)
  const [centre, setCentre] = useState(at)
  const pick = useRef(onPick)
  pick.current = onPick

  const centred = () => {
    const el = stripRef.current
    if (!el) return -1
    const mid = el.scrollLeft + el.clientWidth / 2
    let best = -1
    let gap = Infinity
    el.querySelectorAll<HTMLElement>('button').forEach((b, i) => {
      const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - mid)
      if (d < gap) {
        gap = d
        best = i
      }
    })
    return best
  }
  const scrollTo = (i: number, animate = true) => {
    const el = stripRef.current
    const b = el?.querySelectorAll<HTMLElement>('button')[i]
    if (el && b) el.scrollTo({ left: b.offsetLeft + b.offsetWidth / 2 - el.clientWidth / 2, behavior: animate ? 'smooth' : 'instant' })
  }
  // Opening a post: its thumbnail in the middle straight away.
  useEffect(() => {
    if (at >= 0 && centred() !== at) scrollTo(at, centre !== -1 && centre !== at && smooth)
    setCentre(at)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at])
  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    let t = 0
    const settle = () => {
      const i = centred()
      if (i >= 0 && list[i] && i !== at) pick.current(i)
    }
    const onScroll = () => {
      setCentre(centred())
      clearTimeout(t)
      t = window.setTimeout(settle, 140)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(t)
      el.removeEventListener('scroll', onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, list.length])

  return (
    <div ref={stripRef} className="pv-strip">
      {list.map((p, i) => (
        <button key={p.id} className={i === centre ? 'is-active' : ''} data-id={p.id} aria-label={p.caption || `Post ${i + 1}`} onClick={() => scrollTo(i)}>
          <span>{p.thumb ? <img src={p.thumb} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : null}</span>
        </button>
      ))}
    </div>
  )
}
