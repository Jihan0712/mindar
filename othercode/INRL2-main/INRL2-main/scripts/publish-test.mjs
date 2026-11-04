// Automated step-3 check: publish → marker → scan, in headless Chrome with a
// virtual passkey (Chrome's WebAuthn emulator) standing in for Face ID.
//
//  1. A scene in InStudio → → → New Post → "Sign in to publish" → Create my
//     account (name, user name, passkey) → Hello → back to New Post →
//     caption ("Show on my marker" on for a first post) → Post → Published
//     Successfully → the new post in IN3D; then the profile's Marker tab,
//     where the marker is drawn and compiled on the "phone".
//  2. Sign out, sign back in with the same passkey: the scene comes back.
//  3. A fake camera showing THAT personal marker (made from its PNG):
//     /m/<code> (the QR's link) → Open camera → the post appears on it;
//     then the feed's Scan button → the QR code is read → same marker tracked.
// Screenshots: .cache/publish-*.png. Look at them.
//
//   npm run dev   (in another terminal)
//   npm run test:publish        (URL=… to test another server)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = (process.env.URL ?? 'http://localhost:5173').replace(/\/$/, '')
const PY = existsSync('.cache/venv/bin/python') ? '.cache/venv/bin/python' : 'python3'
mkdirSync('.cache', { recursive: true })

const problems = []
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) problems.push(what)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const username = `t${Date.now().toString(36)}`

async function phone(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && console.log('  console:', m.text()))
  const click = (sel, text) => page.evaluate((s, t) => {
    const el = [...document.querySelectorAll(s)].find((b) => !t || b.textContent.trim() === t)
    el?.click()
    return !!el
  }, sel, text)
  const api = (path) => page.evaluate(async (p) => {
    const r = await fetch(p, { headers: { 'X-InRL-Owner': localStorage.getItem('inrl.owner') ?? '' } })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, path)
  return { page, click, api }
}

