// Automated AR check, run on a computer (no phone needed): opens the AR page
// in headless Chrome with a fake camera showing the marker, and fails unless
// the marker is recognised and the video and music start.
//
//   npm run dev                       (in another terminal)
//   python scripts/make-fake-camera.py public/test/marker.png .cache/fakecam.y4m
//   node scripts/ar-smoke-test.mjs    (writes .cache/ar-smoke.png)
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.URL ?? 'http://localhost:5173/ar'
const cam = resolve('.cache/fakecam.y4m')
if (!existsSync(cam)) throw new Error(`Missing ${cam}; run scripts/make-fake-camera.py first`)
mkdirSync('.cache', { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${cam}`, '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(URL, { waitUntil: 'networkidle0' })
  await page.click('button.btn-primary')
  await page.waitForFunction(() => document.querySelector('.ar')?.dataset.phase === 'tracking', { timeout: 60000 })
  await new Promise((r) => setTimeout(r, 2500))

  // Flat vs vertical markers. The fake camera shows the marker as if lying on
  // a table seen from ~45° above. With the phone pitched down 45° (beta 45,
  // as when really looking down at a table) that reads as flat; with the
  // phone pitched the other way (beta -50) the same picture means the marker
  // is standing up, so the scene must switch to upright.
  const placementFor = async (beta) => {
    await page.evaluate((b) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: b, gamma: 0 })), beta)
    await new Promise((r) => setTimeout(r, 1500))
    return page.$eval('.ar', (el) => el.dataset.placement)
  }
  const upright = await placementFor(45)
  const pitched = await placementFor(-50)
  await page.screenshot({ path: '.cache/ar-smoke-vertical.png' })
  const back = await placementFor(45)
  console.log(`placement: looking down at a table → ${upright}, marker read as upright → ${pitched}, table again → ${back}`)
  if (upright !== 'flat' || pitched !== 'vertical' || back !== 'flat') errors.push('flat/vertical placement did not switch as expected')

  await page.click('button[aria-label="Test details"]')
  const report = await page.$eval('.ar-debug dl', (el) => el.innerText)
  await page.click('button[aria-label="Test details"]')
  await page.screenshot({ path: '.cache/ar-smoke.png' })
  console.log(report)
  const lines = report.split('\n')
  const val = (k) => lines[lines.indexOf(k) + 1] ?? ''
  const problems = [
    ...errors.map((e) => `page error: ${e}`),
    !val('Video').startsWith('playing') && `video not playing (${val('Video')})`,
    !val('Music').startsWith('playing') && `music not playing (${val('Music')})`,
  ].filter(Boolean)
  if (problems.length) {
    console.error('\nFAILED:\n- ' + problems.join('\n- '))
    process.exitCode = 1
  } else console.log('\nPASSED: marker recognised, scene shown, video and music playing, flat/vertical placement switching.')
} finally {
  await browser.close()
}
