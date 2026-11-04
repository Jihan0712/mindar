// Automated step-5 check (the social layer), in headless Chrome with virtual
// passkeys standing in for Face ID. Grows with each piece of step 5.
//
//  - Two test phones make accounts (marked as test accounts: real people
//    never see them); A publishes three posts.
//  - B's Home feed shows them; a card opens the post viewer (/p/<id>), which
//    opens straight in IN3D and counts a view; the feed's posts sit in a
//    strip at the bottom (swipe / tap), the 3D keeps every gesture, no bottom
//    bar; INRL outside the iPhone test app explains where table mode works
//    (the app itself: npm run test:inrl).
//  - Profiles: the author's name → their profile (pinned post big, others
//    two by two), Follow / Unfollow, Following tab, "+" on a post; Edit
//    Profile (picture placed in a circle, bio); delete your own post.
//  - Likes: the heart, double tap (a heart pops, never unlikes), "Reset
//    view" after turning; A's bell dot, Notifications (like, follow, Follow
//    Back), the dot clears.
//  - Comments: add, Reply (@name), Enter sends, like a comment; the post's
//    author hides / unhides; "… commented" in notifications.
//  - Discover: popular scenes, search people and captions.
//  - Report a post and a comment; block someone (gone both ways), unblock
//    from Blocked people; /admin closed to non-admins.
//  - The bottom bar: Search, Notifications, Profile; Create opens a new
//    scene in the editor, × comes back; My scenes from the profile.
//  - A signed-out phone (not a test phone) opens a shared post link, but
//    doesn't see test accounts in For You.
// Screenshots: .cache/social-*.png. Look at them.
//
//   npm run dev   (in another terminal)
//   npm run test:social        (URL=… to test another server)
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

