// Automated step-6 check: INRL of a post on a real surface (Figma A4 / A41),
// in headless Chrome. A fake iPhone test app stands in for ARKit: it sends
// camera frames (a phone 1.2 m up, looking down at a table in front) the way
// ios/FloorTest does, and records what the page asks of it.
//
//  - A test account publishes three posts; another opens the first from the
//    feed, then INRL: /p/<id>/inrl, the camera starts ('ready').
//  - No surface yet: "Point at a table or the floor…"; a surface under the aim:
//    "Tap to place"; a tap drops the scene (anchor + haptic sent), it draws.
//  - The strip: tapping a neighbour drops that post's scene in the same
//    spot, at the size set by pinching; the author line follows.
//  - Menu: Place again, Copy test report. IN3D goes back to the post viewer
//    on the post showing and stops the camera ('stop').
//  - Opened from Safari in the app (`?list=`): the strip is rebuilt.
//  - One AR view: a marker's QR in the camera → the app is asked to follow
//    its artwork; once seen, the post sits on it (flat, then upright), the
//    surface scene goes; "Place on a surface instead" goes back (the same QR
//    is ignored while in sight). The feed's Scan opens this view.
//  - Outside the app: an iPhone gets "Open in the InRL test app" (a link
//    that carries the path and the phone key).
// Screenshots: .cache/inrl-*.png. Look at them.
//
//   npm run dev   (in another terminal)
//   npm run test:inrl        (URL=… to test another server)
import { mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = (process.env.URL ?? 'http://localhost:5173').replace(/\/$/, '')
mkdirSync('.cache', { recursive: true })

const problems = []
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) problems.push(what)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const stamp = Date.now().toString(36)
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'

/** The fake app: bridge version 2, messages recorded, frames sent by `__fakeAr`. */
const FAKE_APP = () => {
  window.__inrlNativeApp = { version: 2 }
  window.__msgs = []
  window.webkit = { messageHandlers: { inrl: { postMessage: (m) => window.__msgs.push(m) } } }
  // A phone at (0, 1.2, 1.2) looking at the table's centre (0, 0, 0); `surface` says whether ARKit found it.
  window.__fakeAr = { surface: false }
  const e = [0, 1.2, 1.2]
  const norm = (v) => {
    const l = Math.hypot(...v)
    return v.map((x) => x / l)
  }
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const z = norm(e)
  const x = norm(cross([0, 1, 0], z))
  const y = cross(z, x)
  const cam = [...x, 0, ...y, 0, ...z, 0, ...e, 1]
  setInterval(() => {
    if (!window.__inrlNative) return
    const a = innerWidth / innerHeight
    const f = 1 / Math.tan((60 * Math.PI) / 360)
    const n = 0.01
    const far = 100
    const proj = [f / a, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + n) / (n - far), -1, 0, 0, (2 * far * n) / (n - far), 0]
    const hit = window.__fakeAr.surface ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : null
    // The marker artwork, once the page asked to follow it and the test "shows" it.
    const asked = window.__msgs.filter((m) => m.type === 'trackImage' || m.type === 'clearImage').pop()
    const img = window.__fakeAr.image
    const image = asked?.type === 'trackImage' && img && img.id === asked.id ? img : null
    window.__inrlNative.frame({ cam, proj, hit, anchor: null, image, track: 'normal', planes: hit ? 1 : 0, light: 1000, sent: Date.now() })
  }, 16)
}

/** Pixels the scene covers on the AR canvas (the page itself is transparent). */
const drawn = (page) => page.evaluate(() => {
  const s = window.__floorStage
  if (!s) return -1
  s.renderer.render(s.scene, s.camera)
  const gl = s.renderer.getContext()
  const w = gl.drawingBufferWidth
  const h = gl.drawingBufferHeight
  const px = new Uint8Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
  let n = 0
  for (let i = 3; i < px.length; i += 16) if (px[i] > 0) n++
  return n
})

