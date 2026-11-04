import { useState } from 'react'
import { markTutorialSeen } from '../studio/tutorial'
import './StudioTutorial.css'

/*
 * The InStudio tutorial (Figma tutorial-0001 to 0008): welcome cards, then
 * coach marks pointing at the real controls. Shown automatically the first
 * time InStudio opens, and again from the "?" button. Text follows what the
 * editor does today (Nico's gestures), not the original Figma copy where
 * they differ; the music tip is left out (music is not in step 2).
 */

/** Small drawings of the gestures (Figma had grey placeholder circles). */
function Gesture({ kind }: { kind: 'swipe' | 'pinch' | 'pan' | 'double' | 'tap' | 'twist' }) {
  const finger = (x: number, y: number) => <circle cx={x} cy={y} r="7" fill="var(--teal-500)" opacity="0.9" />
  const arrow = (d: string) => <path d={d} fill="none" stroke="var(--ink-700)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="31" fill="var(--surface-cool)" />
      {kind === 'swipe' && <>{finger(22, 34)}{arrow('M30 34h16m-5-5 5 5-5 5')}{arrow('M18 24c6-6 22-6 28 0')}</>}
      {kind === 'pinch' && <>{finger(22, 42)}{finger(42, 22)}{arrow('M17 47l-6 6m0-6v6h6')}{arrow('M47 17l6-6m0 6v-6h-6')}</>}
      {kind === 'pan' && <>{finger(25, 38)}{finger(39, 38)}{arrow('M25 28V14m-4 4 4-4 4 4')}{arrow('M39 28V14m-4 4 4-4 4 4')}</>}
      {kind === 'double' && <>{finger(32, 34)}<circle cx="32" cy="34" r="13" fill="none" stroke="var(--ink-700)" strokeWidth="2" /><circle cx="32" cy="34" r="19" fill="none" stroke="var(--ink-400)" strokeWidth="2" /></>}
      {kind === 'tap' && <>{finger(32, 34)}<circle cx="32" cy="34" r="14" fill="none" stroke="var(--teal-500)" strokeWidth="2.5" /></>}
      {kind === 'twist' && <>{finger(24, 40)}{finger(40, 24)}{arrow('M14 30a18 18 0 0 1 16-16m-4-3 4 3-3 4')}{arrow('M50 34a18 18 0 0 1-16 16m4 3-4-3 3-4')}</>}
    </svg>
  )
}

interface Card {
  title: string
  rows?: { g: Parameters<typeof Gesture>[0]['kind']; text: React.ReactNode }[]
  body?: React.ReactNode
  art?: boolean
}

