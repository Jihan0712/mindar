import './Avatar.css'

/** A person's round picture, or the first letter of their name when they have none. */
export function Avatar({ name, src, size = 32, className = '' }: { name: string; src?: string | null; size?: number; className?: string }) {
  return (
    <span className={`avatar ${className}`} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {src ? <img src={src} alt="" /> : name.trim().slice(0, 1).toUpperCase() || '?'}
    </span>
  )
}
