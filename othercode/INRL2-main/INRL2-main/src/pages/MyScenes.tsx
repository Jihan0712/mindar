import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createScene, getThumb, listScenes, sceneName, onScenesChange, thumbsVersion, type SceneMeta } from '../studio/scenes'
import { fetchCloudList, flushDeletes, phoneKey, removeScene, syncAll } from '../studio/cloud'
import { appLink } from '../floor/bridge'
import { AvatarIcon, BackIcon, CloudIcon, CloudOffIcon, PlusIcon, TrashIcon } from '../components/Icons'
import './Studio.css'
import './MyScenes.css'

/*
 * My scenes (InStudio piece 5): start a new scene, reopen or delete one.
 * Each card shows the scene's picture, how many objects it has, when it
 * changed and whether it is safely in the cloud. No Figma screen for this
 * yet; it follows the profile's object grid and the design system.
 */

let cache: { list: SceneMeta[]; key: string } = { list: [], key: '' }
function snapshot() {
  const list = listScenes()
  const key = JSON.stringify(list) + thumbsVersion()
  if (key !== cache.key) cache = { list, key }
  return cache.list
}

const minute = 60_000
function ago(t: number) {
  const d = Date.now() - t
  if (d < minute) return 'just now'
  if (d < 60 * minute) return `${Math.floor(d / minute)} min ago`
  if (d < 24 * 60 * minute) return `${Math.floor(d / (60 * minute))} h ago`
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

const nameOf = sceneName

function CloudState({ m }: { m: SceneMeta }) {
  if (m.cloud === 'saved') return <span className="scenes-cloud is-saved"><CloudIcon size={14} />Saved</span>
  if (m.cloud === 'pending') return <span className="scenes-cloud is-pending"><CloudIcon size={14} />Saving…</span>
  return <span className="scenes-cloud is-error"><CloudOffIcon size={14} />On this phone</span>
}

export default function MyScenes() {
  const navigate = useNavigate()
  const scenes = useSyncExternalStore(onScenesChange, snapshot)
  // Delete at once, with a few seconds to undo (like objects in the editor).
  const [deleting, setDeleting] = useState<SceneMeta | null>(null)
  const shown = scenes.filter((m) => m.id !== deleting?.id)

  // Catch up with the cloud: deletes and saves that didn't get through, and scenes only the cloud has.
  useEffect(() => {
    void flushDeletes()
      .then(syncAll)
      .then(fetchCloudList)
      .catch(() => {})
  }, [])

  // The delete happens when the toast goes: after 5 s, on the next delete,
  // or on leaving the screen. Undo is the only way out.
  const undone = useRef<string | null>(null)
  useEffect(() => {
    if (!deleting) return
    const t = setTimeout(() => setDeleting(null), 5000)
    return () => {
      clearTimeout(t)
      if (undone.current !== deleting.id) void removeScene(deleting.id)
    }
  }, [deleting])

  function undo() {
    undone.current = deleting?.id ?? null
    setDeleting(null)
  }

  const edit = (id: string) => `/studio/edit/${id}${location.search}`

  return (
    <main className="scenes">
      <header className="scenes-top">
        <button className="scenes-icon" aria-label="Back" onClick={() => (history.length > 1 ? navigate(-1) : navigate('/me'))}><BackIcon /></button>
        <h1 className="t-heading-22">My scenes</h1>
        <Link to="/me" className="scenes-icon" aria-label="Your profile and marker"><AvatarIcon size={24} /></Link>
      </header>

      <div className="scenes-grid">
        <button className="scenes-new" onClick={() => navigate(edit(createScene().id))}>
          <span className="scenes-plus"><PlusIcon size={30} color="var(--teal-500)" /></span>
          <span className="t-body-14-medium">New scene</span>
        </button>
        {shown.map((m) => (
          <article key={m.id} className="scenes-card" data-id={m.id} data-cloud={m.cloud}>
            <Link to={edit(m.id)} className="scenes-open" aria-label={`Open ${nameOf(m)}`}>
              <Thumb m={m} />
            </Link>
            <div className="scenes-info">
              <div>
                <h2 className="t-label-12-medium">{nameOf(m)}</h2>
                <p className="t-caption-10">{m.objects} object{m.objects === 1 ? '' : 's'} · {ago(m.updated)}</p>
                <CloudState m={m} />
              </div>
              <button className="scenes-del" aria-label={`Delete ${nameOf(m)}`} onClick={() => ((undone.current = null), setDeleting(m))}><TrashIcon size={18} /></button>
            </div>
          </article>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="t-body-14 scenes-empty">Your scenes appear here. Each one is saved on this phone and in the cloud as you edit.</p>
      )}

      {/* iPhone floor test (temporary): hands this phone's scenes to the InRL Floor test app. */}
      {shown.length > 0 && /iPhone/.test(navigator.userAgent) && (
        <a className="t-body-14 scenes-floor" href={appLink(phoneKey())}>See them on the floor (iPhone test app) →</a>
      )}

      {deleting && (
        <div className="studio-toast scenes-toast" role="status">
          <span>Scene deleted</span>
          <button onClick={undo}>Undo</button>
        </div>
      )}
    </main>
  )
}

function Thumb({ m }: { m: SceneMeta }) {
  const src = getThumb(m.id)
  return (
    <span className="scenes-thumb" style={{ background: m.background }}>
      {src ? <img src={src} alt="" /> : <span className="t-caption-10">{m.remote ? 'In the cloud' : 'Empty'}</span>}
    </span>
  )
}
