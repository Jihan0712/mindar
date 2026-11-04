// Saves the InStudio library thumbnails to public/studio/thumbs/<id>.png.
// Opens the hidden /studio/thumbs page in headless Chrome, which draws every
// library item and text style with the editor's lighting. Rerun after adding
// or changing library items.
//
//   npm run dev   (in another terminal)
//   npm run thumbs
import { mkdirSync, writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.URL ?? 'http://localhost:5173/studio/thumbs'
const OUT = 'public/studio/thumbs'

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('page error:', e.message))
  await page.goto(URL, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => window.__thumbs, { timeout: 30000 })
  const thumbs = await page.evaluate(() => window.__thumbs)
  mkdirSync(OUT, { recursive: true })
  for (const [name, url] of Object.entries(thumbs)) {
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'))
  }
  console.log(`Saved ${Object.keys(thumbs).length} thumbnails to ${OUT}/`)
} finally {
  await browser.close()
}