async function phone(browser, { app = false, ua } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  if (ua) await page.setUserAgent(ua)
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && console.log('  console:', m.text()))
  if (app) await page.evaluateOnNewDocument(FAKE_APP)
  const cdp = await page.createCDPSession()
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => (localStorage.clear(), localStorage.setItem('inrl.test', '1')))
  const click = (sel, text) => page.evaluate((s, t) => {
    const el = [...document.querySelectorAll(s)].find((b) => !t || b.textContent.trim() === t)
    el?.click()
    return !!el
  }, sel, text)
  const api = (path, method = 'GET', body) => page.evaluate(async (p, m, b) => {
    const headers = { 'X-InRL-Owner': localStorage.getItem('inrl.owner') ?? '', 'Content-Type': 'application/json', 'X-InRL-Test': '1' }
    const r = await fetch(p, { method: m, headers, body: b && JSON.stringify(b) })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, path, method, body)
  return { page, click, api }
}

async function signUp({ page, click }, name, username) {
  await page.goto(`${BASE}/welcome?next=/`, { waitUntil: 'networkidle0' })
  await click('.wl-sheet .btn-primary')
  await page.waitForSelector('.wl-form')
  await page.type('input[name=name]', name)
  await page.type('input[name=username]', username)
  await page.waitForFunction(() => !document.querySelector('.wl-form .btn-primary')?.disabled, { timeout: 5000 }).catch(() => {})
  await click('.wl-form .btn-primary')
  await page.waitForSelector('.wl-hello', { timeout: 15000 }).catch(() => {})
  await click('.wl-hello .btn-primary')
  await page.waitForSelector('.feed', { timeout: 15000 }).catch(() => {})
}

