/** Which API module answers a path (shared by the worker and the dev server). */
export function apiRoute(path: string): 'cloud' | 'accounts' | 'publish' | 'social' | 'comments' | 'safety' | null {
  if (/^\/api\/(blocks|admin)\//.test(path) || path === '/api/reports' || path === '/api/me/blocks') return 'safety'
  if (/^\/api\/posts\/[^/]+\/comments$/.test(path) || /^\/api\/comments\//.test(path)) return 'comments'
  if (/^\/api\/(scenes|media)(\/|$)/.test(path)) return 'cloud'
  if (path === '/api/feed' || path === '/api/discover' || /^\/api\/posts\/[^/]+\/(view|like)$/.test(path) || /^\/api\/notifications(\/|$)/.test(path) || /^\/api\/(u|follows|avatars)\//.test(path) || path === '/api/me/avatar') return 'social'
  if (/^\/api\/auth\//.test(path) || path === '/api/me') return 'accounts'
  if (/^\/api\/(posts|markers|m)(\/|$)/.test(path) || /^\/api\/me\/(posts|marker)(\/|$)/.test(path)) return 'publish'
  return null
}
