// Checks personal markers (src/marker): draws a few, compiles them with
// MindAR, counts feature points and makes sure the QR code reads, straight
// on and seen at an angle. Runs the real browser code in headless Chrome
// through the Vite dev server, so start `npm run dev` first (or let this
// script start it).
//
//   node scripts/marker-check.mjs                    # 6 sample markers → .cache/markers/
//   node scripts/marker-check.mjs --compare          # also compile at 1024 / 768 / 512
//   node scripts/marker-check.mjs --out a.png --seed s --username u --url https://…/m/code
//                                                    # one marker: a.png + a.mind
//   node scripts/marker-check.mjs --fakecam .cache/fakecam-personal.y4m [--expect url] [--mind .cache/markers/sample.mind]
//                                                    # QR decode rate on a fake camera video (+ MindAR tracking)
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEV = process.env.DEV_URL ?? 'http://localhost:5173'
const OUT_DIR = '.cache/markers'

const args = process.argv.slice(2)
const arg = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const flag = (name) => args.includes(`--${name}`)

async function up() {
  try {
    return (await fetch(DEV)).ok
  } catch {
    return false
  }
}

let devServer = null
if (!(await up())) {
  console.log('Starting the dev server…')
  devServer = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { stdio: 'ignore', detached: true })
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500))
  if (!(await up())) throw new Error('Dev server did not start')
}

