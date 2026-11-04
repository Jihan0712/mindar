import * as THREE from 'three'

/**
 * The backdrop of a post (its picture, IN3D, Frame your shot): the scene's
 * colour, a little lighter at the top and a little deeper towards the floor.
 */
export function studioGradient(c: THREE.Color): THREE.Texture {
  const cv = document.createElement('canvas')
  cv.width = 2
  cv.height = 256
  const g = cv.getContext('2d')!
  const css = (k: THREE.Color) => `#${k.getHexString()}`
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, css(c.clone().lerp(new THREE.Color(0xffffff), 0.18)))
  grad.addColorStop(0.62, css(c))
  grad.addColorStop(1, css(c.clone().multiplyScalar(0.88)))
  g.fillStyle = grad
  g.fillRect(0, 0, 2, 256)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