const CARDS: Card[] = [
  {
    title: 'Welcome to Your InStudio',
    art: true,
    body: 'Build your own 3D scene with objects, 3D text, photos, videos and GIFs, then bring it to life on your marker.',
  },
  {
    title: 'Navigating InStudio',
    rows: [
      { g: 'swipe', text: <>Swipe one finger across the screen to <b>rotate</b> the view around your scene.</> },
      { g: 'pinch', text: <>Pinch two fingers together to zoom out, and spread them apart to <b>zoom</b> in.</> },
    ],
  },
  {
    title: 'Navigating InStudio',
    rows: [
      { g: 'pan', text: <>Place two fingers on the screen and move them together to <b>pan the view</b> up, down, left or right.</> },
      { g: 'double', text: <>Double tap the screen to return to the <b>default view</b>.</> },
    ],
  },
  {
    title: 'Moving Objects',
    rows: [
      { g: 'tap', text: <><b>Tap an object</b> to select it: it glows teal. One finger then moves it left, right, up and down.</> },
      { g: 'twist', text: <>Two fingers: slide up to <b>push it back</b>, pinch to <b>resize</b>, twist to <b>turn</b>. Tap empty space when you're done.</> },
    ],
  },
]

interface Tip {
  /** CSS selector of the control the bubble points at; none = the workspace in the middle. */
  target?: string
  text: React.ReactNode
}

const TIPS: Tip[] = [
  { text: <>This is your <b>workspace</b>. You can place up to <b>6 objects</b> per post. The glowing square is <b>your marker</b>.</> },
  { target: '.studio-fab', text: <><b>Tap</b> the action button to show the studio tools.</> },
  { target: '.studio-pill:not(.studio-help)', text: <>Change the <b>background</b> colour of your scene here.</> },
  { target: '.studio-history', text: <><b>Undo</b> or <b>redo</b> any change here.</> },
  { target: '.studio-icon[aria-label="Preview on your marker"]', text: <>Press the <b>arrow</b> to see your scene on your marker.</> },
  { target: '.studio-help', text: <>Tap <b>?</b> any time to see this guide again.</> },
]

const ART = ['heart-buddy', 'chrome-blob', 'text-candy', 'soft-tv', 'sticker-1f525', 'cloud-buddy']

export default function StudioTutorial({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0) // cards first, then tips
  const card = step < CARDS.length ? CARDS[step] : null
  const tip = card ? null : TIPS[step - CARDS.length]
  // Where the pointed-at control is on screen (the editor is already laid out).
  const box = tip?.target ? (document.querySelector(tip.target)?.getBoundingClientRect() ?? null) : null

  function finish() {
    markTutorialSeen()
    onDone()
  }
  const next = () => (step + 1 >= CARDS.length + TIPS.length ? finish() : setStep(step + 1))

  if (card) {
    const last = step === CARDS.length - 1
    return (
      <div className="tut-bg" role="dialog" aria-modal="true" aria-label={card.title}>
        <div className="tut-card">
          <div className="tut-dots" aria-hidden="true">
            {CARDS.map((_, i) => <span key={i} className={i === step ? 'is-on' : ''} />)}
          </div>
          {card.art && (
            <div className="tut-art" aria-hidden="true">
              {ART.map((id, i) => <img key={id} src={`/studio/thumbs/${id}.png`} alt="" style={{ ['--i' as string]: i }} />)}
            </div>
          )}
          <h2 className="t-heading-22">{card.title}</h2>
          {card.body && <p className="t-body-14 tut-body">{card.body}</p>}
          {card.rows && (
            <div className="tut-rows">
              {card.rows.map((r, i) => (
                <div key={i} className="tut-row">
                  <Gesture kind={r.g} />
                  <p className="t-body-14">{r.text}</p>
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-primary tut-main" onClick={next}>{last ? "Let's Go!" : 'Continue'}</button>
          <button className="tut-link" onClick={last ? () => setStep(0) : finish}>{last ? 'Start Over' : 'Skip'}</button>
        </div>
      </div>
    )
  }

  // Coach mark: dark veil, a bubble pointing at the control (or the middle).
  const below = box ? box.top < innerHeight / 2 : false
  const style: React.CSSProperties = box
    ? below
      ? { top: box.bottom + 14, left: clampX(box.left + box.width / 2) }
      : { top: box.top - 14, left: clampX(box.left + box.width / 2), transform: 'translate(-50%, -100%)' }
    : { top: '46%', left: '50%', transform: 'translate(-50%, -100%)' }
  const arrowX = box ? box.left + box.width / 2 - clampX(box.left + box.width / 2) : 0
  return (
    <div className="tut-veil" role="dialog" aria-modal="true" aria-label="Tip" onClick={next}>
      {box && <span className="tut-ring" style={{ top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12 }} />}
      <div className={`tut-bubble ${box ? (below ? 'is-below' : 'is-above') : 'is-above'}`} style={style}>
        <p className="t-body-14">{tip!.text}</p>
        {/* Inside the bubble, so it can't collide with it on any screen size. */}
        <p className="t-label-12 tut-skip">
          Tap anywhere to continue · <button onClick={(e) => (e.stopPropagation(), finish())}>Skip tips</button>
        </p>
        <span className="tut-point" style={{ left: `calc(50% + ${arrowX}px)` }} />
      </div>
    </div>
  )
}

/** Keeps a 240-px bubble centred on x inside the screen (16 px margins). */
function clampX(x: number) {
  return Math.min(Math.max(x, 16 + 120), innerWidth - 16 - 120)
}
