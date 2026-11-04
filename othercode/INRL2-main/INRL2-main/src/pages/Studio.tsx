import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { postPictureKey } from '../account/publish'
import { MAX_OBJECTS, sceneObjectSchema, type Scene, type SceneObject } from '../scene/schema'
import { deleteScene, getThumb, loadScene, newId, saveScene, saveThumb, sceneMeta, usedMediaIds } from '../studio/scenes'
import { fetchScene, syncScene } from '../studio/cloud'
import { EditorStage } from '../studio/EditorStage'
import { AREA, freeSpot } from '../studio/gestures'
import { MOTION_LABELS, MOTIONS, type Motion } from '../studio/motions'
import { libraryItem, LIBRARY, MAX_TEXT_CHARS, STYLES, TEXT_STYLE_IDS, TEXT_STYLES, type ItemType, type TextStyle } from '../studio/library'
import { cleanUpMedia, forgetLocalMedia, importMedia, isMediaSrc, mediaInfo, mediaSrc, mediaUrl, type MediaKind } from '../studio/media'
import { faceAspect, formatOf, MAX_GIFS, MAX_VIDEOS, mediaPosition, mediaWidth, SCREENS_FOR } from '../studio/placeMedia'
import type { Gif, GifPage } from '../../worker/giphy'
import { SCREEN_LABELS, type MediaDisplay, type ScreenType } from '../studio/screens'
import {
  AlertIcon, ArrowRightIcon, BackIcon, AvatarIcon, CloseIcon, CubeIcon, EditIcon, GifIcon, MediaIcon, MotionIcon, PlusIcon, SoundOffIcon, SoundOnIcon, StickerIcon, TextToolIcon, TrashIcon, UndoIcon, RedoIcon, HelpIcon,
} from '../components/Icons'
import StudioTutorial from './StudioTutorial'
import { tutorialSeen } from '../studio/tutorial'
import './Studio.css'

/*
 * InStudio, the scene editor (Figma REVISED E1r2–E17r2). Step 2, pieces 1–5:
 * place objects, 3D text, stickers and the person's own photos and videos;
 * move, turn, resize and lift them; change the background; preview on the
 * marker. Opened from My scenes (/studio) as /studio/edit/<id>; every change
 * is saved on the phone at once and copied to the cloud a moment later.
 */

type Sheet = 'objects' | 'characters' | 'text' | 'stickers' | 'background' | 'place' | 'gif' | 'motion' | null

/** The photo/video being placed: from a fresh import, or an object being edited. */
interface PlaceDraft {
  src: string
  kind: MediaKind
  aspect: number
  display: MediaDisplay
  screen: ScreenType
  /** Videos: whether this one's sound plays (only one video's at a time). */
  sound: boolean
  /** A GIF from GIPHY: silent, no sound switch, its own limit. */
  gif: boolean
  editing?: string
}

const DISPLAYS: { id: MediaDisplay; label: string; hint: string }[] = [
  { id: 'screen', label: 'On a screen', hint: 'Stands in a 3D screen' },
  { id: 'floating', label: 'Floating', hint: 'A card in the air' },
  { id: 'marker', label: 'On the marker', hint: 'Lies on the print' },
]

/** Little drawings of the three choices (no Figma screens for this yet). */
function DisplayPicto({ d }: { d: MediaDisplay }) {
  const c = 'var(--ink-700)'
  return (
    <svg width="64" height="48" viewBox="0 0 64 48" fill="none" stroke={c} strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 40h52" stroke="var(--teal-500)" />
      {d === 'screen' && <><rect x="20" y="10" width="24" height="29" rx="3" fill="var(--surface-chip)" /><rect x="23" y="13" width="18" height="21" rx="1" fill="#fff" /></>}
      {d === 'floating' && <><rect x="21" y="6" width="22" height="24" rx="2" fill="#fff" /><path d="M26 36h12" strokeDasharray="2 2" /></>}
      {d === 'marker' && <><path d="M12 40l8-12h24l8 12z" fill="var(--surface-chip)" stroke="var(--teal-500)" /><path d="M20 38l5-7h14l5 7z" fill="#fff" /></>}
    </svg>
  )
}

/** Change Background palette (Figma E16r2), read off the design: 3 rows of 7. */
const BACKGROUNDS = [
  '#E1E8E9', '#CBC3E3', '#E4C8E4', '#D2C8BF', '#ECE3B8', '#D3D9B5', '#EBB5B5',
  '#717E8C', '#383832', '#36424F', '#4A84B8', '#8C878C', '#2D4D48', '#A99A8C',
  '#93E55E', '#FF6BB5', '#D5E1CE', '#FF4A12', '#FF9F0A', '#0A7CFF', '#00F0FF',
]

