import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { addLights, buildScene, makeShadowCatcher, type SceneHandle } from '../scene/buildScene'
import { loadScene } from '../scene/schema'
import { BackIcon, SoundOffIcon, SoundOnIcon } from '../components/Icons'
import { ModePill } from '../components/ModePill'
import './Preview3D.css'

/*
 * IN3D: the same scene, orbitable with one finger (rotate), pinch (zoom) and
 * two fingers (pan), double-tap to reset — the gestures from the InStudio
 * tutorial. Also the quickest way to check a scene without a camera.
 */
export default function Preview3D() {
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<SceneHandle | null>(null)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const host = hostRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    host.appendChild(renderer.domElement)

    const scene3 = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50)
    const home = new THREE.Vector3(0, 0.95, 1.75)
    camera.position.copy(home)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0.18, 0)
    controls.enableDamping = true
    controls.minDistance = 0.4
    controls.maxDistance = 4
    controls.maxPolarAngle = Math.PI * 0.49

    addLights(scene3)
    scene3.add(makeShadowCatcher(4))
    // The marker under the scene, so you see the post as it will sit on it.
    new THREE.TextureLoader().loadAsync('/test/marker.png').then((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      const marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }))
      marker.rotation.x = -Math.PI / 2
      marker.receiveShadow = true
      scene3.add(marker)
    })

    let disposed = false
    loadScene('/test/scene.json')
      .then(async (data) => {
        scene3.background = new THREE.Color(data.background.color)
        const handle = await buildScene(data)
        if (disposed) return handle.dispose()
        handleRef.current = handle
        scene3.add(handle.root)
      })
      .catch((e) => setError(String(e)))

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    window.addEventListener('resize', resize)
    const reset = () => {
      camera.position.copy(home)
      controls.target.set(0, 0.18, 0)
    }
    renderer.domElement.addEventListener('dblclick', reset)

    const timer = new THREE.Timer()
    renderer.setAnimationLoop((time) => {
      timer.update(time)
      handleRef.current?.update(timer.getDelta())
      controls.update()
      renderer.render(scene3, camera)
    })

    return () => {
      disposed = true
      window.removeEventListener('resize', resize)
      renderer.setAnimationLoop(null)
      controls.dispose()
      handleRef.current?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  function togglePlay() {
    const h = handleRef.current
    if (!h) return
    if (playing) h.pause()
    else {
      h.setMuted(false)
      void h.play()
    }
    setPlaying(!playing)
  }

  return (
    <div className="p3d">
      <div ref={hostRef} className="p3d-stage" />
      <header className="p3d-top">
        <Link to="/" className="p3d-icon" aria-label="Back"><BackIcon /></Link>
        <ModePill active="IN3D" />
        <span className="p3d-icon" />
      </header>
      {error && <p className="p3d-error">{error}</p>}
      <button className="p3d-play" onClick={togglePlay} aria-label={playing ? 'Pause sound and video' : 'Play sound and video'}>
        {playing ? <SoundOnIcon color="#fff" /> : <SoundOffIcon color="#fff" />}
      </button>
    </div>
  )
}
