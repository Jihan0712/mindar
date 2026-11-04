// Automated InStudio check: drives /studio in headless Chrome with touch
// events like a phone: adds library objects, text and a sticker, hits the
// 6-object limit, drags, pinches and twists an object, changes the
// background, reloads (scene kept on the phone), My scenes (new, reopen,
// delete with Undo), cloud saving (scene and media uploaded, phone copy
// freed), and fails on page errors.
// Screenshots: .cache/studio-*.png. Look at them.
//
//   npm run dev   (in another terminal)
//   npm run test:studio        (URL=… to test the live site)
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.URL ?? 'http://localhost:5173/studio'
mkdirSync('.cache', { recursive: true })

const cam = resolve(process.env.CAM ?? '.cache/fakecam.y4m')
const camArgs = existsSync(cam) ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${cam}`] : []
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--enable-unsafe-swiftshader', ...camArgs] })
const problems = []
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) problems.push(what)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${BASE}?test`, { waitUntil: 'networkidle0' })
  check((await page.$('.scenes-new')) !== null, 'My scenes opens with a New scene card')
  await page.screenshot({ path: '.cache/studio-scenes-empty.png' })

  const click = (sel, text) => page.evaluate((s, t) => {
    const el = [...document.querySelectorAll(s)].find((b) => !t || b.textContent.trim() === t)
    el?.click()
    return !!el
  }, sel, text)
  const idle = () => page.waitForFunction(() => document.querySelector('.studio')?.dataset.busy === 'false', { timeout: 30000 })
  const count = () => page.evaluate(() => Number(document.querySelector('.studio').dataset.count))
  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem(`inrl.scene.${document.querySelector('.studio').dataset.sceneId}`) ?? 'null'))
  const newScene = async () => {
    await page.waitForSelector('.scenes-new')
    await click('.scenes-new')
    await page.waitForSelector('.studio')
    await idle()
  }
  // The phone's cloud key and a call to the cloud API as this phone.
  const cloud = (path, method = 'GET') => page.evaluate(async (p, m) => {
    const r = await fetch(p, { method: m, headers: { 'X-InRL-Owner': localStorage.getItem('inrl.owner') ?? '' } })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, path, method)
  await newScene()
  check(/\/studio\/edit\/[a-z0-9]+/.test(page.url()), `New scene opens the editor (${page.url().replace(/^.*\/studio/, '/studio')})`)

  // First visit: the tutorial shows by itself (cards, then tips).
  check((await page.$('.tut-card')) !== null, 'the tutorial opens on the first visit')
  await page.screenshot({ path: '.cache/studio-tutorial-1.png' })
  for (let i = 0; i < 3; i++) await click('.tut-main')
  await page.screenshot({ path: '.cache/studio-tutorial-4.png' })
  check((await page.$eval('.tut-main', (b) => b.textContent)) === "Let's Go!", 'the last card says "Let\'s Go!"')
  await click('.tut-main')
  for (let i = 0; i < 6; i++) {
    await page.waitForSelector('.tut-veil')
    if (i === 1) await page.screenshot({ path: '.cache/studio-tutorial-tip.png' })
    await page.click('.tut-veil')
    await wait(150)
  }
  check((await page.$('.tut-veil, .tut-card')) === null, 'the tutorial ends after the tips')
  await page.reload({ waitUntil: 'networkidle0' })
  check((await page.$('.tut-card')) === null, 'it does not come back by itself')
  check(await click('.studio-help'), 'the ? button opens it again')
  await click('.tut-link', 'Skip')
  check((await page.$('.tut-card')) === null, 'Skip closes it')
  await page.screenshot({ path: '.cache/studio-empty.png' })
  check(await click('.studio-fab'), 'action button opens the tools')
  await page.screenshot({ path: '.cache/studio-tools.png' })
  check(await click('.studio-tools button', '3D Object'), '3D Object opens the library')
  for (const name of ['Liquid blob', 'Chrome ring', 'Soft TV']) {
    check(await click('.studio-card', name), `adds "${name}"`)
    await idle()
  }
  await click('.studio-chips button', 'Bubblegum Pop')
  await click('.studio-tabs button', 'Characters')
  await click('.studio-card', 'Heart buddy')
  await idle()
  await page.screenshot({ path: '.cache/studio-library.png' })
  await click('.studio-x')
  await click('.studio-fab')
  await click('.studio-tools button', 'Text')
  await page.type('.studio-input', 'Hello')
  await click('.studio-card', 'Candy balloon')
  await click('.studio-add')
  await idle()
  await click('.studio-fab')
  await click('.studio-tools button', 'Stickers')
  check((await page.$$('.studio-sheet .studio-card')).length === 6, 'Stickers lists all six stickers, whatever style chip was picked before')
  await click('.studio-card', 'Fire')
  await idle()
  check((await count()) === 6, 'six objects in the scene')
  await click('.studio-card', 'Bird')
  await wait(200)
  check(await page.$('.studio-modal') !== null, '"Object Limit Reached" appears at 7')
  await page.screenshot({ path: '.cache/studio-limit.png' })
  await click('.studio-modal .btn')
  await click('.studio-x')
  check((await count()) === 6, 'still six after the alert')
  await wait(700) // the view slides back down once the sheet closes

  // Gestures on the text object (the most recently added text).
  const text = (await draft()).objects.find((o) => o.kind === 'text')
  const pt = () => page.evaluate((id) => window.__studio.screenPoint(id), text.id)
  const selectedNow = () => page.evaluate(() => document.querySelector('.studio').dataset.selected)
  // Tap the text; if a neighbour overlaps it, tapping the same spot again cycles to the next object.
  const tapUntilSelected = async () => {
    for (let i = 0; i < 6 && (await selectedNow()) !== text.id; i++) {
      await page.touchscreen.tap(p.x, p.y)
      await wait(400)
    }
  }
  let p = await pt()
  await tapUntilSelected()
  check((await selectedNow()) === text.id, 'tapping an object selects it')
  // tap empty wall (top left): deselects; dragging an unselected object then turns the view instead
  await page.touchscreen.tap(60, 300)
  await wait(150)
  check((await page.evaluate(() => document.querySelector('.studio').dataset.selected)) === '', 'tapping outside deselects')
  await page.touchscreen.touchStart(p.x, p.y)
  for (let i = 1; i <= 10; i++) await page.touchscreen.touchMove(p.x + i * 6, p.y)
  await page.touchscreen.touchEnd()
  await wait(400)
  const still = (await draft()).objects.find((o) => o.id === text.id).transform.position
  check(still.every((v, i) => v === text.transform.position[i]), 'an unselected object does not move')
  await page.evaluate(() => window.__studio.resetView())
  await wait(600)
  p = await pt()
  await tapUntilSelected()
  check((await selectedNow()) === text.id, 'selects it again after the camera moved')
  // while it is selected, a drag starting on empty space moves IT, not the view
  {
    const before = (await draft()).objects.find((o) => o.id === text.id).transform.position
    const cam0 = await page.evaluate(() => window.__studio.cameraPosition())
    await page.touchscreen.touchStart(60, 300)
    for (let i = 1; i <= 8; i++) await page.touchscreen.touchMove(60 + i * 8, 300)
    await page.touchscreen.touchEnd()
    await wait(400)
    const after = (await draft()).objects.find((o) => o.id === text.id).transform.position
    const cam1 = await page.evaluate(() => window.__studio.cameraPosition())
    check(after[0] !== before[0], 'with an object selected, a drag anywhere moves the object')
    check(cam0.every((v, i) => Math.abs(v - cam1[i]) < 1e-4), 'with an object selected, the view stays still')
    p = await pt()
  }
  // one-finger drag
  await page.touchscreen.touchStart(p.x, p.y)
  for (let i = 1; i <= 10; i++) await page.touchscreen.touchMove(p.x + i * 6, p.y + i * 4)
  await page.touchscreen.touchEnd()
  await wait(150)
  let t = (await draft()).objects.find((o) => o.id === text.id).transform
  if (process.env.DEBUG) console.log(JSON.stringify((await draft()).objects.map((o) => [o.kind, o.item ?? o.text, o.transform.position])), p)
  check(t.position[0] !== text.transform.position[0] && t.position[1] > text.transform.position[1] - 1e-6 && Math.abs(t.position[2] - text.transform.position[2]) < 0.06, `one finger moves it left/right and up/down, not in depth (now ${t.position.map((v) => v.toFixed(2))})`)

  // two-finger pinch + twist, the first finger on the object
  p = await pt()
  const cdp = await page.createCDPSession()
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) })
  await touch('touchStart', [[p.x, p.y]])
  await touch('touchMove', [[p.x, p.y]])
  await touch('touchStart', [[p.x, p.y], [p.x + 60, p.y]])
  for (let i = 1; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 4)
    const r = 60 + i * 6
    await touch('touchMove', [[p.x, p.y], [p.x + Math.cos(a) * r, p.y + Math.sin(a) * r]])
  }
  await touch('touchEnd', [])
  await wait(150)
  t = (await draft()).objects.find((o) => o.id === text.id).transform
  const z0 = t.position[2]
  // two fingers sliding up together push it back (further from you)
  p = await pt()
  await touch('touchStart', [[p.x - 30, p.y]])
  await touch('touchMove', [[p.x - 30, p.y]])
  await touch('touchStart', [[p.x - 30, p.y], [p.x + 30, p.y]])
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[p.x - 30, p.y - i * 12], [p.x + 30, p.y - i * 12]])
  await touch('touchEnd', [])
  await wait(150)
  const pushed = (await draft()).objects.find((o) => o.id === text.id).transform
  check(pushed.position[2] < z0 - 0.1, `two fingers sliding up push it back (depth ${z0} → ${pushed.position[2]})`)
  // one finger up the screen lifts it
  p = await pt()
  await page.touchscreen.touchStart(p.x, p.y)
  for (let i = 1; i <= 10; i++) await page.touchscreen.touchMove(p.x, p.y - i * 8)
  await page.touchscreen.touchEnd()
  await wait(200)
  const lifted = (await draft()).objects.find((o) => o.id === text.id).transform
  check(lifted.position[1] > pushed.position[1] + 0.05, `one finger up lifts it (height ${pushed.position[1]} → ${lifted.position[1]})`)
  check(t.scale > 1.4, `pinch makes it bigger (scale ${t.scale})`)
  check(Math.abs(t.rotation[1] + 45) < 8, `twist turns it (${t.rotation[1]}°, expected about -45°)`)
  await page.screenshot({ path: '.cache/studio-selected.png' })

  // drag far past the right edge: springs back to the edge of the area (1 marker width)
  p = await pt()
  await page.touchscreen.touchStart(p.x, p.y)
  for (let i = 1; i <= 15; i++) await page.touchscreen.touchMove(p.x + i * 40, p.y)
  await page.touchscreen.touchEnd()
  await wait(600)
  t = (await draft()).objects.find((o) => o.id === text.id).transform
  check(t.position[0] === 1, `dragged past the edge, it stops at the edge (x ${t.position[0]})`)
  await page.screenshot({ path: '.cache/studio-edge.png' })

  // delete, then undo
  await click('.studio-selbtn', 'Delete')
  await wait(200)
  check((await count()) === 5 && (await page.$('.studio-toast')) !== null, 'delete removes it at once and offers Undo')
  await page.screenshot({ path: '.cache/studio-deleted.png' })
  await click('.studio-toast button', 'Undo')
  await idle()
  const back = (await draft()).objects.find((o) => o.id === text.id)
  check((await count()) === 6 && back?.transform.position[0] === 1, 'Undo brings it back where it was')

  // motion: the text gets Bounce, and it really moves (in the editor and saved for AR)
  check(await click('.studio-selbtn', 'Motion'), 'Motion opens the Motion sheet')
  await page.waitForSelector('.studio-motions')
  await page.screenshot({ path: '.cache/studio-motion.png' })
  await click('.studio-motions button', 'Bounce')
  await idle()
  await wait(300)
  check((await draft()).objects.find((o) => o.id === text.id).motion === 'bounce', 'Bounce is saved with the object')
  check((await selectedNow()) === text.id, 'the object stays selected while trying motions')
  // Sample its height over a second (two samples can land on the same point of the bounce).
  const ys = []
  for (let k = 0; k < 8; k++) {
    ys.push(await page.evaluate((id) => window.__studio.screenPoint(id).y, text.id))
    await wait(130)
  }
  const span = Math.max(...ys) - Math.min(...ys)
  check(span > 0.5, `the object is moving (moves ${span.toFixed(1)} px over a second)`)
  await click('.studio-x')
  await wait(500)

  // background
  await click('.studio-pill:not(.studio-help)', 'Background')
  await page.evaluate(() => document.querySelectorAll('.studio-swatches button')[12].click())
  await wait(300)
  await page.screenshot({ path: '.cache/studio-background.png' })
  check((await draft()).background.color === '#2D4D48', 'background colour saved')
  await click('.studio-x')
  // undo / redo
  await wait(300)
  await click('.studio-history button[aria-label="Undo"]')
  await wait(300)
  check((await draft()).background.color !== '#2D4D48', 'Undo takes the background change back')
  await click('.studio-history button[aria-label="Redo"]')
  await wait(300)
  check((await draft()).background.color === '#2D4D48', 'Redo puts it back')

  await page.reload({ waitUntil: 'networkidle0' })
  await idle()
  check((await count()) === 6, 'scene kept after reload')
  await page.screenshot({ path: '.cache/studio-reloaded.png' })

  // ---- Piece 5: My scenes and cloud saving
  const firstId = await page.evaluate(() => document.querySelector('.studio').dataset.sceneId)
  await click('.studio-icon[aria-label="Back to My scenes"]')
  await page.waitForSelector(`.scenes-card[data-id="${firstId}"]`)
  check((await page.$$('.scenes-card')).length === 1, 'the scene is listed in My scenes')
  check(await page.$eval('.scenes-card .scenes-thumb img', (i) => i.src.startsWith('data:image/jpeg')), 'with a picture of it')
  check((await page.$eval('.scenes-card p', (p) => p.textContent)).startsWith('6 objects'), 'and its object count')
  await page.waitForSelector('.scenes-card[data-cloud="saved"]', { timeout: 20000 }).catch(() => {})
  check((await page.$('.scenes-card[data-cloud="saved"]')) !== null, 'it is saved to the cloud')
  await page.screenshot({ path: '.cache/studio-scenes.png' })
  let inCloud = await cloud(`/api/scenes/${firstId}`)
  check(inCloud.status === 200 && inCloud.body.scene.objects.length === 6 && inCloud.body.scene.background.color === '#2D4D48', 'the cloud copy has all 6 objects and the background')
  check((await page.evaluate(() => fetch('/api/scenes').then((r) => r.status))) === 401, 'the cloud refuses a request without the phone key')

  // Reopen it from its card.
  await click(`.scenes-card[data-id="${firstId}"] .scenes-open`)
  await page.waitForSelector('.studio')
  await idle()
  check((await count()) === 6, 'tapping the card reopens the scene')
  await click('.studio-icon[aria-label="Back to My scenes"]')
  await page.waitForSelector('.scenes-new')

  // ---- Piece 2: photos and videos (a second scene; tutorial already seen)
  await newScene()
  check((await count()) === 0, 'a new scene starts empty')
  const upload = async (file) => {
    const input = await page.$('input[type=file]:not([capture])')
    await input.uploadFile(resolve(file))
    await page.waitForSelector('.studio-displays', { timeout: 20000 })
  }
  const place = async (display, screen) => {
    await click('.studio-displays button', display)
    if (screen) await click('.studio-screens .studio-card', screen)
    await click('.studio-place-add')
    await idle()
    await wait(300)
  }
  await click('.studio-fab')
  check(await click('.studio-tools button', 'Media'), 'Media opens the phone picker directly')
  await upload('public/test/photo.jpg')
  const offered = await page.$$eval('.studio-screens .studio-card span', (els) => els.map((e) => e.textContent))
  check(offered[0] === 'Phone' && offered.includes('Tablet') && !offered.includes('Flat TV'), `a portrait photo is offered portrait screens (${offered.join(', ')})`)
  await page.screenshot({ path: '.cache/studio-place.png' })
  await place('On a screenStands in a 3D screen', 'Tablet')
  await click('.studio-fab')
  await click('.studio-tools button', 'Media')
  await upload('public/test/video.mp4')
  await place('On the markerLies on the print')
  await click('.studio-fab')
  await click('.studio-tools button', 'Media')
  await upload('public/test/photo.jpg')
  await place('FloatingA card in the air')
  let objs = (await draft()).objects
  check(objs.length === 3 && objs.map((o) => o.display).join() === 'screen,marker,floating', `three media placed (${objs.map((o) => `${o.kind}:${o.display}`).join(', ')})`)
  check(objs[0].screen === 'tablet' && objs[0].src.startsWith('media:'), 'the photo is on the Tablet, stored on the phone')
  check(Math.abs(objs[1].transform.position[2] + 0.496) < 0.001 && objs[1].transform.position[1] === 0.5, 'the video lies on the marker square')
  check(objs[2].transform.position[1] > 0.1, 'the floating card starts in the air')
  check((await page.$('.studio-sound')) !== null, 'a sound button appears with a video')
  await page.screenshot({ path: '.cache/studio-media.png' })

  // a GIF from the GIPHY sheet (test GIFs on the dev server; real GIPHY live)
  await click('.studio-fab')
  check(await click('.studio-tools button', 'GIF'), 'GIF opens the GIPHY sheet')
  await page.waitForSelector('.studio-gif', { timeout: 15000 })
  check((await page.$$('.studio-gif')).length > 0, `trending GIFs appear (${(await page.$$('.studio-gif')).length})`)
  await page.type('.studio-gif-search', 'cat')
  await page.waitForFunction(() => document.querySelector('.studio-gif')?.getAttribute('aria-label')?.toLowerCase().includes('cat'), { timeout: 15000 }).catch(() => {})
  check(((await page.$eval('.studio-gif', (b) => b.getAttribute('aria-label'))) ?? '').toLowerCase().includes('cat'), 'searching shows matching GIFs')
  check((await page.$eval('.studio-giphy', (p) => p.textContent)).includes('GIPHY'), 'GIPHY is credited')
  await page.screenshot({ path: '.cache/studio-gif.png' })
  await page.click('.studio-gif')
  await page.waitForSelector('.studio-displays')
  check((await page.$('.studio-switch')) === null, 'a GIF has no sound switch')
  await place('FloatingA card in the air')
  objs = (await draft()).objects
  const gif = objs[objs.length - 1]
  check(gif.kind === 'video' && gif.gif === true && gif.sound === false && gif.loop === true, 'the GIF is placed, silent, looping')
  await click('.studio-selbtn', 'Delete')
  await idle()

  // drag the marker video: it slides on the square and stays on the wall
  const vid = objs[1]
  let vp = await page.evaluate((id) => window.__studio.screenPoint(id), vid.id)
  for (let i = 0; i < 6 && (await selectedNow()) !== vid.id; i++) {
    await page.touchscreen.tap(vp.x, vp.y)
    await wait(400)
  }
  await page.touchscreen.touchStart(vp.x, vp.y)
  for (let i = 1; i <= 10; i++) await page.touchscreen.touchMove(vp.x + i * 4, vp.y - i * 4)
  await page.touchscreen.touchEnd()
  await wait(600)
  const moved = (await draft()).objects.find((o) => o.id === vid.id).transform.position
  check(Math.abs(moved[2] + 0.496) < 0.001 && (moved[0] !== 0 || moved[1] !== 0.5), `marker video moves on the square only (${moved.map((v) => v.toFixed(2))})`)

  // two videos max; only one plays sound
  await click('.studio-selbtn', 'Duplicate')
  await idle()
  const sounds = (await draft()).objects.filter((o) => o.kind === 'video').map((o) => o.sound)
  check(sounds.length === 2 && sounds.filter(Boolean).length === 1, `two videos, only one with sound (${sounds})`)
  await click('.studio-fab')
  await click('.studio-tools button', 'Media')
  const input = await page.$('input[type=file]:not([capture])')
  await input.uploadFile(resolve('public/test/video.mp4'))
  await page.waitForFunction(() => document.querySelector('.studio-modal p')?.textContent.includes('videos'), { timeout: 20000 }).catch(() => {})
  check((await page.evaluate(() => document.querySelector('.studio-modal p')?.textContent ?? '')).includes('2 videos'), 'a third video is refused kindly')
  await click('.studio-modal .btn')
  await click('.studio-x')

  // A photo lying on a flat marker must stay visible from steep to grazing
  // angles with the AR camera's depth range (it was hidden by its own paper
  // border). Dev server only: imports the source modules directly.
  if (BASE.includes('localhost')) {
    const seen = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js')
      const { buildScene, addLights, makeShadowCatcher } = await import('/src/scene/buildScene.ts')
      const { applyPlacement } = await import('/src/ar/placement.ts')
      const r = new THREE.WebGLRenderer({ preserveDrawingBuffer: true })
      r.setSize(100, 100)
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x00ff00)
      const anchor = new THREE.Group()
      anchor.scale.setScalar(1000) // MindAR units: the marker's width in pixels
      const content = new THREE.Group()
      addLights(content)
      content.add(makeShadowCatcher())
      anchor.add(content)
      scene.add(anchor)
      const h = await buildScene({ version: 1, id: 'p', title: '', background: { color: '#fff' }, objects: [{ id: 'v', kind: 'image', src: '/test/photo.jpg', width: 0.9, frame: true, display: 'marker', transform: { position: [0, 0.5, -0.496], rotation: [0, 0, 0], scale: 1 } }] })
      content.add(h.root)
      applyPlacement(content, h.root, 'flat')
      const cam = new THREE.PerspectiveCamera(45, 1, 10, 100000)
      const px = new Uint8Array(4)
      const white = []
      for (const elev of [60, 45, 30, 20, 12]) {
        const e = THREE.MathUtils.degToRad(elev)
        cam.position.set(0, -Math.cos(e) * 2500, Math.sin(e) * 2500)
        cam.up.set(0, 0, 1)
        cam.lookAt(0, 0, 0)
        r.render(scene, cam)
        r.getContext().readPixels(50, 50, 1, 1, 0x1908, 0x1401, px)
        if (px[0] > 240 && px[1] > 240 && px[2] > 240) white.push(elev) // the paper, not the photo
      }
      r.dispose()
      return white
    })
    check(seen.length === 0, `a photo on a flat marker stays visible from 60° to 12° (hidden at: ${seen.join(', ') || 'none'})`)
  }

  // Cloud saving of photos and videos: uploaded, then freed from the phone.
  const mediaId = await page.evaluate(() => document.querySelector('.studio').dataset.sceneId)
  const mediaCount = await count()
  const mediaSrcs = (await draft()).objects.filter((o) => o.src?.startsWith('media:')).map((o) => o.src.slice(6))
  await click('.studio-icon[aria-label="Back to My scenes"]')
  await page.waitForSelector(`.scenes-card[data-id="${mediaId}"][data-cloud="saved"]`, { timeout: 30000 }).catch(() => {})
  check((await page.$(`.scenes-card[data-id="${mediaId}"][data-cloud="saved"]`)) !== null, 'the media scene reaches the cloud')
  const served = await page.evaluate(async (ids) => Promise.all(ids.map(async (id) => {
    const r = await fetch(`/api/media/${id}`, { headers: { Range: 'bytes=0-9' } })
    return r.status
  })), mediaSrcs)
  check(mediaSrcs.length >= 2 && served.every((s) => s === 206), `its photos and videos are in the cloud, with byte ranges (${served.join(', ')})`)
  const left = await page.evaluate(() => new Promise((res) => {
    const req = indexedDB.open('inrl', 1)
    req.onsuccess = () => {
      const all = req.result.transaction('media').objectStore('media').getAllKeys()
      all.onsuccess = () => res(all.result.length)
    }
  }))
  check(left === 0, `the phone's copies are freed once uploaded (${left} left)`)
  check((await page.$$('.scenes-card')).length === 2, 'My scenes lists both scenes')

  // Delete the first scene: gone at once, Undo brings it back; then for good (and from the cloud).
  await click(`.scenes-card[data-id="${firstId}"] .scenes-del`)
  await wait(200)
  check((await page.$$('.scenes-card')).length === 1 && (await page.$('.scenes-toast')) !== null, 'delete removes the card at once and offers Undo')
  await page.screenshot({ path: '.cache/studio-scenes-deleted.png' })
  await click('.scenes-toast button', 'Undo')
  await wait(200)
  check((await page.$$('.scenes-card')).length === 2, 'Undo brings it back')
  check((await cloud(`/api/scenes/${firstId}`)).status === 200, 'and the cloud copy was kept')
  await click(`.scenes-card[data-id="${firstId}"] .scenes-del`)
  await wait(5600)
  inCloud = await cloud(`/api/scenes/${firstId}`)
  check(inCloud.status === 404, `after 5 s it is deleted from the cloud too (${inCloud.status})`)

  // Reopen the media scene: photos and videos now load from the cloud.
  await click(`.scenes-card[data-id="${mediaId}"] .scenes-open`)
  await page.waitForSelector('.studio')
  await idle()
  check((await count()) === mediaCount, `the media scene reopens from cloud media (${await count()} of ${mediaCount} objects)`)
  await page.screenshot({ path: '.cache/studio-media-cloud.png' })

  // Preview on the marker (fake camera showing the test marker).
  if (camArgs.length) {
    // A steady phone pitched down at the table, reported 60 times a second (headless Chrome has no sensor).
    await page.evaluate(() => {
      window.__beta = 45
      setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 10, beta: window.__beta, gamma: 0 })), 16)
    })
    // → opens New Post; its "Try it on the test marker first" link opens the preview.
    await click('.studio-icon[aria-label="Post it"]')
    await page.waitForSelector('.studio-frame-next')
    await click('.studio-frame-next')
    await page.waitForSelector('.np-preview')
    await click('.np-preview')
    await page.waitForSelector('.look-sheet .btn-primary')
    await page.click('.look-sheet .btn-primary')
    await page.waitForFunction(() => document.querySelector('.look')?.dataset.phase === 'tracking', { timeout: 60000 }).catch(() => {})
    check((await page.evaluate(() => document.querySelector('.look').dataset.phase)) === 'tracking', 'preview finds the marker')
    await wait(2500)
    await page.screenshot({ path: '.cache/studio-preview-ar.png' })
    const playing = await page.evaluate(() => Number(document.querySelector('.look').dataset.videosPlaying))
    check(playing >= 1, `videos play in the preview (${playing} playing)`)
    check((await page.evaluate(() => document.querySelector('.look').dataset.gyro)) === 'true', 'the gyroscope steadies the scene')
    // "Copy report": the phone's own steadiness measurements
    await page.evaluate(() => {
      window.__clip = ''
      navigator.clipboard.writeText = (t) => ((window.__clip = t), Promise.resolve())
    })
    await click('.studio-lock .look-chip', 'Copy report')
    await wait(200)
    const report = await page.evaluate(() => window.__clip)
    if (process.env.DEBUG) console.log(report)
    check(/Tracker wobble \(raw\): tilt \d/.test(report) && /Marker in camera: ~\d+ px/.test(report), 'Copy report measures the tracker on the phone')
    // Upright marker (same trick as test:ar): the scene should show exactly the editor's layout.
    const placementFor = async (beta) => {
      await page.evaluate((b) => (window.__beta = b), beta)
      await wait(1800)
      return page.evaluate(() => document.querySelector('.look').dataset.placement)
    }
    await placementFor(45)
    check((await placementFor(-50)) === 'vertical', 'preview switches to an upright marker')
    await page.screenshot({ path: '.cache/studio-preview-vertical.png' })
  } else console.log('skip AR preview (no .cache/fakecam.y4m; see the ar-testing skill)')
} finally {
  await browser.close()
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('\nInStudio test passed. Screenshots in .cache/studio-*.png')
