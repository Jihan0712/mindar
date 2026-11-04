// Generates the step-1 test marker: busy, non-repeating artwork (what MindAR
// tracks) with a QR code in the middle (what will identify the owner later),
// then compiles it into the .mind file the AR viewer loads.
//
//   npm run marker [-- url]
//
// Drawing and compiling run in headless Chrome, with the same MindAR compiler
// the browser uses, so no native image libraries are needed.
// Marker rules: see docs/marker-guide.md.
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import QRCode from 'qrcode'
import puppeteer from 'puppeteer-core'

const url = process.argv[2] ?? 'https://inrl2.pages.dev/m/test'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const root = resolve('.')
const OUT = 'public/test'

// Tiny static server so the page can import MindAR's browser build.
const types = { '.js': 'text/javascript', '.html': 'text/html' }
const server = createServer(async (req, res) => {
  if (req.url === '/') return res.end('<!doctype html><title>marker</title>')
  try {
    const body = await readFile(join(root, decodeURIComponent(req.url.split('?')[0])))
    res.writeHead(200, { 'content-type': types[extname(req.url)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
}).listen(0)
const port = server.address().port

const qr = await QRCode.toDataURL(url, { errorCorrectionLevel: 'Q', margin: 0, width: 300, color: { dark: '#063137', light: '#FFFFFF' } })
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage()
  page.on('console', (m) => m.type() === 'error' && console.error(m.text()))
  await page.goto(`http://localhost:${port}/`)
  const result = await page.evaluate(async (qrDataUrl) => {
    const SIZE = 1024
    // Seeded random so the marker is identical every time it is regenerated.
    let seed = 20261005
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
    const pick = (a) => a[Math.floor(rand() * a.length)]
    // Design-system colours, spread across the brightness range.
    const palette = ['#063137', '#3F7880', '#12A2B8', '#5697A0', '#E2D4CA', '#F0DD2B', '#384143', '#FFFFFF', '#DC191A', '#CED6D8']

    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#E1E8E9'
    ctx.fillRect(0, 0, SIZE, SIZE)
    // Large irregular blobs.
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = pick(palette)
      ctx.beginPath()
      const cx = rand() * SIZE, cy = rand() * SIZE, r = 30 + rand() * 120, n = 5 + Math.floor(rand() * 6)
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, rr = r * (0.5 + rand() * 0.7)
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
      }
      ctx.closePath()
      ctx.fill()
    }
    // Strokes and scribbles: corners for the tracker.
    for (let i = 0; i < 160; i++) {
      ctx.strokeStyle = pick(['#063137', '#FFFFFF', '#384143', '#F0DD2B'])
      ctx.lineWidth = 2 + rand() * 7
      ctx.beginPath()
      let x = rand() * SIZE, y = rand() * SIZE
      ctx.moveTo(x, y)
      for (let k = 0; k < 4; k++) { x += (rand() - 0.5) * 120; y += (rand() - 0.5) * 120; ctx.lineTo(x, y) }
      ctx.stroke()
    }
    // Small dots and squares of varied size.
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = pick(['#063137', '#FFFFFF', '#12A2B8', '#384143'])
      const s = 3 + rand() * 14
      if (rand() < 0.5) { ctx.beginPath(); ctx.arc(rand() * SIZE, rand() * SIZE, s / 2, 0, Math.PI * 2); ctx.fill() }
      else ctx.fillRect(rand() * SIZE, rand() * SIZE, s, s)
    }
    // QR code on a white rounded card in the centre.
    const qrSize = 300, card = qrSize + 48, c0 = (SIZE - card) / 2
    ctx.fillStyle = '#FFFFFF'
    ctx.beginPath(); ctx.roundRect(c0, c0, card, card, 20); ctx.fill()
    const qrImg = new Image()
    qrImg.src = qrDataUrl
    await qrImg.decode()
    ctx.drawImage(qrImg, (SIZE - qrSize) / 2, (SIZE - qrSize) / 2, qrSize, qrSize)
    // Thin border so people know where to cut.
    ctx.strokeStyle = '#063137'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, SIZE - 6, SIZE - 6)

    const png = canvas.toDataURL('image/png')
    const img = new Image()
    img.src = png
    await img.decode()
    const { Compiler } = await import('/node_modules/mind-ar/dist/mindar-image.prod.js')
    const compiler = new Compiler()
    await compiler.compileImageTargets([img], () => {})
    const bytes = new Uint8Array(compiler.exportData())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const t = compiler.data[0]
    return {
      png,
      mind: btoa(bin),
      matching: t.matchingData.reduce((n, d) => n + d.maximaPoints.length + d.minimaPoints.length, 0),
      tracking: t.trackingData.reduce((n, d) => n + d.points.length, 0),
    }
  }, qr)

  await writeFile(`${OUT}/marker.png`, Buffer.from(result.png.split(',')[1], 'base64'))
  const mind = Buffer.from(result.mind, 'base64')
  await writeFile(`${OUT}/marker.mind`, mind)
  console.log(`marker.png + marker.mind (${mind.length} bytes): ${result.matching} matching / ${result.tracking} tracking points. QR → ${url}`)
  // Same quality gate as the old admin panel: under ~250 matching points a
  // marker detects slowly or not at all once printed.
  if (result.matching < 250) {
    console.error('Too few matching points: rework the artwork.')
    process.exitCode = 1
  }
} finally {
  await browser.close()
  server.close()
}