const thumb = (id: string) => `/studio/thumbs/${id}.png`

/** The motion an object has: its own choice, or its library item's default. */
const motionOf = (o: SceneObject): Motion => o.motion ?? (o.kind === 'item' ? libraryItem(o.item)?.motion : undefined) ?? 'none'

/**
 * New objects get the scene format's defaults filled in (e.g. videos loop),
 * exactly as a saved scene does when it is loaded. GIFs did not loop
 * because `loop` was missing until the next reload.
 */
const withDefaults = (o: unknown) => sceneObjectSchema.parse(o)

/** Finds the scene to edit: on the phone, or fetched from the cloud first. */
export default function StudioRoute() {
  const { id = '' } = useParams()
  return <SceneLoader key={id} id={id} />
}

function SceneLoader({ id }: { id: string }) {
  const [scene, setScene] = useState<Scene | null | 'loading'>(() => loadScene(id) ?? (sceneMeta(id)?.remote ? 'loading' : null))
  useEffect(() => {
    if (scene !== 'loading') return
    let live = true
    fetchScene(id).then(
      (s) => live && setScene(s),
      () => live && setScene(null),
    )
    return () => {
      live = false
    }
  }, [id, scene])
  if (scene === 'loading') {
    return (
      <div className="studio studio-loading" role="status">
        <span className="studio-spinner" />
        <p className="t-body-14-medium">Opening your scene…</p>
      </div>
    )
  }
  if (!scene) return <Navigate to={`/studio${location.search}`} replace />
  return <Studio initial={scene} />
}

