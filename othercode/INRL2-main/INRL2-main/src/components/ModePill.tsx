import './ModePill.css'

export type ViewMode = 'INART' | 'IN3D' | 'INRL'

/**
 * The view switch at the top of a post. Posts open in IN3D and offer IN3D /
 * INRL (decision 2026-10-07: the feed's pictures are INART); `modes` can
 * still list all three.
 */
export function ModePill({ active, onChange, modes = ['IN3D', 'INRL'] }: { active: ViewMode; onChange?: (m: ViewMode) => void; modes?: ViewMode[] }) {
  return (
    <div className="mode-pill" role="tablist">
      {modes.map((m) => (
        <button key={m} role="tab" aria-selected={m === active} className={m === active ? 'is-active' : ''} onClick={() => onChange?.(m)}>
          {m}
        </button>
      ))}
    </div>
  )
}
