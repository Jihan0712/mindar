// Cloudflare Worker: upload/delete/purge/shopify-webhook
// Bindings (set in wrangler.toml / Cloudflare dashboard):
// - R2 bucket binding: ASSETS_BUCKET
// - environment secrets: WORKER_API_KEY, SHOPIFY_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CF_ZONE_ID, CF_API_TOKEN
// - environment var: ASSETS_DOMAIN (e.g. https://assets.inrl.com)

addEventListener('fetch', event => event.respondWith(handleRequest(event.request)));

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, '');
  if (request.method === 'POST' && pathname === '/upload') return handleUpload(request);
  if (request.method === 'POST' && pathname === '/delete') return handleDelete(request);
  if (request.method === 'POST' && pathname === '/purge') return handlePurge(request);
  if (request.method === 'POST' && pathname === '/shopify-webhook') return handleShopifyWebhook(request);
  return new Response('Not Found', { status: 404 });
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

// Basic Shopify webhook handler: validates HMAC, stores marker to R2 and inserts order+target into Supabase (auto-publish)
async function handleShopifyWebhook(request) {
  try {
    const raw = await request.arrayBuffer();
    const signature = request.headers.get('x-shopify-hmac-sha256') || request.headers.get('X-Shopify-Hmac-Sha256');
    if (SHOPIFY_WEBHOOK_SECRET && signature) {
      const key = SHOPIFY_WEBHOOK_SECRET;
      const algo = { name: 'HMAC', hash: 'SHA-256' };
      const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), algo, false, ['verify']);
      const valid = await crypto.subtle.verify(algo.name, cryptoKey, base64ToArrayBuffer(signature), raw);
      if (!valid) return new Response('Unauthorized', { status: 401 });
    }
    const text = new TextDecoder().decode(raw);
    const payload = JSON.parse(text);

    // Simple mapping: create an `orders` entry and a `targets` entry per line_item marked AR-enabled
    // For production, adjust mapping, product metafield lookup, and error handling.
    const lineItems = payload.line_items || [];
    for (const li of lineItems) {
      // Heuristic: if product has property 'ar_marker' or product tags include 'ar' -> process
      const isAR = (li.properties && Object.values(li.properties).join('').toLowerCase().includes('ar')) || (li.product_exists && (li.product_id));
      if (!isAR) continue;

      // Try to get an image URL from the line item
      const imageUrl = li.image ? li.image.src : (li.properties && li.properties.marker_image) || null;
      let imagePublic = null;
      if (imageUrl) {
        try {
          const r = await fetch(imageUrl);
          const blob = await r.blob();
          const ext = (r.headers.get('content-type') || 'image/jpeg').split('/')[1] || 'jpg';
          const key = `markers/${Date.now()}-${li.product_id || li.id}.${ext}`;
          await ASSETS_BUCKET.put(key, blob.stream(), { httpMetadata: { contentType: r.headers.get('content-type') || 'image/jpeg' } });
          imagePublic = `${ASSETS_DOMAIN.replace(/\/$/, '')}/${key}`;
        } catch (e) {
          // ignore image fetch errors
        }
      }

      // Create Supabase order record and targets row via REST API using service role key
      try {
        // Insert order
        const orderBody = [{ shopify_order_id: String(payload.id), product_id: String(li.product_id || li.variant_id || li.sku || li.name), created_at: new Date().toISOString() }];
        await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify(orderBody)
        });

        // Create a target auto-published
        const targetObj = { name: li.name || `Product ${li.product_id}`, imageurl: imagePublic, brand: payload.billing_address?.company || payload.customer?.email || '', product: li.product_id ? String(li.product_id) : null, is_active: true };
        await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/targets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify([targetObj])
        });
      } catch (e) {
        // continue on errors
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