function Studio({ initial }: { initial: Scene }) {
  const navigate = useNavigate()
  // Opened by Create (bottom bar): where × returns, and whether this scene was just made.
  const { from, fresh } = (useLocation().state ?? {}) as { from?: string; fresh?: boolean }
  const [framing, setFraming] = useState(false)
  const [frameBox, setFrameBox] = useState<React.CSSProperties | null>(null)
  useEffect(() => {
    if (!framing) return
    const fit = () => setFrameBox(stageRef.current?.pictureBox() ?? null)
    fit()
    addEventListener('resize', fit)
    return () => removeEventListener('resize', fit)
  }, [framing])
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<EditorStage | null>(null)
  const [scene, setSceneState] = useState<Scene>(initial)
  // The last deleted object, while its "Deleted · Undo" message shows.
  const [deleted, setDeleted] = useState<{ obj: SceneObject; index: number } | null>(null)

  /*
   * Undo / redo: every change to the scene goes through setScene(), which
   * keeps the previous versions (up to 50). A whole gesture, a motion, a
   * colour… each is one step.
   */
  const sceneRef = useRef(scene)
  const past = useRef<Scene[]>([])
  const future = useRef<Scene[]>([])
  const [history, setHistory] = useState({ undo: 0, redo: 0 })
  const syncHistory = () => setHistory({ undo: past.current.length, redo: future.current.length })
  const setScene = (fn: (s: Scene) => Scene) => {
    const prev = sceneRef.current
    const next = fn(prev)
    if (next === prev) return
    past.current.push(prev)
    if (past.current.length > 50) past.current.shift()
    future.current = []
    sceneRef.current = next
    setSceneState(next)
    syncHistory()
    setDeleted(null) // any new change ends the "Deleted · Undo" shortcut
  }
  const jump = (from: { current: Scene[] }, to: { current: Scene[] }) => {
    const target = from.current.pop()
    if (!target) return
    to.current.push(sceneRef.current)
    sceneRef.current = target
    setSceneState(target)
    syncHistory()
    setDeleted(null)
  }
  const undo = () => jump(past, future)
  const redo = () => jump(future, past)
  const [selected, setSelected] = useState<string | null>(null)
  const [tools, setTools] = useState(false)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [styleFilter, setStyleFilter] = useState<string>('all')
  const [limit, setLimit] = useState(false)
  const [textDraft, setTextDraft] = useState<{ text: string; style: TextStyle; editing?: string }>({ text: '', style: 'sharp-chrome' })
  const [busy, setBusy] = useState(false)
  const pendingSelect = useRef<string | null>(null)
  const [place, setPlace] = useState<PlaceDraft | null>(null)
  const [placePreview, setPlacePreview] = useState('')
  const [importing, setImporting] = useState('')
  const [notice, setNotice] = useState('')
  const [sound, setSound] = useState(false)
  const libraryInput = useRef<HTMLInputElement>(null)
  // The tutorial: automatically the first time, again from the "?" button.
  const [tutorial, setTutorial] = useState(() => !tutorialSeen())
  function openTutorial() {
    setTools(false)
    setSheet(null)
    setTutorial(true)
  }

  // Photos and videos no scene uses any more are removed from the phone.
  useEffect(() => {
    void cleanUpMedia(usedMediaIds())
  }, [])

  // The stage is made once; it reaches the latest updateObject through this.
  const onTransformRef = useRef<(id: string, t: SceneObject['transform']) => void>(() => {})

  useEffect(() => {
    const stage = new EditorStage(hostRef.current!, {
      onSelect: (id) => setSelected(id),
      onTransform: (id, t) => onTransformRef.current(id, t),
    })
    stageRef.current = stage
    // Hook for scripts/studio-test.mjs only.
    if (new URLSearchParams(location.search).has('test')) (window as unknown as { __studio: EditorStage }).__studio = stage
    return () => {
      stage.dispose()
      stageRef.current = null
    }
  }, [])

  // Every change goes to the 3D stage and is saved on the phone (not the
  // first showing: opening a scene doesn't change it).
  const saved = useRef(scene)
  const edited = useRef(false)
  const built = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    setBusy(true)
    built.current = stage.sync(scene).finally(() => {
      setBusy(false)
      // A just-added object is selected once it exists in 3D.
      if (pendingSelect.current && scene.objects.some((o) => o.id === pendingSelect.current)) {
        stage.select(pendingSelect.current)
        pendingSelect.current = null
      }
    })
    if (scene === saved.current) {
      // No picture yet (e.g. the scene from before My scenes existed): take one.
      if (!getThumb(scene.id)) void built.current.then(() => takeThumb())
      return
    }
    saveScene(scene)
    saved.current = scene
    edited.current = true
    // To the cloud once editing pauses for a moment, with a fresh picture.
    const t = setTimeout(() => void built.current.then(() => (takeThumb(), syncScene(scene.id))), 2500)
    return () => clearTimeout(t)
  }, [scene])

  function takeThumb() {
    const stage = stageRef.current
    if (stage) saveThumb(sceneRef.current.id, stage.snapshot())
  }

  /** → : "Frame your shot" (decision 2026-10-07): the scene as it will be posted, auto-framed, adjustable. */
  async function startFraming() {
    await built.current
    setSheet(null)
    setTools(false)
    stageRef.current?.setFraming(true)
    setFraming(true)
  }

  function stopFraming() {
    stageRef.current?.setFraming(false)
    setFraming(false)
  }

  /** Next: New Post, with the framed view as the post's picture. */
  async function toPost() {
    await built.current
    try {
      const pic = stageRef.current?.snapshot(600, 0.75)
      if (pic) sessionStorage.setItem(postPictureKey(sceneRef.current.id), pic)
      // The framed camera goes with the scene (not an undo step), so IN3D opens on the same view.
      const view = stageRef.current?.framedView()
      if (view) {
        sceneRef.current = { ...sceneRef.current, view }
        saveScene(sceneRef.current)
      }
    } catch {
      // no picture: New Post falls back to the small one
    }
    stageRef.current?.setFraming(false)
    await leave(`/studio/post/${sceneRef.current.id}${location.search}`)
  }

  /** × : back to where the editor was opened from (Create in the bottom bar), else My scenes. */
  async function close() {
    // A scene made by Create and left empty is not kept.
    if (fresh && !edited.current && !sceneRef.current.objects.length) {
      deleteScene(sceneRef.current.id)
      return navigate(from ?? '/')
    }
    await leave(from ?? `/studio${location.search}`)
  }

  /** Leaving the editor: last picture, cloud copy starts right away (it goes on in the background). */
  async function leave(to: string) {
    await built.current
    takeThumb()
    if (edited.current) void syncScene(sceneRef.current.id)
    navigate(to)
  }

  // Shift the 3D view up while a sheet covers the bottom of the screen.
  const sheetRef = useRef<HTMLElement>(null)
  useEffect(() => {
    stageRef.current?.setBottomInset(sheet ? (sheetRef.current?.offsetHeight ?? 0) : 0)
  }, [sheet, styleFilter, place?.display])

  useEffect(() => {
    if (!place) return
    let live = true
    void mediaUrl(place.src).then((u) => live && setPlacePreview(u), () => {})
    return () => {
      live = false
    }
  }, [place])

  const videoCount = scene.objects.filter((o) => o.kind === 'video' && !o.gif).length
  const gifCount = scene.objects.filter((o) => o.kind === 'video' && o.gif).length

  // GIF search (Figma has no screen for it; the GIPHY sheet follows the library sheet).
  const [gifQuery, setGifQuery] = useState('')
  const [gifs, setGifs] = useState<Gif[]>([])
  const [gifNext, setGifNext] = useState<number | null>(null)
  const [gifState, setGifState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [gifError, setGifError] = useState('')
  const gifReq = useRef(0)
  async function loadGifs(q: string, offset = 0) {
    const req = ++gifReq.current
    setGifState('loading')
    try {
      const res = await fetch(`/api/giphy?${new URLSearchParams({ q, offset: String(offset) })}`)
      const body = (await res.json()) as GifPage & { error?: string }
      if (req !== gifReq.current) return
      if (!res.ok) throw new Error(body.error ?? `GIF search failed (${res.status})`)
      setGifs((g) => (offset ? [...g, ...body.gifs] : body.gifs))
      setGifNext(body.next)
      setGifState('idle')
    } catch (e) {
      if (req !== gifReq.current) return
      setGifError(e instanceof Error ? e.message : String(e))
      setGifState('error')
    }
  }
  // Typing searches after a short pause; an empty box shows trending GIFs.
  useEffect(() => {
    if (sheet !== 'gif') return
    const id = setTimeout(() => void loadGifs(gifQuery.trim()), gifQuery ? 400 : 0)
    return () => clearTimeout(id)
  }, [gifQuery, sheet])

  function openGifs() {
    setTools(false)
    if (full) return setLimit(true)
    if (gifCount >= MAX_GIFS) return setNotice(`A post holds up to ${MAX_GIFS} GIFs for now, so it stays smooth.`)
    setSheet('gif')
  }

  function pickGif(g: Gif) {
    const aspect = g.width / g.height
    setPlace({ src: g.mp4, kind: 'video', aspect, display: 'screen', screen: SCREENS_FOR[formatOf(aspect)][0], sound: false, gif: true })
    setSheet('place')
  }
  const count = scene.objects.length
  const full = count >= MAX_OBJECTS
  const selectedObj = scene.objects.find((o) => o.id === selected)

  function updateObject(id: string, patch: Partial<SceneObject>) {
    setScene((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as SceneObject) : o)) }))
  }
  useEffect(() => {
    onTransformRef.current = (id, t) => updateObject(id, { transform: t })
  })


  function add(obj: Omit<SceneObject, 'id' | 'transform'>) {
    if (full) {
      setLimit(true)
      return
    }
    const [x, z] = freeSpot(scene.objects.map((o) => [o.transform.position[0], o.transform.position[2]]))
    const id = newId()
    // Library pieces are made small; start them at a size that reads in the workspace.
    const scale = obj.kind === 'text' ? 1 : 1.5
    const next = withDefaults({ ...obj, id, transform: { position: [x, 0, z], rotation: [0, 0, 0], scale } })
    pendingSelect.current = id
    setScene((sc) => ({ ...sc, objects: [...sc.objects, next] }))
  }

  function duplicate(obj: SceneObject) {
    const { id: _id, transform, ...rest } = obj
    void _id
    if (full) {
      setLimit(true)
      return
    }
    if (obj.kind === 'video' && (obj.gif ? gifCount >= MAX_GIFS : videoCount >= MAX_VIDEOS)) {
      setNotice(`A post holds up to ${MAX_VIDEOS} videos for now, so it stays smooth.`)
      return
    }
    const [x, y, z] = transform.position
    const id = newId()
    const copy = withDefaults({ ...rest, ...(obj.kind === 'video' ? { sound: false } : {}), id, transform: { ...transform, position: [Math.min(x + 0.18, AREA.half), y, Math.min(z + 0.12, AREA.half)] } })
    pendingSelect.current = id
    setScene((sc) => ({ ...sc, objects: [...sc.objects, copy] }))
  }

  async function onPicked(file: File | undefined) {
    if (!file) return
    setImporting(file.type.startsWith('video/') ? 'Preparing your video…' : 'Preparing your photo…')
    try {
      const info = await importMedia(file)
      if (info.kind === 'video' && videoCount >= MAX_VIDEOS) {
        void forgetLocalMedia(info.id)
        setNotice(`A post holds up to ${MAX_VIDEOS} videos for now, so it stays smooth.`)
        return
      }
      const aspect = info.width / info.height
      // The first video of a scene gets the sound; later ones start silent.
      const sound = !scene.objects.some((o) => o.kind === 'video' && o.sound)
      setPlace({ src: mediaSrc(info.id), kind: info.kind, aspect, display: 'screen', screen: SCREENS_FOR[formatOf(aspect)][0], sound, gif: false })
      setSheet('place')
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting('')
    }
  }

  // Straight to the iPhone's own picker (it offers the library, the camera and files).
  function openMedia() {
    setTools(false)
    if (full) {
      setLimit(true)
      return
    }
    libraryInput.current?.click()
  }

  async function editMedia(obj: SceneObject) {
    if (obj.kind !== 'image' && obj.kind !== 'video') return
    const info = isMediaSrc(obj.src) ? await mediaInfo(obj.src.slice(6)) : undefined
    setPlace({
      src: obj.src,
      kind: obj.kind,
      aspect: obj.aspect ?? (info ? info.width / info.height : 9 / 16),
      display: obj.display ?? 'screen',
      screen: obj.screen ?? 'frame',
      sound: obj.kind === 'video' ? obj.sound : false,
      gif: obj.kind === 'video' && obj.gif,
      editing: obj.id,
    })
    setSheet('place')
  }

  function submitPlace() {
    if (!place) return
    const { src, kind, aspect, display, screen, sound, gif, editing } = place
    const width = mediaWidth(display, faceAspect(display, screen, aspect))
    // One video's sound at a time: turning it on for this one turns the others off.
    const soundPatch = (objs: SceneObject[], keepId: string) =>
      kind === 'video' && sound ? objs.map((o) => (o.kind === 'video' && o.id !== keepId ? { ...o, sound: false } : o)) : objs
    if (editing) {
      const old = scene.objects.find((o) => o.id === editing)
      if (old) {
        const was = 'display' in old ? old.display : undefined
        // Changing where it goes moves it to that kind of spot; same kind keeps its spot.
        const position = was === display ? old.transform.position : mediaPosition(display, [old.transform.position[0], Math.max(old.transform.position[2], -0.2)])
        const rotation: [number, number, number] = was === display ? old.transform.rotation : [0, 0, 0]
        const patch = { display, screen, width, aspect, ...(kind === 'video' ? { sound, gif } : {}), transform: { ...old.transform, position, rotation } }
        setScene((sc) => ({ ...sc, objects: soundPatch(sc.objects.map((o) => (o.id === editing ? ({ ...o, ...patch } as SceneObject) : o)), editing) }))
      }
    } else {
      if (full) return setLimit(true)
      const [x, z] = freeSpot(scene.objects.map((o) => [o.transform.position[0], o.transform.position[2]]))
      const id = newId()
      const obj = withDefaults({ id, kind, src, width, display, screen, aspect, ...(kind === 'video' ? { sound, gif } : {}), transform: { position: mediaPosition(display, [x, z]), rotation: [0, 0, 0], scale: 1 } })
      pendingSelect.current = id
      setScene((sc) => ({ ...sc, objects: soundPatch([...sc.objects, obj], id) }))
    }
    setSheet(null)
    setPlace(null)
  }

  function toggleSound() {
    // Straight from the tap: iOS only plays sound after one.
    const next = !sound
    stageRef.current?.setSound(next)
    setSound(next)
  }

  // Delete at once, with a few seconds to undo (no "are you sure?" dialog).
  useEffect(() => {
    if (!deleted) return
    const t = setTimeout(() => setDeleted(null), 5000)
    return () => clearTimeout(t)
  }, [deleted])

  function remove(id: string) {
    const index = scene.objects.findIndex((o) => o.id === id)
    if (index < 0) return
    setScene((sc) => ({ ...sc, objects: sc.objects.filter((o) => o.id !== id) }))
    setDeleted({ obj: scene.objects[index], index })
    setSelected(null)
  }

  // The "Deleted · Undo" message is a shortcut for the general undo.
  function undoDelete() {
    if (!deleted) return
    pendingSelect.current = deleted.obj.id
    undo()
  }

  function openTool(t: Exclude<Sheet, null>) {
    setTools(false)
    if (t === 'text') setTextDraft({ text: '', style: textDraft.style })
    setSheet(t)
  }

  function submitText() {
    const text = textDraft.text.trim().slice(0, MAX_TEXT_CHARS)
    if (!text) return
    if (textDraft.editing) updateObject(textDraft.editing, { text, style: textDraft.style } as Partial<SceneObject>)
    else add({ kind: 'text', text, style: textDraft.style } as Omit<SceneObject, 'id' | 'transform'>)
    setSheet(null)
  }

  function editText(obj: SceneObject) {
    if (obj.kind !== 'text') return
    setTextDraft({ text: obj.text, style: obj.style, editing: obj.id })
    setSheet('text')
  }

  const libraryType: ItemType = sheet === 'characters' ? 'character' : sheet === 'stickers' ? 'sticker' : 'object'
  // Style chips only show (and filter) in the 3D Object sheet; Stickers lists them all.
  const filter = sheet === 'stickers' ? 'all' : styleFilter
  const items = LIBRARY.filter((i) => i.type === libraryType && (filter === 'all' || i.styles.includes(filter)))

  return (
    <div className="studio" data-scene-id={scene.id} data-busy={busy} data-count={count} data-selected={selected ?? ''} data-framing={framing}>
      <div ref={hostRef} className="studio-stage" />

      {framing && (
        <div className="studio-frame">
          {frameBox && <div className="studio-frame-box" style={frameBox} aria-hidden="true" />}
          <header className="studio-frame-top">
            <button className="studio-icon" aria-label="Back to editing" onClick={stopFraming}><BackIcon color="#fff" size={26} /></button>
            <h1 className="t-heading-18">Frame your shot</h1>
            <button className="studio-frame-next" onClick={() => void toPost()}>Next</button>
          </header>
          <div className="studio-frame-bottom">
            <p className="t-label-12">This is your post’s picture. Turn, pinch and move to frame it.</p>
            <button className="look-chip" onClick={() => stageRef.current?.frameReset()}>Reset</button>
          </div>
        </div>
      )}

      <header className="studio-top">
        <button className="studio-icon" aria-label={from ? 'Close' : 'Back to My scenes'} onClick={() => void close()}><CloseIcon color="#fff" size={28} /></button>
        <div className="studio-pills">
          <button className="studio-pill studio-help" aria-label="How InStudio works" onClick={openTutorial}><HelpIcon /></button>
          <button className={`studio-pill${sheet === 'background' ? ' is-active' : ''}`} onClick={() => setSheet(sheet === 'background' ? null : 'background')}>Background</button>
        </div>
        <button className="studio-icon" aria-label="Post it" onClick={() => void startFraming()}><ArrowRightIcon color="#fff" size={30} /></button>
      </header>
      <p className={`studio-count${full ? ' is-full' : ''}`} aria-label={`${count} of ${MAX_OBJECTS} objects`}>{count}/{MAX_OBJECTS}</p>

      {selectedObj && !sheet && (
        <>
          <p className="studio-hint">Drag to move · two fingers: slide to push back, pinch, twist</p>
          <div className="studio-selbar" role="toolbar" aria-label="Selected object">
            {selectedObj.kind === 'text' && (
              <button className="studio-selbtn" onClick={() => editText(selectedObj)}><EditIcon size={20} /><span>Edit</span></button>
            )}
            {(selectedObj.kind === 'image' || selectedObj.kind === 'video') && (
              <button className="studio-selbtn" onClick={() => void editMedia(selectedObj)}><EditIcon size={20} /><span>Edit</span></button>
            )}
            <button className="studio-selbtn" onClick={() => setSheet('motion')}><MotionIcon size={20} /><span>Motion</span></button>
            <button className="studio-selbtn" onClick={() => duplicate(selectedObj)}><PlusIcon size={20} /><span>Duplicate</span></button>
            <button className="studio-selbtn" onClick={() => remove(selectedObj.id)}><TrashIcon size={20} /><span>Delete</span></button>
          </div>
        </>
      )}

      {videoCount > 0 && !sheet && (
        <button className="studio-sound" aria-label={sound ? 'Sound off' : 'Sound on'} onClick={toggleSound}>
          {sound ? <SoundOnIcon color="#fff" /> : <SoundOffIcon color="#fff" />}
        </button>
      )}

      {!sheet && (
        <div className="studio-history" role="group" aria-label="Undo and redo">
          <button aria-label="Undo" disabled={!history.undo} onClick={undo}><UndoIcon /></button>
          <button aria-label="Redo" disabled={!history.redo} onClick={redo}><RedoIcon /></button>
        </div>
      )}

      {!sheet && (
        <div className="studio-bottom">
          {tools && (
            <nav className="studio-tools" aria-label="Studio tools">
              <button onClick={() => openTool('objects')}><CubeIcon /><span>3D Object</span></button>
              <button onClick={() => openTool('text')}><TextToolIcon /><span>Text</span></button>
              <button onClick={() => openTool('characters')}><AvatarIcon /><span>Avatar</span></button>
              <button onClick={openMedia}><MediaIcon /><span>Media</span></button>
              <button onClick={openGifs}><GifIcon /><span>GIF</span></button>
              <button onClick={() => openTool('stickers')}><StickerIcon /><span>Stickers</span></button>
            </nav>
          )}
          <button className={`studio-fab${tools ? ' is-open' : ''}`} aria-label={tools ? 'Close tools' : 'Add'} onClick={() => setTools(!tools)}>
            {tools ? <CloseIcon size={30} color="var(--ink-700)" /> : <PlusIcon size={34} color="var(--teal-500)" />}
          </button>
        </div>
      )}

      {sheet && (
        <section ref={sheetRef} className="studio-sheet" aria-label="Sheet">
          <span className="studio-grab" />
          <header className="studio-sheet-head">
            <h2 className="t-heading-22">
              {sheet === 'background'
                ? 'Change Background'
                : sheet === 'text'
                  ? (textDraft.editing ? 'Edit Text' : 'Add Text')
                  : sheet === 'stickers'
                    ? 'Stickers'
                    : sheet === 'place'
                      ? `${place?.editing ? 'Edit' : 'Place'} ${place?.gif ? 'GIF' : place?.kind === 'video' ? 'Video' : 'Photo'}`
                      : sheet === 'gif'
                        ? 'Add a GIF'
                        : sheet === 'motion'
                          ? 'Motion'
                      : 'Place 3D Object'}
            </h2>
            <button className="studio-x" aria-label="Close" onClick={() => (setSheet(null), setPlace(null))}><CloseIcon size={16} color="#fff" /></button>
          </header>

          {(sheet === 'objects' || sheet === 'characters') && (
            <div className="studio-tabs" role="tablist">
              <button role="tab" aria-selected={sheet === 'objects'} onClick={() => setSheet('objects')}>Objects</button>
              <button role="tab" aria-selected={sheet === 'characters'} onClick={() => setSheet('characters')}>Characters</button>
            </div>
          )}

          {(sheet === 'objects' || sheet === 'characters' || sheet === 'stickers') && (
            <div className="studio-sheet-body">
              {sheet !== 'stickers' && (
                <div className="studio-chips">
                  {['all', ...Object.keys(STYLES)].map((k) => (
                    <button key={k} className={k === styleFilter ? 'is-active' : ''} onClick={() => setStyleFilter(k)}>
                      {k === 'all' ? 'All' : STYLES[k].label}
                    </button>
                  ))}
                </div>
              )}
              <div className="studio-grid">
                {items.map((item) => (
                  <button key={item.id} className="studio-card" onClick={() => add({ kind: 'item', item: item.id } as Omit<SceneObject, 'id' | 'transform'>)}>
                    <img src={thumb(item.id)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                    <span>{item.name}</span>
                  </button>
                ))}
                {items.length === 0 && <p className="t-label-12 studio-empty">Nothing here yet.</p>}
              </div>
            </div>
          )}

          {sheet === 'text' && (
            <div className="studio-sheet-body">
              <form className="studio-textrow" onSubmit={(e) => (e.preventDefault(), submitText())}>
                <input
                  className="studio-input"
                  value={textDraft.text}
                  maxLength={MAX_TEXT_CHARS}
                  placeholder="Type your text"
                  onChange={(e) => setTextDraft({ ...textDraft, text: e.target.value })}
                  aria-label="Text"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                />
                <button className="btn btn-primary studio-add" disabled={!textDraft.text.trim()}>{textDraft.editing ? 'Update' : 'Add'}</button>
              </form>
              <p className="t-caption-10 studio-left">{MAX_TEXT_CHARS - textDraft.text.length} characters left</p>
              <div className="studio-grid">
                {TEXT_STYLE_IDS.map((st) => (
                  <button key={st} className={`studio-card${st === textDraft.style ? ' is-active' : ''}`} onClick={() => setTextDraft({ ...textDraft, style: st })}>
                    <img src={thumb(`text-${st}`)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                    <span>{TEXT_STYLES[st].name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {sheet === 'motion' && selectedObj && (
            <div className="studio-sheet-body">
              <div className="studio-motions">
                {MOTIONS.map((m) => (
                  <button
                    key={m}
                    className={m === motionOf(selectedObj) ? 'is-active' : ''}
                    onClick={() => updateObject(selectedObj.id, { motion: m } as Partial<SceneObject>)}
                  >
                    <span className={`studio-motion-dot is-${m}`} aria-hidden="true"><span /></span>
                    <span className="t-label-12-medium">{MOTION_LABELS[m]}</span>
                  </button>
                ))}
              </div>
              <p className="t-label-12 studio-left">The motion plays in AR too. Tap one to try it on the selected object.</p>
            </div>
          )}

          {sheet === 'gif' && (
            <div className="studio-sheet-body">
              <input
                className="studio-input studio-gif-search"
                type="search"
                value={gifQuery}
                placeholder="Search GIPHY"
                onChange={(e) => setGifQuery(e.target.value)}
                aria-label="Search GIFs"
                autoCorrect="off"
                enterKeyHint="search"
              />
              {gifState === 'error' ? (
                <p className="t-body-14 studio-empty">{gifError}</p>
              ) : (
                <div className="studio-gifs">
                  {gifs.map((g) => (
                    <button key={g.id} className="studio-gif" style={{ aspectRatio: `${g.width} / ${g.height}` }} onClick={() => pickGif(g)} aria-label={g.title || 'GIF'}>
                      <img src={g.preview} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
              {gifState === 'loading' && <span className="studio-spinner studio-gif-spin" />}
              {gifState === 'idle' && gifs.length === 0 && <p className="t-label-12 studio-empty">No GIFs found.</p>}
              {gifState === 'idle' && gifNext !== null && (
                <button className="btn btn-secondary studio-gif-more" onClick={() => void loadGifs(gifQuery.trim(), gifNext)}>More GIFs</button>
              )}
              <p className="t-caption-10 studio-giphy">Powered by GIPHY</p>
            </div>
          )}

          {sheet === 'place' && place && (
            <div className="studio-sheet-body">
              <div className="studio-place-head">
                {place.kind === 'video'
                  ? <video src={placePreview} muted playsInline autoPlay loop className="studio-place-thumb" />
                  : placePreview && <img src={placePreview} alt="" className="studio-place-thumb" />}
                <div className="studio-displays">
                  {DISPLAYS.map((d) => (
                    <button key={d.id} className={d.id === place.display ? 'is-active' : ''} onClick={() => setPlace({ ...place, display: d.id })}>
                      <DisplayPicto d={d.id} />
                      <span className="t-label-12-medium">{d.label}</span>
                      <span className="t-caption-10">{d.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              {place.display === 'screen' && (
                <div className="studio-grid studio-screens">
                  {SCREENS_FOR[formatOf(place.aspect)].map((t) => (
                    <button key={t} className={`studio-card${t === place.screen ? ' is-active' : ''}`} onClick={() => setPlace({ ...place, screen: t })}>
                      <img src={thumb(`screen-${t}`)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                      <span>{SCREEN_LABELS[t]}</span>
                    </button>
                  ))}
                </div>
              )}
              {place.kind === 'video' && !place.gif && (
                <label className="studio-switch">
                  <span>
                    <span className="t-body-14-medium">Sound</span>
                    <span className="t-label-12">Only one video's sound plays at a time</span>
                  </span>
                  <input type="checkbox" role="switch" checked={place.sound} onChange={(e) => setPlace({ ...place, sound: e.target.checked })} />
                </label>
              )}
              <p className="t-label-12 studio-left">
                {place.gif
                  ? `GIFs loop silently. Up to ${MAX_GIFS} per post.`
                  : `Saved to the cloud with your scene. Up to ${MAX_VIDEOS} videos per post.`}
              </p>
              <button className="btn btn-primary studio-place-add" onClick={submitPlace}>{place.editing ? 'Update' : 'Add to scene'}</button>
            </div>
          )}

          {sheet === 'background' && (
            <div className="studio-sheet-body">
              <div className="studio-swatches">
                {BACKGROUNDS.map((c) => (
                  <button
                    key={c}
                    style={{ background: c }}
                    className={c.toLowerCase() === scene.background.color.toLowerCase() ? 'is-active' : ''}
                    aria-label={`Background ${c}`}
                    onClick={() => setScene((sc) => ({ ...sc, background: { color: c } }))}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <input ref={libraryInput} type="file" accept="image/*,video/*" hidden onChange={(e) => (void onPicked(e.target.files?.[0]), (e.target.value = ''))} />

      {importing && (
        <div className="studio-modal-bg">
          <div className="studio-modal" role="status">
            <span className="studio-spinner" />
            <p className="t-body-14-medium">{importing}</p>
          </div>
        </div>
      )}

      {notice && (
        <div className="studio-modal-bg" onClick={() => setNotice('')}>
          <div className="studio-modal" role="alertdialog" onClick={(e) => e.stopPropagation()}>
            <AlertIcon size={44} color="var(--teal-500)" />
            <p className="t-body-14">{notice}</p>
            <button className="btn btn-primary" onClick={() => setNotice('')}>Ok</button>
          </div>
        </div>
      )}

      {deleted && (
        <div className="studio-toast" role="status">
          <span>Deleted</span>
          <button onClick={undoDelete}>Undo</button>
        </div>
      )}

      {tutorial && <StudioTutorial onDone={() => setTutorial(false)} />}

      {limit && (
        <div className="studio-modal-bg" onClick={() => setLimit(false)}>
          <div className="studio-modal" role="alertdialog" aria-labelledby="limit-title" onClick={(e) => e.stopPropagation()}>
            <AlertIcon size={44} color="var(--teal-500)" />
            <h2 id="limit-title" className="t-heading-18">Object Limit Reached</h2>
            <p className="t-label-12">A post holds up to {MAX_OBJECTS} objects. Delete one to add another.</p>
            <button className="btn btn-primary" onClick={() => setLimit(false)}>Ok</button>
          </div>
        </div>
      )}
    </div>
  )
}
