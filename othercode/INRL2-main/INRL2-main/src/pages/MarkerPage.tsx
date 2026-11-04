import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BackIcon } from '../components/Icons'
import './MarkerPage.css'

/**
 * Printable marker. Printed, it should measure 15 cm across. Without
 * ?code= it is the step-1 test marker; with ?code=<marker code> a person's
 * own marker (the fallback when the iPhone share sheet isn't available).
 */
export default function MarkerPage() {
  const [params] = useSearchParams()
  const code = params.get('code')
  const [image, setImage] = useState(code ? '' : '/test/marker.png')
  const [title, setTitle] = useState(code ? 'Marker' : 'Test marker')

  useEffect(() => {
    if (!code) return
    fetch(`/api/m/${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((p: { marker: { image: string }; owner: { username: string } | null }) => {
        setImage(p.marker.image)
        if (p.owner) setTitle(`@${p.owner.username}’s marker`)
      })
      .catch(() => setTitle('Marker not found'))
  }, [code])

  return (
    <div className="mk">
      <header className="mk-top no-print">
        <Link to={code ? '/me?tab=marker' : '/'} aria-label="Back"><BackIcon /></Link>
        <h1 className="t-heading-18">{title}</h1>
        <span />
      </header>
      {image && <img className="mk-img" src={image} alt={title} />}
      <div className="mk-help no-print">
        <p className="t-body-14">
          Print this page at 100% scale (no "fit to page"). The marker should measure about 15 cm across.
          Matte paper works best; glossy paper reflects light and makes tracking harder.
        </p>
        <p className="t-body-14">
          No printer? Show it full screen on a laptop or tablet instead. Turn the screen brightness up.
        </p>
        <button className="btn btn-primary" onClick={() => print()}>Print</button>
        {image && <a className="btn btn-secondary" href={image} target="_blank" rel="noreferrer">Open image full screen</a>}
      </div>
    </div>
  )
}
