// Automated look-test check in AR: opens /look in headless Chrome with a fake
// camera showing the marker, switches to INRL, waits for the marker, then
// visits every world/variant and fails on page errors or a missing scene.
// Screenshots: .cache/look-ar-<world>-<variant>.png. Frame rates in headless
// Chrome are software rendering and mean nothing; only the iPhone's count.
//
//   npm run dev   (in another terminal)
//   node scripts/look-ar-test.mjs        (URL=… to test the live site)
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.URL ?? 'http://localhost:5173/look'
const cam = resolve('.cache/fakecam.y4m')
if (!existsSync(cam)) throw new Error(`Missing ${cam}; run scripts/make-fake-camera.py first`)
mkdirSync('.cache', { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${cam}`, '--enable-unsafe-swiftshader'],
})
const problems = []
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
  await page.goto(URL, { waitUntil: 'networkidle0' })
  const clickText = (sel, text) => page.evaluate((s, t) => [...document.querySelectorAll(s)].find((b) => b.textContent === t)?.click(), sel, text)
  await clickText('.mode-pill button', 'INRL')
  await page.waitForSelector('.look-sheet .btn-primary')
  await page.click('.look-sheet .btn-primary')
  await page.waitForFunction(() => document.querySelector('.look')?.dataset.phase === 'tracking', { timeout: 60000 })

  const runs = [['Streetwear', 'Sharp chrome'], ['Streetwear', 'Liquid chrome'], ['Bubblegum', 'Candy'], ['Bubblegum', 'Foil'], ['Designers', 'Collage']]
  for (const [world, variant] of runs) {
    await clickText('.look-worlds button', world)
    await new Promise((r) => setTimeout(r, 200))
    if (variant) await clickText('.look-chip', variant)
    await page.waitForFunction(() => document.querySelector('.look')?.dataset.building === 'false', { timeout: 30000 })
    await new Promise((r) => setTimeout(r, 2500))
    const name = `.cache/look-ar-${world}-${variant ?? 'collage'}.png`.toLowerCase().replace(/ /g, '-')
    await page.screenshot({ path: name })
    const state = await page.evaluate(() => ({ phase: document.querySelector('.look').dataset.phase, fps: document.querySelector('.look-fps')?.innerText }))
    console.log(`${world} / ${variant ?? 'Collage'}: ${state.phase}, ${state.fps} → ${name}`)
    if (state.phase !== 'tracking') problems.push(`${world}: marker lost (${state.phase})`)
    const tri = Number(/(\d+)k tri/.exec(state.fps ?? '')?.[1] ?? 0)
    if (tri < 5) problems.push(`${world}: nothing drawn (${state.fps})`)
  }
} finally {
  await browser.close()
}
if (problems.length) {
  console.error('\nFAILED:\n- ' + problems.join('\n- '))
  process.exitCode = 1
} else console.log('\nPASSED: marker tracked, every world built and drawn in AR.')