/** A phone of its own (separate storage), optionally a test phone with a passkey. */
async function phone(browser, { test = true } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && console.log('  console:', m.text()))
  const cdp = await page.createCDPSession()
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await page.evaluate((t) => (localStorage.clear(), t && localStorage.setItem('inrl.test', '1')), test)
  const click = (sel, text) => page.evaluate((s, t) => {
    const el = [...document.querySelectorAll(s)].find((b) => !t || b.textContent.trim() === t)
    el?.click()
    return !!el
  }, sel, text)
  const api = (path, method = 'GET', body) => page.evaluate(async (p, m, b) => {
    const headers = { 'X-InRL-Owner': localStorage.getItem('inrl.owner') ?? '', 'Content-Type': 'application/json' }
    if (localStorage.getItem('inrl.test') === '1') headers['X-InRL-Test'] = '1'
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
  id: `st${stamp}`,
  background: { color },
  objects: [{ id: 'txt', kind: 'text', text, style: 'candy', transform: { position: [0, 0.05, 0.1], rotation: [0, 0, 0], scale: 1 } }],
})

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--enable-unsafe-swiftshader'] })
let tidy = null
try {
  // ---------------------------------------------------- two test accounts
  const a = await phone(browser)
  await signUp(a, 'Ana Social', `sa${stamp}`)
  check((await a.api('/api/me')).body?.account?.username === `sa${stamp}`, `A signed up as @sa${stamp}`)
  const ids = []
  for (const [text, color] of [['ONE', '#F0DD2B'], ['TWO', '#12A2B8'], ['THREE', '#FF3B3C']]) {
    const r = await a.api('/api/posts', 'POST', { scene: scene(text, color), caption: `Post ${text}` })
    if (r.status === 200) ids.push(r.body.post.id)
  }
  check(ids.length === 3, 'A published three posts')
  tidy = async () => {
    for (const id of ids) await a.api(`/api/posts/${id}`, 'DELETE')
    await a.api('/api/me/avatar', 'DELETE')
  }
  const newest = [...ids].reverse()

  const b = await phone(browser)
  await signUp(b, 'Bo Social', `sb${stamp}`)
  check((await b.api('/api/me')).body?.account?.username === `sb${stamp}`, `B signed up as @sb${stamp}`)

  // Anonymous reads (as someone who isn't signed in).
  const c0api = (path) => b.page.evaluate(async (p) => {
    const r = await fetch(p)
    return { status: r.status, body: await r.json().catch(() => null) }
  }, path)

  // ------------------------------------------------------------ the feed
  const { page, click } = b
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.feed-card[data-id]', { timeout: 15000 }).catch(() => {})
  // (On the live site other posts may rank in between, e.g. well-liked ones: only A's order is checked.)
  const cards = await page.$$eval('.feed-card[data-id]', (els) => els.map((e) => e.dataset.id))
  check(JSON.stringify(cards.filter((id) => ids.includes(id))) === JSON.stringify(newest), 'For You shows A’s posts, newest first')
  check((await page.$eval('.feed-card .feed-info p', (e) => e.textContent)).startsWith('Ana Social · '), 'cards show the author and how long ago')
  check((await page.$('.bnav a[aria-label="Home"][aria-current="page"]')) !== null, 'bottom bar: Home is active')
  await page.goto(`${BASE}/?tab=following`, { waitUntil: 'networkidle0' })
  check((await page.$eval('.feed-empty', (e) => e.textContent).catch(() => '')).includes('people you follow'), 'Following: nobody followed yet')
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.feed-card[data-id]')
  await page.screenshot({ path: '.cache/social-feed.png' })

  // ------------------------------------------------------ the post viewer
  await click(`.feed-card[data-id="${newest[0]}"]`)
  await page.waitForSelector(`.pv[data-post="${newest[0]}"]`, { timeout: 15000 }).catch(() => {})
  check(page.url().endsWith(`/p/${newest[0]}`), 'a card opens /p/<id>')
  check((await page.$eval('.pv-info .t-heading-16', (e) => e.textContent).catch(() => '')) === 'Ana Social', 'the viewer names the author')
  check((await page.$eval('.pv-caption', (e) => e.textContent).catch(() => '')) === 'Post THREE', 'and shows the caption')
  await wait(800)
  await page.screenshot({ path: '.cache/social-viewer.png' })
  check((await b.api(`/api/posts/${newest[0]}`)).body?.post?.views === 1, 'opening it counted one view')

  await page.waitForSelector('.pv[data-ready="true"] .look-stage canvas', { timeout: 15000 }).catch(() => {})
  check((await page.$('.pv[data-ready="true"] .look-stage canvas')) !== null, 'the post opens in IN3D (no INART page)')
  check(JSON.stringify(await page.$$eval('.mode-pill button', (bs) => bs.map((b) => b.textContent))) === '["IN3D","INRL"]', 'the switch offers IN3D and INRL')
  check((await page.$('.bnav')) === null, 'no bottom bar inside a post')
  check((await page.$$('.pv-strip button')).length >= 3, 'the feed’s posts in a strip at the bottom')

  // Scrolling the strip (a snapping carousel) or tapping a thumbnail changes the post; the 3D keeps every gesture.
  const swipe = async (dx) => {
    const y = 790
    await page.touchscreen.touchStart(195, y)
    // A slow, careful drag (a quick flick glides on with momentum, like on the iPhone).
    for (let k = 1; k <= 16; k++) {
      await page.touchscreen.touchMove(195 + (dx * k) / 16, y)
      await wait(30)
    }
    await wait(250)
    await page.touchscreen.touchEnd()
    await wait(1500)
  }
  await page.waitForSelector('.pv[data-ready="true"]', { timeout: 15000 }).catch(() => {})
  const box = await (await page.$('.pv-strip')).boundingBox()
  check(box && box.y > 700, 'the strip sits at the bottom of the screen')
  const strip = await page.$$eval('.pv-strip button', (els) => els.map((e) => e.dataset.id))
  const at0 = strip.indexOf(newest[0])
  await swipe(-80)
  check((await page.$(`.pv[data-post="${strip[at0 + 1]}"]`)) !== null, 'scroll the strip left one thumbnail: the next post')
  await swipe(-80)
  check((await page.$(`.pv[data-post="${strip[at0 + 2]}"]`)) !== null, 'again: the one after')
  await swipe(80)
  check((await page.$(`.pv[data-post="${strip[at0 + 1]}"]`)) !== null, 'scroll right: back to the previous one')
  check(await page.evaluate(() => {
    const el = document.querySelector('.pv-strip')
    const b = el.querySelector('button.is-active')
    return Math.abs(b.offsetLeft + b.offsetWidth / 2 - el.scrollLeft - el.clientWidth / 2) < 4
  }), 'the current thumbnail sits in the middle')
  await page.evaluate((id) => document.querySelector(`.pv-strip button[data-id="${id}"]`).click(), newest[0])
  await wait(1500)
  check((await page.$(`.pv[data-post="${newest[0]}"]`)) !== null, 'tap a thumbnail: that post')
  // One finger up and down over the 3D turns the scene; it doesn't change the post any more.
  await page.touchscreen.touchStart(195, 420)
  for (let y = 400; y >= 260; y -= 20) await page.touchscreen.touchMove(200, y)
  await page.touchscreen.touchEnd()
  await wait(600)
  check((await page.$(`.pv[data-post="${newest[0]}"]`)) !== null, 'dragging on the 3D turns it, same post')
  await page.waitForSelector('.pv[data-ready="true"]', { timeout: 15000 }).catch(() => {})
  await page.screenshot({ path: '.cache/social-in3d.png' })
  await click('.mode-pill button', 'INRL')
  await page.waitForSelector('.inrl-elsewhere .look-sheet', { timeout: 10000 }).catch(() => {})
  check(page.url().endsWith(`/p/${newest[0]}/inrl`) && (await page.$eval('.inrl-elsewhere h1', (e) => e.textContent).catch(() => '')) === 'See it on your table', 'INRL outside the test app: “See it on your table”')
  check((await page.$('.inrl-elsewhere a[href^="inrlfloor:"]')) === null && !(await page.$$eval('.inrl-elsewhere button', (bs) => bs.map((b) => b.textContent).join())).includes('marker'), 'not an iPhone, no marker: no app link, no marker button')
  await click('.inrl-elsewhere .btn', 'Back to IN3D')
  await page.waitForSelector(`.pv[data-post="${newest[0]}"]`, { timeout: 10000 }).catch(() => {})
  check(page.url().endsWith(`/p/${newest[0]}`), 'Back to IN3D returns to the post')

  // ------------------------------------------------ profiles and follows
  // From a feed card, the author's name opens their profile (G2).
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.feed-card[data-id]')
  await click(`.feed-card[data-id="${newest[0]}"] a.feed-who`)
  await page.waitForSelector('.pf-head .pf-name', { timeout: 15000 }).catch(() => {})
  check(new URL(page.url()).pathname === `/u/sa${stamp}`, 'the author’s name opens their profile')
  check((await page.$eval('.pf-name', (e) => e.textContent)) === 'Ana Social' && (await page.$eval('.pf-handle', (e) => e.textContent)) === `@sa${stamp}`, 'profile: name and @handle')
  check((await page.$$('.pf-post')).length === 3 && (await page.$('.pf-post.is-big')) !== null, 'their posts: the pinned one big, the others two by two')
  check((await page.$eval('.pf-post.is-big', (e) => e.dataset.id)) === newest[0], 'no marker: the newest is pinned')
  check((await page.$('.pf-more')) === null, 'no post options on someone else’s profile')
  await page.screenshot({ path: '.cache/social-their-profile.png' })
  check(await click('.pf-btn', 'Follow'), 'Follow')
  await wait(800)
  check((await page.$eval('[data-follow]', (e) => e.dataset.follow)) === 'on' && (await page.$eval('[data-count="followers"]', (e) => e.textContent)) === '1', 'Follow → Unfollow, 1 follower')
  await page.reload({ waitUntil: 'networkidle0' })
  check((await page.$eval('[data-follow]', (e) => e.textContent).catch(() => '')) === 'Unfollow', 'still followed after reloading (G21)')
  await page.goto(`${BASE}/?tab=following`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.feed-card[data-id]', { timeout: 10000 }).catch(() => {})
  check(JSON.stringify((await page.$$eval('.feed-card[data-id]', (els) => els.map((e) => e.dataset.id))).slice(0, 3)) === JSON.stringify(newest), 'Following shows the people you follow')
  await page.goto(`${BASE}/me`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.pf-stats')
  check((await page.$$eval('.pf-stats b', (els) => els.map((e) => e.textContent)))[1] === '1', 'your own profile: following 1')
  // Unfollow on the profile, follow again with the "+" on a post.
  await page.goto(`${BASE}/u/sa${stamp}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-follow]')
  await click('.pf-btn', 'Unfollow')
  await wait(800)
  check((await page.$eval('[data-follow]', (e) => e.dataset.follow)) === 'off', 'Unfollow')
  await page.goto(`${BASE}/p/${newest[0]}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.pv-follow', { timeout: 10000 }).catch(() => {})
  check(await click('.pv-follow'), 'a post shows "+" on the author’s picture')
  await wait(800)
  check((await page.$('.pv-follow')) === null && (await b.api(`/api/u/sa${stamp}`)).body?.profile?.followed === true, '"+" follows them')

  // A edits their profile: a picture placed in the circle, and a bio.
  const ap = a.page
  await ap.goto(`${BASE}/me`, { waitUntil: 'networkidle0' })
  await ap.waitForSelector('.pf-btn')
  await a.click('.pf-btn', 'Edit Profile')
  await ap.waitForSelector('.ep')
  const input = await ap.$('.ep input[type=file]')
  await input.uploadFile('public/test/photo.jpg')
  await ap.waitForSelector('.ep-crop img', { timeout: 5000 }).catch(() => {})
  check((await ap.$('.ep-crop img')) !== null, 'Edit Profile: the picture to place in the circle')
  await ap.evaluate(() => {
    const r = document.querySelector('.ep-zoom')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(r, '1.6')
    r.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await ap.type('.ep textarea', 'I make 3D scenes')
  await ap.screenshot({ path: '.cache/social-edit-profile.png' })
  await a.click('.ep .btn-primary')
  await ap.waitForFunction(() => !document.querySelector('.ep'), { timeout: 15000 }).catch(() => {})
  await wait(1000)
  check((await ap.$eval('.pf-bio', (e) => e.textContent).catch(() => '')) === 'I make 3D scenes', 'the bio shows on the profile')
  check((await ap.$('.pf-head .avatar img')) !== null, 'the picture shows on the profile')
  const av = (await a.api('/api/me')).body?.account?.avatar
  check(!!av && (await ap.evaluate((u) => fetch(u).then((r) => r.headers.get('content-type')), av)) === 'image/jpeg', 'saved as a JPEG')
  // A's own posts have options; delete one.
  check((await ap.$$('.pf-more')).length === 3, 'your own posts have •••')
  await ap.screenshot({ path: '.cache/social-own-profile.png' })
  await ap.evaluate((id) => document.querySelector(`.pf-post[data-id="${id}"] .pf-more`).click(), ids[0])
  await ap.waitForSelector('.pf-sheet[aria-label="Post options"]')
  await a.click('.pf-sheet .btn', 'Delete post')
  await a.click('.pf-sheet .btn', 'Delete it for good')
  await wait(1200)
  check((await ap.$(`.pf-post[data-id="${ids[0]}"]`)) === null && (await a.api(`/api/posts/${ids[0]}`)).status === 404, 'Delete post (two taps)')
  // B sees A's picture in the feed.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.feed-card[data-id]')
  const avBox = await page.$eval(`.feed-card[data-id="${newest[0]}"] .avatar img`, (e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height]).catch(() => [0, 0])
  check(avBox[0] > 20 && avBox[0] < 40 && avBox[1] < 40, 'the feed shows the author’s picture, in its small circle')

  // ------------------------------------------------ likes and notifications
  await page.goto(`${BASE}/p/${newest[0]}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.pv[data-ready="true"]', { timeout: 15000 }).catch(() => {})
  check(await click('.pv-like'), 'a post has a heart')
  await wait(800)
  check((await page.$eval('.pv-like', (e) => [e.getAttribute('aria-pressed'), e.textContent])).join() === 'true,1', 'like: red heart, 1')
  await click('.pv-like')
  await wait(800)
  check((await page.$eval('.pv-like', (e) => e.textContent)) === '0' && (await b.api(`/api/posts/${newest[0]}`)).body?.post?.likes === 0, 'tap again: unliked')
  // Double tap on the scene likes it (a heart pops).
  const dbl = async () => {
    for (let k = 0; k < 2; k++) {
      await page.touchscreen.tap(195, 380)
      await wait(90)
    }
  }
  await dbl()
  await wait(150)
  check((await page.$('.pv-pop')) !== null, 'double tap: a heart pops')
  await wait(1200)
  check((await b.api(`/api/posts/${newest[0]}`)).body?.post?.liked === true, 'double tap likes the post')
  await dbl()
  await wait(1200)
  check((await b.api(`/api/posts/${newest[0]}`)).body?.post?.likes === 1, 'double tap again keeps it liked (never unlikes)')
  // Turning the scene shows "Reset view".
  await page.touchscreen.touchStart(150, 420)
  for (let x = 170; x <= 300; x += 20) await page.touchscreen.touchMove(x, 420)
  await page.touchscreen.touchEnd()
  await wait(500)
  check(await click('.pv-reset'), 'after turning the scene: Reset view')
  await wait(300)
  check((await page.$('.pv-reset')) === null, 'Reset view goes away once used')
  await page.screenshot({ path: '.cache/social-liked.png' })

  // Comments (C12): B comments, replies, likes a comment.
  check(await click('.pv-count[aria-label="Comments"]'), 'a post has a comments button')
  await page.waitForFunction(() => /No comments|^$/.test(document.querySelector('.cm-muted')?.textContent ?? 'x') || document.querySelector('.cm-row'), { timeout: 10000 }).catch(() => {})
  check((await page.$eval('.cm-muted', (e) => e.textContent).catch(() => '')).includes('No comments yet'), 'Comments: empty at first')
  await page.type('.cm-input textarea', 'LOL CUTE!')
  await click('.cm-send')
  await page.waitForSelector('.cm-row', { timeout: 8000 }).catch(() => {})
  check((await page.$eval('.cm-row .cm-text', (e) => e.textContent).catch(() => '')) === 'LOL CUTE!', 'a comment is added')
  check((await page.$eval('.pv-count', (e) => e.textContent)) === '1', 'the post counts it')
  await click('.cm-acts button', 'Reply')
  check((await page.$eval('.cm-input textarea', (e) => e.value)) === `@sb${stamp} `, 'Reply starts with @name')
  await page.type('.cm-input textarea', 'me again')
  await page.keyboard.press('Enter')
  await wait(1200)
  check((await page.$$('.cm-row')).length === 2, 'Enter sends')
  await page.evaluate(() => document.querySelector('.cm-row .cm-like').click())
  await wait(800)
  check((await page.$eval('.cm-row .cm-like', (e) => [e.getAttribute('aria-pressed'), e.textContent])).join() === 'true,1', 'like a comment')
  check((await page.$$eval('.cm-row .cm-acts', (els) => els.map((e) => e.textContent))).every((t) => t === 'ReplyDelete'), 'your own comments: Reply, Delete (no Hide)')
  await page.screenshot({ path: '.cache/social-comments.png' })
  const cid = await page.$eval('.cm-row', (e) => e.dataset.id)
  await page.evaluate(() => document.querySelector('.cm-x').click())

  // A (the post's author) can hide B's comment; B then sees it dimmed, others don't.
  await ap.goto(`${BASE}/p/${newest[0]}`, { waitUntil: 'networkidle0' })
  await ap.waitForSelector('.pv-count')
  await a.click('.pv-count')
  await ap.waitForSelector('.cm-row', { timeout: 8000 }).catch(() => {})
  check(await ap.evaluate((id) => {
    const b = [...document.querySelectorAll(`.cm-row[data-id="${id}"] .cm-acts button`)].find((x) => x.textContent === 'Hide')
    b?.click()
    return !!b
  }, cid), 'the post’s author can Hide a comment')
  await wait(800)
  check((await ap.$eval(`.cm-row[data-id="${cid}"]`, (e) => e.classList.contains('is-hidden'))), 'hidden: dimmed for the author')
  check((await c0api(`/api/posts/${newest[0]}`)).body?.post?.comments === 1, 'hidden: no longer counted on the post')
  await ap.evaluate((id) => [...document.querySelectorAll(`.cm-row[data-id="${id}"] .cm-acts button`)].find((x) => x.textContent === 'Unhide')?.click(), cid)
  await wait(600)
  await ap.evaluate(() => document.querySelector('.cm-x').click())

  // A: the bell's dot, then Notifications (B liked a post, B follows A).
  await ap.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await ap.waitForSelector('[data-testid="bell-dot"]', { timeout: 8000 }).catch(() => {})
  check((await ap.$('[data-testid="bell-dot"]')) !== null, 'A: a dot on the bell')
  await a.click('.bnav a.bnav-bell')
  await ap.waitForSelector('.nt-row', { timeout: 10000 }).catch(() => {})
  const rows = await ap.$$eval('.nt-row', (els) => els.map((e) => [e.dataset.kind, e.querySelector('p').textContent]))
  check(rows.some(([k, t]) => k === 'like' && t.startsWith(`sb${stamp} liked your scene.`)), 'Notifications: "… liked your scene"')
  check(rows.some(([k, t]) => k === 'follow' && t.startsWith(`sb${stamp} started following you.`)), 'Notifications: "… started following you"')
  check(rows.some(([k, t]) => k === 'comment' && t.startsWith(`sb${stamp} commented: “`)), 'Notifications: "… commented: …"')
  check((await ap.$eval('.nt-title', (e) => e.textContent)) === 'Today', 'grouped under Today')
  await ap.screenshot({ path: '.cache/social-notifications.png' })
  check(await a.click('.nt-follow', 'Follow Back'), 'Follow Back')
  await wait(800)
  check((await ap.$eval('.nt-follow', (e) => e.textContent)) === 'Followed' && (await a.api(`/api/u/sb${stamp}`)).body?.profile?.followed === true, '→ Followed')
  check((await a.api('/api/notifications/new')).body?.new === false, 'opening Notifications clears the dot')
  check((await b.api('/api/notifications/new')).body?.new === true, 'B now has one (A followed back)')

  // -------------------------------------------------------------- Discover
  await page.goto(`${BASE}/discover`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.dc-card', { timeout: 10000 }).catch(() => {})
  check((await page.$('.dc-card.is-big')) !== null, 'Discover: popular scenes, the first one big')
  await page.type('.dc-search input', `sa${stamp}`)
  await page.waitForSelector('.dc-person', { timeout: 8000 }).catch(() => {})
  check((await page.$eval('.dc-person strong', (e) => e.textContent).catch(() => '')) === 'Ana Social', 'search finds a person by user name')
  await page.screenshot({ path: '.cache/social-discover.png' })
  await click('.dc-person')
  await page.waitForSelector('.pf-name', { timeout: 10000 }).catch(() => {})
  check(new URL(page.url()).pathname === `/u/sa${stamp}`, 'and opens their profile')
  await page.goto(`${BASE}/discover?q=${encodeURIComponent('Post TWO')}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.dc-card', { timeout: 8000 }).catch(() => {})
  check((await page.$$eval('.dc-card', (els) => els.map((e) => e.dataset.id))).includes(ids[1]), 'search finds a scene by its caption')
  await click(`.dc-card[data-id="${ids[1]}"]`)
  await page.waitForSelector(`.pv[data-post="${ids[1]}"]`, { timeout: 10000 }).catch(() => {})
  check((await page.$(`.pv[data-post="${ids[1]}"]`)) !== null, 'and opens it')

  // ------------------------------------------------------ report and block
  const chooseReason = async (pg) => {
    await pg.waitForSelector('.rp-reasons button')
    await pg.evaluate(() => document.querySelectorAll('.rp-reasons button')[0].click())
    await pg.evaluate(() => document.querySelector('.rp .btn-primary').click())
    await pg.waitForFunction(() => document.querySelector('.rp h2')?.textContent === 'Thanks for telling us', { timeout: 8000 }).catch(() => {})
    return pg.$eval('.rp h2', (e) => e.textContent).catch(() => '')
  }
  // B reports one of A's posts from its "•••".
  await page.goto(`${BASE}/p/${ids[1]}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.pv-top button[aria-label="More options"]', { timeout: 10000 }).catch(() => {})
  await click('.pv-top button[aria-label="More options"]')
  await page.waitForSelector('.rp')
  await click('.rp .btn', 'Report this post')
  check((await chooseReason(page)) === 'Thanks for telling us', 'report a post: why → Send → thanks')
  await page.screenshot({ path: '.cache/social-report.png' })
  // A reports B's comment.
  await ap.goto(`${BASE}/p/${newest[0]}`, { waitUntil: 'networkidle0' })
  await ap.waitForSelector('.pv-count')
  await a.click('.pv-count')
  await ap.waitForSelector('.cm-row', { timeout: 8000 }).catch(() => {})
  check(await a.click('.cm-acts button', 'Report'), 'others’ comments can be reported')
  check((await chooseReason(ap)) === 'Thanks for telling us', 'report a comment')
  check((await ap.$('.cm')) !== null, 'the comments stay open behind it')
  // B blocks A from A's profile: they disappear for each other.
  await page.goto(`${BASE}/u/sa${stamp}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.pf-top button[aria-label="More options"]')
  await click('.pf-top button[aria-label="More options"]')
  await click('.rp .btn', `Block @sa${stamp}`)
  await page.waitForSelector('.rp-danger')
  await click('.rp-danger')
  await page.waitForSelector('.pf-blocked', { timeout: 8000 }).catch(() => {})
  check((await page.$eval('.pf-blocked', (e) => e.textContent).catch(() => '')).startsWith(`You blocked @sa${stamp}`), 'Block → "You blocked …" on their profile')
  await page.screenshot({ path: '.cache/social-blocked.png' })
  const bFeed = (await b.api('/api/feed')).body.posts.map((x) => x.id)
  check(!bFeed.some((id) => ids.includes(id)), 'their posts leave your feed')
  check((await a.api(`/api/u/sb${stamp}`)).status === 404, 'and you can’t be found by them')
  check((await a.api(`/api/u/sb${stamp}`)).status === 404 && (await a.api('/api/follows/sb' + stamp, 'POST')).status === 403, 'they can’t follow you')
  // Unblock from the ☰ menu's Blocked people.
  await page.goto(`${BASE}/me`, { waitUntil: 'networkidle0' })
  await click('.pf-icon[aria-label="Menu"]')
  await click('.pf-sheet .btn', 'Blocked people')
  await page.waitForSelector('.pf-blockrow', { timeout: 8000 }).catch(() => {})
  check(await click('.pf-blockrow .pf-btn', 'Unblock'), 'Blocked people → Unblock')
  await wait(800)
  check((await b.api('/api/feed')).body.posts.some((x) => ids.includes(x.id)), 'their posts are back')
  check((await b.api('/api/me')).body?.account?.admin === false && !(await page.$('a[href="/admin"]')), 'not an admin: no Reports link')
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' })
  check((await page.$eval('.ad-muted', (e) => e.textContent).catch(() => '')).startsWith('Only InRL’s team'), '/admin is closed to others')

  // ------------------------------------------------------- the bottom bar
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  for (const [label, path] of [['Search', '/discover'], ['Notifications', '/notifications'], ['Profile', '/me']]) {
    // (The bell's label says when something is new.)
    await click(`.bnav a[aria-label^="${label}"]`)
    await wait(800)
    check(new URL(page.url()).pathname === path, `bottom bar: ${label} → ${path}`)
  }
  // Create: a fresh scene straight in the editor; × left untouched comes back here and keeps no empty draft.
  await page.evaluate(() => localStorage.setItem('inrl.studio.tutorial', 'done'))
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('inrl.scenes') ?? '[]').length)
  await click('.bnav a[aria-label="Create"]')
  await page.waitForSelector('.studio-icon[aria-label="Close"]', { timeout: 30000 }).catch(() => {})
  check(/^\/studio\/edit\//.test(new URL(page.url()).pathname), 'bottom bar: Create opens a new scene in the editor')
  await wait(1500)
  await click('.studio-icon[aria-label="Close"]')
  await wait(800)
  check(new URL(page.url()).pathname === '/me', '× goes back to where Create was tapped')
  check((await page.evaluate(() => JSON.parse(localStorage.getItem('inrl.scenes') ?? '[]').length)) === before, 'an untouched new scene is not kept')
  check(await click('.pf-drafts'), 'the profile links to My scenes')
  await wait(800)
  check(new URL(page.url()).pathname === '/studio', 'My scenes opens from the profile')
  await page.goto(`${BASE}/me`, { waitUntil: 'networkidle0' })
  await page.screenshot({ path: '.cache/social-profile.png' })

  // ------------------------------------- a real (non-test) signed-out phone
  const c = await phone(browser, { test: false })
  await c.page.goto(`${BASE}/p/${ids[1]}`, { waitUntil: 'networkidle0' })
  await c.page.waitForSelector(`.pv[data-post="${ids[1]}"]`, { timeout: 15000 }).catch(() => {})
  check((await c.page.$(`.pv[data-post="${ids[1]}"]`)) !== null, 'signed out: a shared post link opens')
  check((await c.page.$('.pv-follow')) !== null, 'signed out: the "+" is there (it asks to sign in)')
  await c.page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await wait(500)
  const seen = await c.page.$$eval('.feed-card[data-id]', (els) => els.map((e) => e.dataset.id))
  check(!seen.some((id) => ids.includes(id)), 'real people don’t see test accounts in For You')
  check((await c.page.$eval('.bnav a[aria-label="Profile"]', (e) => e.getAttribute('href'))) === '/welcome?next=/me', 'signed out: Profile asks to sign in')

} finally {
  // Tidy up, even after a crash: the test posts and picture go (the hidden test accounts stay).
  if (tidy) await tidy().catch(() => {})
  await browser.close()
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('\nAll social checks passed.')
