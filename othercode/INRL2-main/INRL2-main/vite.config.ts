import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { giphyResponse, type GifPage } from './worker/giphy.ts'
import { cloudResponse, type CloudEnv } from './worker/cloud.ts'
import { accountResponse } from './worker/accounts.ts'
import { publishResponse } from './worker/publish.ts'
import { socialResponse } from './worker/social.ts'
import { commentsResponse } from './worker/comments.ts'
import { safetyResponse } from './worker/safety.ts'
import { apiRoute } from './worker/routes.ts'

/*
 * /api/giphy during development, like the Cloudflare worker does live.
 * With GIPHY_KEY in the environment it asks GIPHY; without one it answers
 * with test GIFs made from public/test, so the editor and its automated
 * test work offline.
 */
function giphyDev(): Plugin {
  return {
    name: 'inrl-giphy-dev',
    configureServer(server) {
      server.middlewares.use('/api/giphy', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        let body: string
        if (process.env.GIPHY_KEY) {
          const r = await giphyResponse(new Request(`http://localhost/api/giphy${url.search}`), process.env.GIPHY_KEY)
          res.statusCode = r.status
          body = await r.text()
        } else {
          const q = url.searchParams.get('q') ?? ''
          const page: GifPage = {
            gifs: Array.from({ length: 6 }, (_, i) => ({
              id: `test-${q || 'trending'}-${i}`,
              title: `${q || 'Trending'} test GIF ${i + 1}`,
              width: i % 2 ? 480 : 360,
              height: i % 2 ? 270 : 360,
              mp4: '/test/video.mp4',
              preview: '/test/photo.jpg',
            })),
            next: null,
          }
          body = JSON.stringify(page)
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(body)
      })
    },
  }
}

/*
 * Cloud saving, accounts and publishing (/api/scenes, /api/media, /api/auth,
 * /api/me, /api/posts, /api/markers, /api/m) during development: the
 * worker's own code with a local SQLite file for D1 and a folder for R2,
 * both in .cache/dev-cloud (delete it to start over).
 */
function cloudDev(): Plugin {
  let env: Promise<CloudEnv> | null = null
  return {
    name: 'inrl-cloud-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const route = req.url ? apiRoute(req.url.split('?')[0]) : null
        if (!route) return next()
        env ??= import('./worker/devCloud.ts').then(async ({ devDatabase, devBucket }) => ({
          DB: await devDatabase('.cache/dev-cloud/db.sqlite'),
          MEDIA: devBucket('.cache/dev-cloud/r2'),
          // As on the live site (wrangler.jsonc), plus the automated tests' admin when they ask for one.
          ADMINS: process.env.ADMINS ?? 'nico',
        }))
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
        const method = req.method ?? 'GET'
        const body = method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks)
        // The real address (with its port): passkeys check the page's origin.
        const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, { method, headers, body })
        const handler = { cloud: cloudResponse, accounts: accountResponse, publish: publishResponse, social: socialResponse, comments: commentsResponse, safety: safetyResponse }[route]
        const r = await handler(request, await env)
        res.statusCode = r.status
        r.headers.forEach((v, k) => res.setHeader(k, v))
        res.end(Buffer.from(await r.arrayBuffer()))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), giphyDev(), cloudDev()],
})
