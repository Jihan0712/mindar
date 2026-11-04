/*
 * GIF search through GIPHY, on our side so the API key never reaches the
 * phone. `GET /api/giphy?q=cats&offset=0` searches; without `q` it returns
 * trending GIFs. Results are trimmed to what InStudio needs: the MP4 for 3D
 * (smoother and lighter than GIF, decision 2026-10-05) and a small animated
 * preview for the picker.
 *
 * Used by the Cloudflare worker (worker/index.ts, key in the GIPHY_KEY
 * secret) and by the dev server (vite.config.ts, key from the environment or
 * test fixtures without one).
 */

export interface Gif {
  id: string
  title: string
  width: number
  height: number
  /** Looping MP4 used in the scene. */
  mp4: string
  /** Small animated preview for the picker grid. */
  preview: string
}

export interface GifPage {
  gifs: Gif[]
  /** Offset for the next page, or null at the end. */
  next: number | null
}

const PAGE = 24
/** Content rating: "pg" keeps the picker safe for a general audience. */
const RATING = 'pg'

interface GiphyImage {
  url?: string
  mp4?: string
  webp?: string
  width?: string
  height?: string
}
interface GiphyItem {
  id: string
  title?: string
  images?: Record<string, GiphyImage | undefined>
}

export function giphyRequest(url: URL, key: string) {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 50)
  const offset = Math.max(0, Math.min(4999, Number(url.searchParams.get('offset')) || 0))
  const api = new URL(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}`)
  api.searchParams.set('api_key', key)
  if (q) api.searchParams.set('q', q)
  api.searchParams.set('limit', String(PAGE))
  api.searchParams.set('offset', String(offset))
  api.searchParams.set('rating', RATING)
  api.searchParams.set('bundle', 'messaging_non_clips')
  return { api, offset }
}

export function trimGiphy(body: { data?: GiphyItem[]; pagination?: { total_count?: number; count?: number } }, offset: number): GifPage {
  const gifs: Gif[] = []
  for (const g of body.data ?? []) {
    const original = g.images?.original
    const mp4 = g.images?.original_mp4?.mp4 ?? original?.mp4
    const preview = g.images?.fixed_width?.webp ?? g.images?.fixed_width?.url ?? original?.url
    const width = Number(original?.width)
    const height = Number(original?.height)
    if (!mp4 || !preview || !width || !height) continue
    gifs.push({ id: g.id, title: g.title ?? '', width, height, mp4, preview })
  }
  const total = body.pagination?.total_count ?? 0
  const count = body.pagination?.count ?? gifs.length
  const next = offset + count < total && count > 0 ? offset + count : null
  return { gifs, next }
}

/** The whole endpoint: returns the JSON response for a request to /api/giphy. */
export async function giphyResponse(request: Request, key: string | undefined, fetcher: typeof fetch = fetch): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store' } })
  if (!key) return json({ error: 'GIF search is not set up yet (missing GIPHY key).' }, 503)
  const { api, offset } = giphyRequest(new URL(request.url), key)
  const res = await fetcher(api.toString())
  if (!res.ok) return json({ error: `GIPHY answered ${res.status}` }, 502)
  return json(trimGiphy((await res.json()) as Parameters<typeof trimGiphy>[0], offset))
}
