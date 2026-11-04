import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { studioEnvironment } from '../look/environment'
import { addLights, buildScene } from '../scene/buildScene'
import { SCREEN_TYPES } from '../scene/schema'
import { buildText, LIBRARY, TEXT_STYLE_IDS, TEXT_STYLES } from '../studio/library'

/*
 * Draws the InStudio library thumbnails. Not linked from the app:
 * `npm run thumbs` opens it in headless Chrome and saves the pictures to
 * public/studio/thumbs/, so phones load small images instead of building
 * every object just to show the list.
 */

const SIZE = 256

declare global {
  interface Window {
    __thumbs?: Promise<Record<string, string>>
  }
}

async function renderAll(): Promise<Record<string, string>> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(SIZE, SIZE)
  renderer.setPixelRatio(1)
  renderer.toneMapping = THREE.NeutralToneMapping
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#eef1f2')
  scene.environment = studioEnvironment(renderer, 'streetwear')
  const { hemi, sun } = addLights(scene)
  hemi.intensity = 0.9
  sun.intensity = 1.8
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20)
  const out: Record<string, string> = {}

  const jobs: [string, () => Promise<{ object: THREE.Object3D; update?: (t: number) => void }>][] = [
    ...LIBRARY.map((i): [string, () => Promise<{ object: THREE.Object3D }>] => [i.id, async () => i.build()]),
    ...TEXT_STYLE_IDS.map((st): [string, () => Promise<{ object: THREE.Object3D }>] => [`text-${st}`, () => buildText(st === 'collage' ? 'ABC' : 'Aa', st)]),
    // Screen types, with the step-1 test photo on them.
    ...SCREEN_TYPES.map((t): [string, () => Promise<{ object: THREE.Object3D }>] => [`screen-${t}`, async () => {
      const handle = await buildScene({ version: 1, id: t, title: '', background: { color: '#fff' }, objects: [{ id: t, kind: 'image', src: '/test/photo.jpg', width: 0.4, frame: true, display: 'screen', screen: t, transform: { position: [0, 0, 0], rotation: [0, -18, 0], scale: 1 } }] })
      return { object: handle.root }
    }]),
  ]
  for (const [name, make] of jobs) {
    const built = await make()
    built.update?.(1.2) // a pleasant moment of the idle animation (eyes open)
    scene.add(built.object)
    built.object.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(built.object)
    const centre = box.getCenter(new THREE.Vector3())
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05
    camera.position.copy(centre).add(new THREE.Vector3(0, 0.35, 1).normalize().multiplyScalar(dist))
    camera.lookAt(centre)
    renderer.render(scene, camera)
    out[name] = renderer.domElement.toDataURL('image/png')
    scene.remove(built.object)
  }
  renderer.dispose()
  return out
}

export default function StudioThumbs() {
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  useEffect(() => {
    window.__thumbs ??= renderAll()
    void window.__thumbs.then(setThumbs)
  }, [])
  const label = (k: string) => (k.startsWith('text-') ? TEXT_STYLES[k.slice(5) as keyof typeof TEXT_STYLES].name : LIBRARY.find((i) => i.id === k)?.name ?? k)
  return (
    <main style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 16 }}>
      {Object.entries(thumbs).map(([k, src]) => (
        <figure key={k} style={{ margin: 0, width: 128, font: '11px var(--font)' }}>
          <img src={src} width={128} height={128} alt="" />
          <figcaption>{label(k)}</figcaption>
        </figure>
      ))}
    </main>
  )
}
