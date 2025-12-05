// Cloudflare Worker: upload/delete/purge
// Bindings (set in wrangler.toml / Cloudflare dashboard):
// - R2 bucket binding: ASSETS_BUCKET
// - env var: ASSETS_DOMAIN (e.g. https://assets.inrl.com)
// - env var: SUPABASE_URL
// - secret: SUPABASE_SERVICE_ROLE_KEY (optional, for server-side inserts)
// - secret: CF_API_TOKEN (optional, for purge)

addEventListener('fetch', event => event.respondWith(handleRequest(event.request)));

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, '');
  if (request.method === 'POST' && pathname === '/upload') return handleUpload(request);
  if (request.method === 'POST' && pathname === '/delete') return handleDelete(request);
  if (request.method === 'POST' && pathname === '/purge') return handlePurge(request);
  // Shopify webhook removed — add later if needed
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

    return new Response(obj.body, { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

async function handleUpload(request) {
  // Expect: form-data with file, path, filename. Authorization: Bearer <supabase_access_token> (optional)
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

    const publicUrl = `${ASSETS_DOMAIN.replace(/\/$/, '')}/${key}`;
    return new Response(JSON.stringify({ ok: true, key, url: publicUrl }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

async function handleDelete(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const key = body.key || (body.url ? body.url.replace(`${ASSETS_DOMAIN.replace(/\/$/, '')}/`, '') : null);
    if (!key) return new Response(JSON.stringify({ error: 'key or url required' }), { status: 400 });
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
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
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


