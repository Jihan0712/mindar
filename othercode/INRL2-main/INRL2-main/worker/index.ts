/*
 * Serves the app's static files, adding what Cloudflare's static hosting
 * lacks: byte-range responses. iPhone Safari asks for video and audio in
 * pieces ("Range: bytes=…") and won't play media served whole, which is
 * what broke video on iOS in the earlier INRL prototype.
 *
 * Only media paths and /api/* reach this code (see run_worker_first in
 * wrangler.jsonc); everything else is served by Cloudflare directly.
 * /api/giphy is the GIF search (worker/giphy.ts); /api/scenes and
 * /api/media are cloud saving (worker/cloud.ts); /api/auth and /api/me are
 * accounts (worker/accounts.ts); posts and markers are publishing
 * (worker/publish.ts); the feed, follows, likes… are the social layer
 * (worker/social.ts), comments (worker/comments.ts), blocks and reports (worker/safety.ts).
 * `apiRoute()` says which module answers.
 */

import { accountResponse } from './accounts.ts'
import { commentsResponse } from './comments.ts'
import { safetyResponse } from './safety.ts'
import { cloudResponse, type Bucket, type Database } from './cloud.ts'
import { giphyResponse } from './giphy.ts'
import { publishResponse } from './publish.ts'
import { socialResponse } from './social.ts'
import { apiRoute } from './routes.ts'
import { parseRange } from './range.ts'

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  /** Cloudflare secret, entered by Nico (never in the repo). */
  GIPHY_KEY?: string
  /** R2 bucket inrl2-media: people's photos and videos. */
  MEDIA?: Bucket
  /** D1 database inrl2-media: saved scenes. */
  DB?: Database
  /** User names allowed to handle reports (wrangler.jsonc vars). */
  ADMINS?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/api/giphy') return giphyResponse(request, env.GIPHY_KEY)
    const route = apiRoute(path)
    if (route === 'cloud') return cloudResponse(request, env)
    if (route === 'accounts') return accountResponse(request, env)
    if (route === 'publish') return publishResponse(request, env)
    if (route === 'social') return socialResponse(request, env)
    if (route === 'comments') return commentsResponse(request, env)
    if (route === 'safety') return safetyResponse(request, env)
    if (path.startsWith('/api/')) return new Response('Not found', { status: 404 })
    const range = request.headers.get('Range')
    // Ask for the whole file: the assets service may ignore Range itself.
    const plain = new Request(request.url, { method: request.method === 'HEAD' ? 'HEAD' : 'GET' })
    const res = await env.ASSETS.fetch(plain)
    if (res.status !== 200) return res

    const headers = new Headers(res.headers)
    headers.set('Accept-Ranges', 'bytes')
    if (!range) return new Response(res.body, { status: 200, headers })

    const body = await res.arrayBuffer()
    const size = body.byteLength
    const r = parseRange(range, size)
    if (r === 'invalid' || !r) {
      headers.set('Content-Range', `bytes */${size}`)
      headers.delete('Content-Length')
      return new Response(null, { status: 416, headers })
    }
    headers.set('Content-Range', `bytes ${r.start}-${r.end}/${size}`)
    headers.set('Content-Length', String(r.end - r.start + 1))
    return new Response(request.method === 'HEAD' ? null : body.slice(r.start, r.end + 1), { status: 206, headers })
  },
}
