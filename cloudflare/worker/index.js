// Cloudflare Worker: upload/delete/purge
// Bindings (set in wrangler.toml / Cloudflare dashboard):
// - R2 bucket binding: ASSETS_BUCKET
// - env var: ASSETS_DOMAIN (e.g. https://assets.inrl.com)
// - env var: ALLOWED_ORIGINS (comma-separated allowed origins)
// - secret: WORKER_DELETE_KEY (required for delete/purge protection)
// - env var: SUPABASE_URL
// - secret: SUPABASE_SERVICE_ROLE_KEY (optional, for server-side inserts)
// - secret: CF_API_TOKEN (optional, for purge)

addEventListener('fetch', event => event.respondWith(handleRequest(event.request)));

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, '');
  // CORS helper for preflight and simple responses
  const buildCorsHeaders = (req) => {
    const h = new Headers();
    const allowed = (typeof ALLOWED_ORIGINS === 'string' && ALLOWED_ORIGINS.trim()) ? ALLOWED_ORIGINS.split(',').map(s=>s.trim()) : null;
    const origin = req.headers.get('Origin');
    if (allowed && origin && allowed.includes(origin)) h.set('Access-Control-Allow-Origin', origin);
    else h.set('Access-Control-Allow-Origin', '*');
    h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');
    return h;
  };

  // Handle OPTIONS preflight quickly
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
  }
  if (request.method === 'POST' && pathname === '/upload') return handleUpload(request);
  if (request.method === 'POST' && pathname === '/delete') return handleDelete(request);
  if (request.method === 'POST' && pathname === '/purge') return handlePurge(request);
  // Shopify webhook removed — add later if needed
  // Root health-check: respond with simple JSON so visiting base worker URL doesn't 404
  if (request.method === 'GET' && (pathname === '' || pathname === '/')) {
    const headers = buildCorsHeaders(request);
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ ok: true, worker: true }), { status: 200, headers });
  }
  if (request.method === 'GET') return handleGet(request);
  return new Response('Not Found', { status: 404 });
}

// Serve objects from R2 at GET /<key>
async function handleGet(request) {
  try {
    const url = new URL(request.url);
    let key = url.pathname.replace(/^\//, '');
    if (!key) return new Response('Not Found', { status: 404 });

    // Attempt to fetch object from R2
    const obj = await ASSETS_BUCKET.get(key, { allowUnencrypted: true });
    if (!obj || !obj.body) return new Response('Not Found', { status: 404 });

    const headers = new Headers();
    const contentType = (obj.httpMetadata && obj.httpMetadata.contentType) || (obj.customMetadata && obj.customMetadata.contentType) || 'application/octet-stream';
    headers.set('Content-Type', contentType);
    // Strong caching for immutable asset files
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    // CORS: honor ALLOWED_ORIGINS if set, else allow all during rollout
    const allowed = (typeof ALLOWED_ORIGINS === 'string' && ALLOWED_ORIGINS.trim()) ? ALLOWED_ORIGINS.split(',').map(s=>s.trim()) : null;
    const origin = request.headers.get('Origin');
    if (allowed && origin && allowed.includes(origin)) headers.set('Access-Control-Allow-Origin', origin);
    else headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');

    return new Response(obj.body, { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

async function handleUpload(request) {
  try {
    const auth = request.headers.get('authorization') || '';
    // Optionally validate the bearer token here by forwarding to Supabase /auth/v1/user
    const form = await request.formData();
    const file = form.get('file');
    if (!file) return new Response(JSON.stringify({ error: 'file required' }), { status: 400 });
    const path = (form.get('path') || 'videos').toString();
    const filename = (form.get('filename') || (file.name || `${Date.now()}`)).toString();
    const key = `${path}/${Date.now()}-${filename}`;

    await ASSETS_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' }
    });

    // Normalize ASSETS_DOMAIN to include a protocol if operator omitted it
    let assetsDomain = (typeof ASSETS_DOMAIN === 'string' ? ASSETS_DOMAIN : '') || '';
    assetsDomain = assetsDomain.replace(/\/$/, '');
    if (assetsDomain && !/^https?:\/\//i.test(assetsDomain)) assetsDomain = 'https://' + assetsDomain;
    const publicUrl = `${assetsDomain}/${key}`;
    // CORS for upload response
    const uploadHeaders = new Headers({ 'Content-Type': 'application/json' });
    const originReq = request.headers.get('Origin');
    const allowedOrigins = (typeof ALLOWED_ORIGINS === 'string' && ALLOWED_ORIGINS.trim()) ? ALLOWED_ORIGINS.split(',').map(s=>s.trim()) : null;
    if (allowedOrigins && originReq && allowedOrigins.includes(originReq)) uploadHeaders.set('Access-Control-Allow-Origin', originReq);
    else uploadHeaders.set('Access-Control-Allow-Origin', '*');
    uploadHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    uploadHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');
    return new Response(JSON.stringify({ ok: true, key, url: publicUrl }), { status: 200, headers: uploadHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

async function handleDelete(request) {
  try {
    // Protect delete: require a secret header matching WORKER_DELETE_KEY
    const provided = request.headers.get('x-admin-key') || '';
    if (!provided || provided !== (typeof WORKER_DELETE_KEY === 'string' ? WORKER_DELETE_KEY : '')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const body = await request.json().catch(() => ({}));
    const key = body.key || (body.url ? body.url.replace(`${(typeof ASSETS_DOMAIN === 'string' ? ASSETS_DOMAIN : '').replace(/\/$/, '')}/`, '') : null);
    if (!key) return new Response(JSON.stringify({ error: 'key or url required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    await ASSETS_BUCKET.delete(key);
    // Purge CDN for the deleted file if configured
    try {
      if (CF_ZONE_ID && CF_API_TOKEN) {
        await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: [`${ASSETS_DOMAIN.replace(/\/$/, '')}/${key}`] })
        });
      }
    } catch ( _e ) { /* ignore purge errors */ }
    // CORS for delete response (respect ALLOWED_ORIGINS if provided)
    const dHeaders = new Headers({ 'Content-Type': 'application/json' });
    const originReq2 = request.headers.get('Origin');
    const allowedOrigins2 = (typeof ALLOWED_ORIGINS === 'string' && ALLOWED_ORIGINS.trim()) ? ALLOWED_ORIGINS.split(',').map(s=>s.trim()) : null;
    if (allowedOrigins2 && originReq2 && allowedOrigins2.includes(originReq2)) dHeaders.set('Access-Control-Allow-Origin', originReq2);
    else dHeaders.set('Access-Control-Allow-Origin', '*');
    dHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    dHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: dHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

async function handlePurge(request) {
  try {
    const body = await request.json();
    const urls = body.urls || [];
    if (!Array.isArray(urls) || urls.length === 0) return new Response(JSON.stringify({ error: 'urls required' }), { status: 400 });
    if (!CF_ZONE_ID || !CF_API_TOKEN) return new Response(JSON.stringify({ error: 'CF purge not configured' }), { status: 500 });
    const resp = await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: urls })
    });
    const j = await resp.json().catch(() => ({}));
    return new Response(JSON.stringify({ ok: true, result: j }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}