// ------------------------------------------------------------- 1. publish
let code = ''
let sceneId = ''
{
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--enable-unsafe-swiftshader'] })
  try {
    const { page, click, api } = await phone(browser)
    // A phone with Face ID: a platform authenticator that keeps passkeys and verifies the person.
    const cdp = await page.createCDPSession()
    await cdp.send('WebAuthn.enable')
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    })

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
    // A test phone: the account it makes stays out of real people's feeds.
    await page.evaluate(() => (localStorage.clear(), localStorage.setItem('inrl.test', '1')))
    await page.reload({ waitUntil: 'networkidle0' })
    check(await page.$eval('.bnav a[aria-label="Profile"]', (e) => e.getAttribute('href')) === '/welcome?next=/me', 'signed out: Profile in the bottom bar asks to sign in')

    // A scene with 3D text, a library object and a video on a screen.
    // Written straight into the phone's storage (works on the live site too); defaults are filled in on load.
    sceneId = await page.evaluate(() => {
      const id = `pt${Date.now().toString(36)}`
      const t = (position, scale = 1) => ({ position, rotation: [0, 0, 0], scale })
      const scene = {
        version: 1,
        id,
        title: '',
        background: { color: '#F0DD2B' },
        objects: [
          { id: 'txt', kind: 'text', text: 'HELLO', style: 'candy', transform: t([0, 0.05, 0.1]) },
          { id: 'obj', kind: 'item', item: 'chrome-heart', transform: t([-0.3, 0, 0.2], 1.5) },
          { id: 'vid', kind: 'video', src: '/test/video.mp4', width: 0.3, display: 'screen', screen: 'tv', transform: t([0.3, 0, -0.1]) },
        ],
      }
      const now = Date.now()
      localStorage.setItem(`inrl.scene.${id}`, JSON.stringify(scene))
      localStorage.setItem('inrl.scenes', JSON.stringify([{ id, title: '', updated: now, created: now, objects: 3, background: '#F0DD2B', cloud: 'pending' }]))
      localStorage.setItem('inrl.studio.tutorial', 'done')
      return id
    })
    await page.goto(`${BASE}/studio/edit/${sceneId}`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.querySelector('.studio')?.dataset.busy === 'false', { timeout: 30000 })
    await wait(800)
    check(await click('.studio-icon[aria-label="Post it"]'), '→ in the editor')
    await page.waitForSelector('.studio[data-framing="true"] .studio-frame', { timeout: 5000 }).catch(() => {})
    check((await page.$('.studio-frame')) !== null, '→ opens "Frame your shot"')
    await wait(600)
    await page.screenshot({ path: '.cache/publish-frame.png' })
    // Turn the view a little with a finger, then Reset back to InRL's framing.
    await page.touchscreen.touchStart(150, 450)
    await page.touchscreen.touchMove(220, 430)
    await page.touchscreen.touchEnd()
    await click('.studio-frame .look-chip', 'Reset')
    await click('.studio-frame-next')
    await page.waitForSelector('.np')
    check((await page.$('.np-picture img')) !== null, 'New Post shows the scene picture')
    await page.screenshot({ path: '.cache/publish-newpost.png' })
    check((await page.$eval('.np-actions .btn-primary', (b) => b.textContent)) === 'Sign in to post', 'not signed in: "Sign in to post"')
    await click('.np-actions .btn-primary')
    await page.waitForSelector('.wl-splash')
    await page.screenshot({ path: '.cache/publish-welcome.png' })

    // Create my account → name + user name → passkey.
    await click('.wl-sheet .btn-primary')
    await page.waitForSelector('.wl-form')
    await page.type('input[name=name]', 'Test Person')
    await page.type('input[name=username]', username)
    await page.waitForFunction(() => !document.querySelector('.wl-form .btn-primary')?.disabled, { timeout: 5000 }).catch(() => {})
    await page.screenshot({ path: '.cache/publish-profile.png' })
    await click('.wl-form .btn-primary')
    await page.waitForSelector('.wl-hello', { timeout: 15000 }).catch(() => {})
    check((await page.$('.wl-hello')) !== null, 'passkey made: "Hello"')
    await page.screenshot({ path: '.cache/publish-hello.png' })
    check((await api('/api/me')).body?.account?.username === username, `signed in as @${username}`)
    await click('.wl-hello .btn-primary')
    await page.waitForSelector('.np')

    // Post with a caption: a first post goes on the marker by default.
    await page.type('.np-caption textarea', 'Hello from the test')
    check((await page.$eval('.np-count', (e) => e.textContent)) === '19/150', 'caption counter')
    await page.waitForFunction(() => document.querySelector('.np-switch input')?.checked, { timeout: 5000 }).catch(() => {})
    check(await page.$eval('.np-switch input', (e) => e.checked), 'first post: "Show on my marker" starts on')
    check((await page.$eval('.np-actions .btn-primary', (b) => b.textContent)) === 'Post', 'signed in: "Post"')
    await click('.np-actions .btn-primary')
    await page.waitForSelector('.published', { timeout: 30000 }).catch(() => {})
    check((await page.$('.published')) !== null, 'Published Successfully')
    await page.screenshot({ path: '.cache/publish-published.png' })
    await wait(2000)
    check((await page.$('.published')) !== null, 'it stays up for a moment')
    await page.waitForSelector('.pv[data-post]', { timeout: 10000 }).catch(() => {})
    check(/\/p\/[a-z0-9]+$/.test(page.url()), 'then lands on the new post')
    await page.waitForSelector('.pv[data-ready="true"]', { timeout: 20000 }).catch(() => {})
    check((await page.$('.pv[data-ready="true"]')) !== null, 'in IN3D')
    await page.screenshot({ path: '.cache/publish-landed.png' })

    // The Marker tab makes the marker (draw + compile on the phone).
    await page.goto(`${BASE}/me?tab=marker`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.pf[data-tab="marker"]', { timeout: 10000 })
    const t0 = Date.now()
    await page.waitForSelector('.pf-art > img', { timeout: 180000 }).catch(() => {})
    check((await page.$('.pf-art > img')) !== null, `marker made on the phone (${((Date.now() - t0) / 1000).toFixed(1)} s in headless Chrome)`)
    await wait(1000)
    await page.screenshot({ path: '.cache/publish-marker-tab.png' })
    const mine = (await api('/api/me/marker')).body?.marker
    code = mine?.code ?? ''
    check(!!mine?.ready && mine.matching >= 250, `marker ready (code ${code}, ${mine?.matching} matching points)`)
    const shown = await api(`/api/m/${code}`)
    check(shown.body?.post?.caption === 'Hello from the test' && shown.body?.owner?.username === username, '/api/m/<code> shows the post and its owner')
    const v = shown.body?.post?.scene?.view
    check(!!v && v.dist > 0 && v.hfov > 0, 'the post keeps its framed camera (IN3D opens on it)')

    // The marker PNG, for the fake camera below.
    const png = await page.evaluate(async (src) => {
      const b = new Uint8Array(await (await fetch(src)).arrayBuffer())
      let s = ''
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
      return btoa(s)
    }, mine.image)
    writeFileSync('.cache/publish-marker.png', Buffer.from(png, 'base64'))

    // "Choose the post it shows" opens with the post.
    check(await click('.pf-actions .btn-secondary', 'Choose the post it shows'), 'Choose the post it shows')
    await page.waitForSelector('.pf-pick')
    check((await page.$$('.pf-pick button')).length === 1, 'the sheet lists the post')
    await page.screenshot({ path: '.cache/publish-edit-marker.png' })
    await click('.pf-sheet .btn-primary')
    await page.waitForSelector('.published', { timeout: 5000 }).catch(() => {})
    check((await page.$('.published')) !== null, 'Show this post → Published Successfully')
    await wait(1800)

    // Posts tab.
    await click('.pf-tabs button', 'Objects')
    await page.waitForSelector('.pf-post')
    check((await page.$$('.pf-post')).length === 1, 'the post is in the profile grid')
    await page.screenshot({ path: '.cache/publish-profile-posts.png' })

    // 2. Sign out → the phone forgets the scenes; sign in again → they come back.
    await click('.pf-icon[aria-label="Menu"]')
    await page.waitForSelector('.pf-sheet')
    await click('.pf-sheet .btn', 'Sign out on this phone')
    await page.waitForSelector('.feed', { timeout: 15000 })
    check((await page.evaluate(() => localStorage.getItem('inrl.scenes'))) === '[]', 'signing out clears the phone’s scenes (and goes to the feed)')
    const me = await api('/api/me')
    check(me.status === 401 || me.body?.account === null, 'signed out (the phone has no key until it needs one)')
    await page.goto(`${BASE}/welcome?next=/studio`, { waitUntil: 'networkidle0' })
    await click('.wl-sheet .btn-secondary')
    await page.waitForSelector('.wl-hello', { timeout: 15000 }).catch(() => {})
    check((await page.$('.wl-hello')) !== null, 'signed in again with the same passkey')
    await click('.wl-hello .btn-primary')
    await page.waitForSelector('.scenes-card', { timeout: 15000 }).catch(() => {})
    check((await page.$(`.scenes-card[data-id="${sceneId}"]`)) !== null, 'the scene comes back from the account')
  } finally {
    await browser.close()
  }
}