const scene = (text, color) => ({
  version: 1,
  id: `it${stamp}`,
  background: { color },
  objects: [{ id: 'txt', kind: 'text', text, style: 'candy', transform: { position: [0, 0.05, 0.1], rotation: [0, 0, 0], scale: 1 } }],
})

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--enable-unsafe-swiftshader'] })
let tidy = null
try {
  const a = await phone(browser)
  await signUp(a, 'Ana Inrl', `ia${stamp}`)
  const ids = []
  for (const [text, color] of [['ONE', '#F0DD2B'], ['TWO', '#12A2B8'], ['THREE', '#FF3B3C']]) {
    const r = await a.api('/api/posts', 'POST', { scene: scene(text, color), caption: `Inrl ${text}` })
    if (r.status === 200) ids.push(r.body.post.id)
  }
  check(ids.length === 3, 'a test account published three posts')
  tidy = async () => {
    for (const id of ids) await a.api(`/api/posts/${id}`, 'DELETE')
  }
  const newest = [...ids].reverse()

  // ---------------------------------------------- in the (fake) test app
  const b = await phone(browser, { app: true })
  const { page, click } = b
  await signUp(b, 'Bo Inrl', `ib${stamp}`) // (test accounts only see each other)
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await page.waitForSelector(`.feed-card[data-id="${newest[0]}"]`, { timeout: 15000 }).catch(() => {})
  await click(`.feed-card[data-id="${newest[0]}"]`)
  await page.waitForSelector(`.pv[data-post="${newest[0]}"]`, { timeout: 15000 }).catch(() => {})
  await click('.mode-pill button', 'INRL')
  await page.waitForSelector('.inrl', { timeout: 15000 }).catch(() => {})
  check(page.url().endsWith(`/p/${newest[0]}/inrl`), 'INRL in a post opens /p/<id>/inrl')
  check((await page.evaluate(() => window.__msgs.some((m) => m.type === 'ready'))), 'the page asks the app for the camera (ready)')
  check((await page.evaluate(() => window.__msgs.find((m) => m.type === 'aim')?.y)) === 0.6, 'it aims below the middle of the screen (aim 0.6)')
  check((await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgba(0, 0, 0, 0)', 'the page is see-through (camera underneath)')
  await wait(500)
  check((await page.$eval('.inrl-hint', (e) => e.textContent).catch(() => '')).startsWith('Point at a marker, or at a table or the floor'), 'no surface yet: “Point at a marker, or at a table or the floor…”')
  await page.evaluate(() => (window.__fakeAr.surface = true))
  await page.waitForFunction(() => document.querySelector('.inrl')?.dataset.phase === 'aiming', { timeout: 5000 }).catch(() => {})
  check((await page.$eval('.inrl-hint', (e) => e.textContent).catch(() => '')) === 'Tap to place, or point at a marker', 'a surface found: “Tap to place, or point at a marker”')
  check((await drawn(page)) > 0, 'the aim mark shows on the surface')
  await page.screenshot({ path: '.cache/inrl-aiming.png' })

  await page.waitForFunction((id) => document.querySelector('.inrl')?.dataset.showing === id, { timeout: 15000 }, newest[0]).catch(() => {})
  await page.touchscreen.tap(195, 420)
  await wait(600)
  check((await page.$eval('.inrl', (e) => e.dataset.phase)) === 'placed', 'a tap places the scene')
  check((await page.evaluate(() => ['anchor', 'haptic'].every((t) => window.__msgs.some((m) => m.type === t)))), 'the app is told where (anchor) and buzzes (haptic)')
  check((await page.$('.inrl-hint')) === null, 'the hint is gone once placed')
  const placedPixels = await drawn(page)
  check(placedPixels > 2000, `the scene stands on the table (${placedPixels} pixels)`)
  check((await page.$eval('.inrl-info .pv-name', (e) => e.textContent).catch(() => '')) === 'Ana Inrl' && (await page.$eval('.inrl-caption', (e) => e.textContent).catch(() => '')) === 'Inrl THREE', 'author and caption above the strip')
  await page.screenshot({ path: '.cache/inrl-placed.png' })

  // ----------------------------------------------------------- the strip
  const where = () => page.evaluate(() => {
    const p = window.__floorStage.place
    return p && { x: +p.pos.x.toFixed(3), z: +p.pos.z.toFixed(3), unit: +window.__floorStage.unit.toFixed(2) }
  })
  await page.evaluate(() => window.__floorStage.setUnit(0.8)) // as if pinched
  const before = await where()
  check((await page.$$('.pv-strip button')).length >= 3, 'the strip holds the feed’s posts')
  await page.evaluate((id) => document.querySelector(`.pv-strip button[data-id="${id}"]`)?.click(), newest[1])
  await page.waitForFunction((id) => document.querySelector('.inrl')?.dataset.showing === id, { timeout: 15000 }, newest[1]).catch(() => {})
  check(page.url().endsWith(`/p/${newest[1]}/inrl`), 'tapping a thumbnail moves to that post')
  await wait(500)
  check(JSON.stringify(await where()) === JSON.stringify(before), 'the next scene drops in the same spot, at the same size')
  check((await page.$eval('.inrl', (e) => e.dataset.phase)) === 'placed', 'still placed (no new tap needed)')
  check((await drawn(page)) > 2000, 'the new scene draws')
  check((await page.$eval('.inrl-caption', (e) => e.textContent).catch(() => '')) === 'Inrl TWO', 'the caption follows')
  await page.screenshot({ path: '.cache/inrl-swapped.png' })
  for (const id of [newest[2], newest[0], newest[1]]) {
    await page.evaluate((i) => document.querySelector(`.pv-strip button[data-id="${i}"]`)?.click(), id)
    await page.waitForFunction((i) => document.querySelector('.inrl')?.dataset.showing === i, { timeout: 15000 }, id).catch(() => {})
  }
  check((await page.$eval('.inrl', (e) => e.dataset.showing)) === newest[1], 'swiping back and forth keeps up')

  // ---------------------------------------------------------------- menu
  await click('.pv-top button[aria-label="Menu"]')
  check(JSON.stringify(await page.$$eval('.inrl-menu button', (bs) => bs.map((x) => x.textContent))) === '["Place again","Copy test report","Close"]', 'menu: Place again, Copy test report, Close')
  await click('.inrl-menu button', 'Place again')
  await wait(300)
  check((await page.$eval('.inrl', (e) => e.dataset.phase)) !== 'placed' && (await page.evaluate(() => window.__msgs.some((m) => m.type === 'clearAnchor'))), 'Place again: back to aiming')
  await page.touchscreen.tap(195, 420)
  await wait(400)

  // ----------------------------------------------------------- IN3D / back
  await click('.mode-pill button', 'IN3D')
  await page.waitForSelector(`.pv[data-post="${newest[1]}"]:not(.inrl)`, { timeout: 15000 }).catch(() => {})
  check(page.url().endsWith(`/p/${newest[1]}`), 'IN3D goes back to the post viewer, on the post showing')
  check((await page.evaluate(() => window.__msgs.some((m) => m.type === 'stop'))), 'the camera stops (stop)')
  check((await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) !== 'rgba(0, 0, 0, 0)', 'the page is opaque again')

  // Opened from Safari (the `open` link): the strip comes from ?list=.
  await page.goto(`${BASE}/p/${newest[2]}/inrl?list=${newest.join(',')}&from=safari`, { waitUntil: 'networkidle0' })
  await page.waitForFunction((id) => document.querySelector('.inrl')?.dataset.showing === id, { timeout: 15000 }, newest[2]).catch(() => {})
  check((await page.$$eval('.pv-strip button', (bs) => bs.map((x) => x.dataset.id))).join() === newest.join(), 'opened by link: the strip is rebuilt from ?list=')
  await click('.pv-top button[aria-label="Back"]')
  await wait(500)
  check((await page.evaluate(() => window.__msgs.find((m) => m.type === 'openSafari')?.url)) === `${BASE}/p/${newest[2]}`, 'opened from Safari: ← sends you back to Safari on that post')
  check(page.url().endsWith(`/p/${newest[2]}`), '…and the app rests on the post (IN3D)')
  // A shared link (no list): the strip holds the author's posts, and keeps them going back to IN3D.
  await page.goto(`${BASE}/p/${newest[1]}/inrl`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelectorAll('.pv-strip button').length >= 3, { timeout: 15000 }).catch(() => {})
  check((await page.$$eval('.pv-strip button', (bs) => bs.map((x) => x.dataset.id))).filter((i) => ids.includes(i)).length === 3, 'opened with no list: the strip holds the author’s posts')
  await click('.mode-pill button', 'IN3D')
  await page.waitForSelector(`.pv[data-post="${newest[1]}"]:not(.inrl)`, { timeout: 15000 }).catch(() => {})
  check((await page.$$('.pv-strip button')).length >= 3, '…and IN3D keeps that strip')
  await click('.mode-pill button', 'INRL')
  await page.waitForSelector('.inrl', { timeout: 15000 }).catch(() => {})
  check((await page.$$('.pv-strip button')).length >= 3, '…and so does INRL again')
  // ------------------------------------------------- markers in the same view
  await page.goto(`${BASE}/p/${newest[0]}/inrl`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => (window.__fakeAr.surface = true))
  await page.waitForFunction((id) => document.querySelector('.inrl')?.dataset.showing === id, { timeout: 15000 }, newest[0]).catch(() => {})
  check((await page.$eval('.inrl-hint', (e) => e.textContent).catch(() => '')).includes('marker'), 'the hint mentions markers too')
  await page.touchscreen.tap(195, 420)
  await wait(400)
  await page.evaluate(() => window.__inrlNative.qr(`${location.origin}/m/test`))
  await wait(300)
  const track = await page.evaluate(() => window.__msgs.filter((m) => m.type === 'trackImage').pop())
  check(track?.id === 'test' && track.url.endsWith('/test/marker.png'), 'a marker’s QR → the app is asked to follow its artwork')
  check((await page.$eval('.inrl', (e) => e.dataset.phase)) === 'reading' && (await page.$eval('.inrl-hint', (e) => e.textContent).catch(() => '')).startsWith('Marker found'), '“Marker found: hold your phone steady on it”')
  await page.waitForFunction(() => document.querySelector('.inrl')?.dataset.showing === 'test', { timeout: 15000 }).catch(() => {})
  check(page.url().endsWith('/p/test/inrl'), 'the marker’s post becomes the post showing')
  // The app sees the artwork lying on the table in front.
  await page.evaluate(() => (window.__fakeAr.image = { id: 'test', m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -0.2, 1], w: 0.2, tracked: true }))
  await page.waitForFunction(() => document.querySelector('.inrl')?.dataset.phase === 'marker', { timeout: 5000 }).catch(() => {})
  await wait(600)
  check((await page.$eval('.inrl', (e) => e.dataset.phase)) === 'marker', 'the artwork seen: the scene is on the marker')
  check((await page.evaluate(() => window.__floorStage.place === null && window.__msgs.some((m) => m.type === 'clearAnchor'))), 'one scene at a time: the table scene left')
  check((await page.evaluate(() => window.__floorStage.marker?.placement)) === 'flat', 'a marker lying flat: the scene stands on it')
  check((await drawn(page)) > 2000, 'the marker’s scene draws')
  check((await page.$('.pv-actions button[aria-label="Sound on"]')) !== null, 'on a marker, a scene with a video has the sound button')
  await page.screenshot({ path: '.cache/inrl-marker-flat.png' })
  // Upright (on a wall, facing the phone).
  await page.evaluate(() => (window.__fakeAr.image = { id: 'test', m: [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0.3, -0.5, 1], w: 0.2, tracked: true }))
  await wait(400)
  check((await page.evaluate(() => window.__floorStage.marker?.placement)) === 'vertical', 'a marker on a wall: the scene stands upright in front of it')
  check((await drawn(page)) > 2000, 'the upright scene draws')
  await page.screenshot({ path: '.cache/inrl-marker-upright.png' })
  await page.touchscreen.tap(195, 420)
  await wait(300)
  check((await page.$eval('.inrl', (e) => e.dataset.phase)) === 'marker', 'a tap on a marker’s scene doesn’t place it on the table')
  await click('.pv-top button[aria-label="Menu"]')
  await click('.inrl-menu button', 'Place on a surface instead')
  await wait(400)
  check((await page.evaluate(() => window.__msgs.at(-1)?.type === 'clearAnchor' || window.__msgs.some((m) => m.type === 'clearImage'))) && ['finding', 'aiming'].includes(await page.$eval('.inrl', (e) => e.dataset.phase)), 'Place on a surface instead: back to aiming')
  await page.evaluate(() => window.__inrlNative.qr(`${location.origin}/m/test`))
  await wait(300)
  check(['finding', 'aiming'].includes(await page.$eval('.inrl', (e) => e.dataset.phase)), 'the same marker, still in sight, is ignored')
  await page.touchscreen.tap(195, 420)
  await wait(500)
  check((await page.$eval('.inrl', (e) => e.dataset.phase)) === 'placed' && (await drawn(page)) > 2000, 'a tap places it on the table again')

  // The feed's Scan, in the app: the same view, with the feed's posts.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.feed-card[data-id]', { timeout: 15000 }).catch(() => {})
  await click('.feed-scan')
  await page.waitForSelector('.inrl', { timeout: 15000 }).catch(() => {})
  check(/\/p\/[^/]+\/inrl$/.test(page.url()) && (await page.$$('.pv-strip button')).length >= 3, 'Scan (feed) opens the same AR view, with the feed in the strip')
  await click('.pv-top button[aria-label="Back"]')
  await page.waitForSelector('.feed', { timeout: 10000 }).catch(() => {})
  check(new URL(page.url()).pathname === '/', '← from Scan goes back to the feed')
  await b.page.browserContext().close()

  // ------------------------------------------------------ outside the app
  const c = await phone(browser, { ua: IPHONE_UA })
  await c.page.goto(`${BASE}/p/${newest[0]}`, { waitUntil: 'networkidle0' })
  await c.page.waitForSelector(`.pv[data-post="${newest[0]}"]`, { timeout: 15000 }).catch(() => {})
  await c.click('.mode-pill button', 'INRL')
  await c.page.waitForSelector('.inrl-elsewhere .look-sheet', { timeout: 10000 }).catch(() => {})
  const href = await c.page.$eval('.inrl-elsewhere a[href^="inrlfloor:"]', (e) => e.getAttribute('href')).catch(() => '')
  const key = await c.page.evaluate(() => localStorage.getItem('inrl.owner'))
  check(href.startsWith(`inrlfloor://open?path=${encodeURIComponent(`/p/${newest[0]}/inrl?list=`)}`) && href.includes(encodeURIComponent('&from=safari')) && href.endsWith(`#${key}`), 'iPhone Safari: “Open in the InRL test app” carries the post, its strip and the phone key')
  await c.page.screenshot({ path: '.cache/inrl-safari.png' })
} finally {
  await tidy?.().catch(() => {})
  await browser.close()
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('\nAll INRL checks passed.')
