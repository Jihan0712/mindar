import { useEffect } from 'react'

/** "Published Successfully" (Figma E19r3, B15r2): a card with a teal tick over the blurred screen, gone after a moment. */
export function Published({ onDone, after = 1600 }: { onDone: () => void; after?: number }) {
  useEffect(() => {
    const t = setTimeout(onDone, after)
    return () => clearTimeout(t)
  }, [onDone, after])
  return (
    <div className="published" role="status" onClick={onDone}>
      <div className="published-card">
        <svg viewBox="0 0 80 80" width="80" height="80" aria-hidden="true">
          <circle cx="40" cy="40" r="37" fill="none" stroke="var(--teal-500)" strokeWidth="3" />
          <path d="M20 41l11 10 23-30" fill="none" stroke="var(--teal-500)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="t-heading-16">Published<br />Successfully</p>
      </div>
    </div>
  )
}