// ------------------------------------------------------------- 3. scan
if (code) {
  console.log('making a fake camera of the personal marker…')
  execFileSync(PY, ['scripts/make-fake-camera.py', '.cache/publish-marker.png', '.cache/fakecam-publish.y4m'], { stdio: 'inherit' })
  const cam = resolve('.cache/fakecam-publish.y4m')
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${cam}`],
  })
  try {
    const { page, click } = await phone(browser)
    const sensor = () => page.evaluate(() => setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 10, beta: 45, gamma: 0 })), 16))

    // The QR's link, as the phone's normal camera opens it.
    await page.goto(`${BASE}/m/${code}`, { waitUntil: 'networkidle0' })
    await sensor()
    await page.waitForSelector('.mv-sheet .btn-primary')
    await page.screenshot({ path: '.cache/publish-scan-intro.png' })
    check((await page.$eval('.mv-sheet h1', (e) => e.textContent)).includes('Test Person'), 'the marker page names its owner')
    await click('.mv-sheet .btn-primary')
    await page.waitForFunction(() => document.querySelector('.mv')?.dataset.phase === 'tracking', { timeout: 60000 }).catch(() => {})
    check((await page.evaluate(() => document.querySelector('.mv').dataset.phase)) === 'tracking', '/m/<code>: the personal marker is tracked')
    await wait(3000)
    check((await page.evaluate(() => Number(document.querySelector('.mv').dataset.videosPlaying))) >= 1, 'the post’s video plays on the marker')
    await page.screenshot({ path: '.cache/publish-scan-ar.png' })

    // IN3D (no INART page since 2026-10-07).
    check(JSON.stringify(await page.$$eval('.mode-pill button', (bs) => bs.map((b) => b.textContent))) === '["IN3D","INRL"]', 'the switch offers IN3D and INRL')
    await click('.mode-pill button', 'IN3D')
    await wait(2500)
    await page.screenshot({ path: '.cache/publish-scan-in3d.png' })

    // A post's INRL (outside the iPhone test app) offers its author's marker on that post.
    const shown = await page.evaluate((c) => fetch(`/api/m/${c}`).then((r) => r.json()), code)
    await page.goto(`${BASE}/p/${shown.post.id}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector(`.pv[data-post="${shown.post.id}"]`, { timeout: 15000 }).catch(() => {})
    await click('.mode-pill button', 'INRL')
    await page.waitForSelector('.inrl-elsewhere .look-sheet', { timeout: 10000 }).catch(() => {})
    await page.evaluate(() => [...document.querySelectorAll('.inrl-elsewhere button')].find((b) => b.textContent.includes('marker'))?.click())
    await page.waitForSelector(`.mv[data-post="${shown.post.id}"]`, { timeout: 20000 }).catch(() => {})
    check(page.url().endsWith(`/m/${code}?post=${shown.post.id}`) && (await page.evaluate(() => document.querySelector('.mv')?.dataset.post)) === shown.post.id, 'a post’s INRL → “See it on …’s marker” opens the author’s marker on that post')

    // In-app scan: the camera reads the QR code inside the artwork.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
    await sensor()
    await click('.feed-scan')
    await page.waitForFunction(() => document.querySelector('.mv')?.dataset.code, { timeout: 30000 }).catch(() => {})
    check((await page.evaluate(() => document.querySelector('.mv')?.dataset.code)) === code, 'Scan (feed, top right) reads the QR code in the artwork')
    await page.waitForFunction(() => document.querySelector('.mv')?.dataset.phase === 'tracking', { timeout: 60000 }).catch(() => {})
    check((await page.evaluate(() => document.querySelector('.mv').dataset.phase)) === 'tracking', 'Scan: then tracks that marker')
    await wait(2500)
    await page.screenshot({ path: '.cache/publish-scan-inapp.png' })
  } finally {
    await browser.close()
  }
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('\nPublish → marker → scan: all good.')