const fakecam = arg('fakecam')
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--enable-unsafe-swiftshader',
    ...(fakecam
      ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${resolve(fakecam)}`]
      : []),
  ],
})

const b64 = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64')

try {
  const page = await browser.newPage()
  page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()))
  page.on('pageerror', (e) => console.error('[page]', e.message))
  // A blank page on the dev server's origin (not the app), so Vite serves our TS modules.
  const blank = `${DEV}/__marker-check`
  await page.setRequestInterception(true)
  page.on('request', (req) =>
    req.url() === blank ? req.respond({ contentType: 'text/html', body: '<!doctype html><title>marker check</title>' }) : req.continue(),
  )
  await page.goto(blank)

  if (fakecam) {
    const expect = arg('expect') ?? 'http://localhost:5173/m/sample1'
    const r = await page.evaluate(async (expect) => {
      const { QrReader } = await import('/src/marker/qr.ts')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      await video.play()
      const reader = new QrReader()
      let frames = 0, ok = 0, wrong = 0, ms = 0
      const byMode = [0, 0] // reads alternate: whole frame, centre
      const end = performance.now() + 6000
      while (performance.now() < end) {
        await new Promise((res) => requestAnimationFrame(res))
        const t = performance.now()
        const text = reader.read(video)
        ms += performance.now() - t
        frames++
        if (text === expect) {
          ok++
          byMode[(frames - 1) % 2]++
        } else if (text) wrong++
      }
      stream.getTracks().forEach((t) => t.stop())
      return { frames, ok, wrong, byMode, msPerRead: ms / frames, size: `${video.videoWidth}x${video.videoHeight}` }
    }, expect)
    console.log(`Fake camera ${fakecam} (${r.size}): QR read on ${r.ok}/${r.frames} frames (${Math.round((100 * r.ok) / r.frames)}%), ${r.wrong} wrong, ${r.msPerRead.toFixed(1)} ms per read (whole frame ${r.byMode[0]}/${Math.ceil(r.frames / 2)}, centre ${r.byMode[1]}/${Math.floor(r.frames / 2)})`)
    if (r.ok / r.frames < 0.5) process.exitCode = 1

    // With --mind: does MindAR find and follow the marker on this video?
    const mind = arg('mind')
    if (mind) {
      const t = await page.evaluate(async (mindUrl) => {
        const { Controller } = await import('/node_modules/mind-ar/dist/mindar-image.prod.js')
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
        const video = document.createElement('video')
        video.muted = true
        video.playsInline = true
        video.srcObject = stream
        await video.play()
        // MindAR draws the video at its width/height attributes.
        video.setAttribute('width', String(video.videoWidth))
        video.setAttribute('height', String(video.videoHeight))
        let found = 0, lost = 0, first = null, frames = 0
        const t0 = performance.now()
        const controller = new Controller({
          inputWidth: video.videoWidth,
          inputHeight: video.videoHeight,
          onUpdate: (d) => {
            if (d.type === 'processDone') frames++
            if (d.type !== 'updateMatrix') return
            if (d.worldMatrix) {
              found++
              first ??= performance.now() - t0
            } else lost++
          },
        })
        await controller.addImageTargets(mindUrl)
        await controller.dummyRun(video)
        controller.processVideo(video)
        await new Promise((res) => setTimeout(res, 8000))
        controller.stopProcessVideo()
        stream.getTracks().forEach((tr) => tr.stop())
        return { found, lost, first, frames }
      }, '/' + mind.replace(/^\.?\//, ''))
      console.log(`MindAR on ${fakecam} with ${mind}: ${t.found} tracked poses over ${t.frames} processed frames in 8 s, first after ${t.first == null ? 'never' : Math.round(t.first) + ' ms'}, ${t.lost} lost`)
      if (!t.found) process.exitCode = 1
    }
  } else {
    const single = arg('out')
    const jobs = single
      ? [{ seed: arg('seed') ?? 'sample', username: arg('username') ?? 'nico', url: arg('url') ?? 'http://localhost:5173/m/sample1' }]
      : [
          { seed: 'k7f2q9xa', username: 'nico', url: 'https://inrl2.marine-469.workers.dev/m/k7f2q9xa' },
          { seed: 'b3m8w1zr', username: 'juloaxel', url: 'https://inrl2.marine-469.workers.dev/m/b3m8w1zr' },
          { seed: 'p0c4t6yd', username: 'marine', url: 'https://inrl2.marine-469.workers.dev/m/p0c4t6yd' },
          { seed: 'h9n5r2ve', username: 'the.long.username_2026', url: 'https://inrl2.marine-469.workers.dev/m/h9n5r2ve' },
          { seed: 'x1a7g3uk', username: 'zo', url: 'https://inrl2.marine-469.workers.dev/m/x1a7g3uk' },
          { seed: 'test', username: 'inrl', url: 'https://inrl2.pages.dev/m/test' },
        ]
    const sizes = flag('compare') ? [1024, 768, 512] : [null]
    const results = await page.evaluate(
      async (jobs, sizes) => {
        const { drawMarker } = await import('/src/marker/artwork.ts')
        const { compileMarker, MIN_MATCHING, COMPILE_SIZE } = await import('/src/marker/compile.ts')
        const { QrReader } = await import('/src/marker/qr.ts')
        const qrReader = new QrReader()
        // Two calls: the reader alternates between whole frame and centre.
        const reader = { read: (c) => qrReader.read(c) ?? qrReader.read(c) }
        const toB64 = (bytes) => {
          let bin = ''
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          return btoa(bin)
        }
        // The marker lying on a table seen from ~45°, in a 640×480 frame:
        // a trapezoid drawn strip by strip, then blurred.
        const squash = (src, blur) => {
          const W = 640, H = 480
          const tmp = document.createElement('canvas')
          tmp.width = W
          tmp.height = H
          const t = tmp.getContext('2d')
          t.fillStyle = '#967A5C'
          t.fillRect(0, 0, W, H)
          const top = 210, bottom = 400, topW = 200, botW = 360
          const rho = botW / topW
          // Perspective: rows bunch up towards the far edge.
          const u = (f) => f / (rho - f * (rho - 1))
          const strips = 256
          for (let i = 0; i < strips; i++) {
            const f0 = i / strips, f1 = (i + 1) / strips
            const sy0 = Math.floor(f0 * src.height)
            const sy1 = Math.max(sy0 + 1, Math.floor(f1 * src.height))
            const u0 = u(f0), u1 = u(f1)
            const dy0 = top + u0 * (bottom - top), dy1 = top + u1 * (bottom - top)
            const w = topW + ((u0 + u1) / 2) * (botW - topW)
            t.drawImage(src, 0, sy0, src.width, sy1 - sy0, (W - w) / 2, dy0, w, dy1 - dy0 + 0.6)
          }
          const out = document.createElement('canvas')
          out.width = W
          out.height = H
          const o = out.getContext('2d')
          o.filter = `blur(${blur}px)`
          o.drawImage(tmp, 0, 0)
          return out
        }
        const res = []
        for (const job of jobs) {
          const canvas = await drawMarker({ seed: job.seed, username: job.username, url: job.url })
          const again = await drawMarker({ seed: job.seed, username: job.username, url: job.url })
          const same = canvas.toDataURL() === again.toDataURL()
          const compiles = []
          for (const s of sizes) {
            const c = await compileMarker(canvas, undefined, s ?? COMPILE_SIZE)
            compiles.push({ size: s ?? COMPILE_SIZE, matching: c.matching, tracking: c.tracking, ms: c.ms, bytes: c.mind.length, mind: toB64(c.mind) })
          }
          const straight = reader.read(canvas)
          const small = document.createElement('canvas')
          small.width = small.height = 360
          small.getContext('2d').drawImage(canvas, 0, 0, 360, 360)
          const sq0 = reader.read(squash(canvas, 0.6))
          const sq1 = reader.read(squash(canvas, 1.2))
          const sqView = squash(canvas, 1.2).toDataURL('image/png')
          res.push({
            ...job,
            same,
            png: canvas.toDataURL('image/png'),
            squashPng: sqView,
            compiles,
            qr: { straight: straight === job.url, small360: reader.read(small) === job.url, angled: sq0 === job.url, angledBlur: sq1 === job.url },
          })
        }
        return { res, MIN_MATCHING }
      },
      jobs,
      sizes,
    )

    await mkdir(OUT_DIR, { recursive: true })
    let failed = false
    for (const r of results.res) {
      const main = r.compiles.find((c) => c.size === 768) ?? r.compiles[0]
      const pngPath = single ?? `${OUT_DIR}/${r.seed}.png`
      await mkdir(dirname(pngPath), { recursive: true })
      await writeFile(pngPath, b64(r.png))
      if (single) await writeFile(pngPath.replace(/\.png$/, '') + '.mind', Buffer.from(main.mind, 'base64'))
      else await writeFile(`${OUT_DIR}/${r.seed}-angled.png`, b64(r.squashPng))
      const pts = r.compiles.map((c) => `${c.size}px: ${c.matching} matching / ${c.tracking} tracking, ${c.ms} ms, ${(c.bytes / 1024).toFixed(0)} KB`).join(' | ')
      const qr = Object.entries(r.qr).map(([k, v]) => `${k} ${v ? 'ok' : 'FAIL'}`).join(', ')
      console.log(`${r.seed.padEnd(9)} @${r.username}: ${pts}\n          QR: ${qr}; same picture on redraw: ${r.same ? 'yes' : 'NO'}`)
      if (r.compiles.some((c) => c.matching < results.MIN_MATCHING) || !r.qr.straight || !r.qr.angled || !r.same) failed = true
    }

    if (!single) {
      // Contact sheet of all markers.
      const sheet = await page.evaluate(async (pngs) => {
        const cell = 340, gap = 12, cols = 3
        const rows = Math.ceil(pngs.length / cols)
        const c = document.createElement('canvas')
        c.width = cols * cell + (cols + 1) * gap
        c.height = rows * cell + (rows + 1) * gap
        const ctx = c.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, c.width, c.height)
        for (let i = 0; i < pngs.length; i++) {
          const img = new Image()
          img.src = pngs[i]
          await img.decode()
          ctx.drawImage(img, gap + (i % cols) * (cell + gap), gap + Math.floor(i / cols) * (cell + gap), cell, cell)
        }
        return c.toDataURL('image/png')
      }, results.res.map((r) => r.png))
      await writeFile(`${OUT_DIR}/contact-sheet.png`, b64(sheet))
      console.log(`PNGs and contact sheet in ${OUT_DIR}/`)
    } else {
      console.log(`Wrote ${single} and ${single.replace(/\.png$/, '')}.mind`)
    }
    if (failed) {
      console.error('Some markers failed (points below minimum, QR unreadable, or not reproducible).')
      process.exitCode = 1
    }
  }
} finally {
  await browser.close()
  if (devServer) process.kill(-devServer.pid)
}
