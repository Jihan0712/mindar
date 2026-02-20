// Cloudflare Worker: R2 assets + auth/targets/viewer APIs (Cloudflare-only backend)

// ES Module format: expose fetch and inject env bindings into globals per request
export default {
  async fetch(request, env, ctx) {
    setEnvGlobals(env);
    return handleRequest(request);
  }
};

function setEnvGlobals(env) {
  // Bindings
  globalThis.ASSETS_BUCKET = env.ASSETS_BUCKET;
  globalThis.DB = env.DB;
  // Vars / Secrets
  globalThis.ALLOWED_ORIGINS = env.ALLOWED_ORIGINS;
  globalThis.ASSETS_DOMAIN = env.ASSETS_DOMAIN;
  globalThis.WORKER_DELETE_KEY = env.WORKER_DELETE_KEY;
  globalThis.BOOTSTRAP_ADMIN_KEY = env.BOOTSTRAP_ADMIN_KEY;
  globalThis.CF_API_TOKEN = env.CF_API_TOKEN;
  globalThis.CF_ZONE_ID = env.CF_ZONE_ID;
}

// ---------- CORS / JSON helpers ----------

function getAllowedOrigins() {
  if (typeof ALLOWED_ORIGINS === 'string' && ALLOWED_ORIGINS.trim()) {
    return ALLOWED_ORIGINS.split(',').map(s => s.trim());
  }
  return null;
}

function buildCorsHeaders(req) {
  const h = new Headers();
  const allowed = getAllowedOrigins();
  const origin = req.headers.get('Origin');
  if (allowed && origin && allowed.includes(origin)) h.set('Access-Control-Allow-Origin', origin);
  else h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key, x-bootstrap-key');
  h.set('Vary', 'Origin');
  return h;
}

function jsonResponse(body, status = 200, request = null) {
  const headers = request ? buildCorsHeaders(request) : new Headers();
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJson(request) {
  try {
    const txt = await request.text();
    return txt ? JSON.parse(txt) : {};
  } catch {
    return {};
  }
}

// ---------- Crypto / D1 helpers ----------

function randomId(prefix = '') {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  const hex = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  return prefix + hex;
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100_000, hash: 'SHA-256' },
    key,
    256
  );
  const hashArr = new Uint8Array(bits);
  const hashHex = Array.from(hashArr).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${salt}$${hashHex}`;
}

async function verifyPassword(password, stored) {
  if (!stored || !stored.includes('$')) return false;
  const [salt] = stored.split('$');
  const check = await hashPassword(password, salt);
  return check === stored;
}

async function dbGet(sql, ...params) {
  const row = await DB.prepare(sql).bind(...params).first();
  return row || null;
}
async function dbAll(sql, ...params) {
  const res = await DB.prepare(sql).bind(...params).all();
  return res?.results || [];
}
async function dbRun(sql, ...params) {
  await DB.prepare(sql).bind(...params).run();
}

// ---------- Sessions ----------

const SESSION_COOKIE_NAME = 'session';
const SESSION_TTL_DAYS = 30;

async function createSession(userId) {
  const token = randomId('sess_');
  await dbRun('insert into sessions (token, user_id) values (?, ?)', token, userId);
  return token;
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').map(c => c.trim()).filter(Boolean).forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = decodeURIComponent(pair.slice(0, idx));
    const v = decodeURIComponent(pair.slice(idx + 1));
    out[k] = v;
  });
  return out;
}

async function getSessionUser(request) {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  const row = await dbGet(
    'select s.token, u.id as user_id, u.email, u.role from sessions s join users u on u.id = s.user_id where s.token = ?',
    token
  );
  if (!row) return null;
  const brands = await dbAll(
    'select b.id, b.name from brand_users bu join brands b on b.id = bu.brand_id where bu.user_id = ?',
    row.user_id
  );
  return {
    token,
    user: { id: row.user_id, email: row.email, role: row.role, brands }
  };
}

function buildSessionCookie(token, request) {
  const url = new URL(request.url);
  const exp = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toUTCString();
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Expires=${exp}`,
    'SameSite=Lax'
  ];
  if (url.protocol === 'https:') parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
}

// Robustly extract an R2 object key from a public URL or path.
function keyFromPublicUrl(u) {
  try {
    const url = new URL(u);
    return url.pathname.replace(/^\/+/, '').split('?')[0].split('#')[0];
  } catch {
    let s = String(u || '');
    // Remove configured ASSETS_DOMAIN prefix if present in any form
    try {
      let base = (typeof ASSETS_DOMAIN === 'string' ? ASSETS_DOMAIN : '').trim();
      if (base) {
        base = base.replace(/\/$/, '');
        const noProto = base.replace(/^https?:\/\//i, '');
        s = s.replace(new RegExp('^https?:\\/\\/' + noProto, 'i'), '');
        s = s.replace(new RegExp('^' + noProto, 'i'), '');
        s = s.replace(new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\/'), '');
      }
    } catch {}
    return s.replace(/^\/+/, '').split('?')[0].split('#')[0];
  }
}

// ---------- Main router ----------

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, '');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
  }

  // Existing R2 operations
  if (request.method === 'POST' && pathname === '/upload') return handleUpload(request);
  if (request.method === 'POST' && pathname === '/delete') return handleDelete(request);
  if (request.method === 'POST' && pathname === '/purge')  return handlePurge(request);

  // JSON API
  if (pathname.startsWith('/api/')) return handleApi(request, pathname);

  // Health
  if (request.method === 'GET' && (pathname === '' || pathname === '/')) {
    const headers = buildCorsHeaders(request);
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ ok: true, worker: true }), { status: 200, headers });
  }

  // Asset GET from R2
  if (request.method === 'GET') return handleGet(request);
  return new Response('Not Found', { status: 404 });
}

// ---------- /api/* router ----------

async function handleApi(request, pathname) {
  // Auth
  if (request.method === 'POST' && pathname === '/api/auth/bootstrap-admin') return apiBootstrapAdmin(request);
  if (request.method === 'POST' && pathname === '/api/auth/register')        return apiRegister(request);
  if (request.method === 'POST' && pathname === '/api/auth/login')           return apiLogin(request);
  if (request.method === 'POST' && pathname === '/api/auth/logout')          return apiLogout(request);
  if (request.method === 'GET'  && pathname === '/api/auth/me')              return apiMe(request);
  if (request.method === 'POST' && pathname === '/api/auth/change-password') return apiChangePassword(request);

  // Orders (shop)
  if (request.method === 'POST' && pathname === '/api/orders')               return apiCreateOrder(request);

  // Admin
  if (request.method === 'POST' && pathname === '/api/admin/brand-users')    return apiAdminCreateBrandUser(request);

  // Targets
  if (request.method === 'GET'  && pathname === '/api/targets')              return apiListTargets(request);
  if (request.method === 'POST' && pathname === '/api/targets')              return apiCreateTarget(request);
  if (request.method === 'POST' && pathname.endsWith('/activate')) {
    const id = parseInt(pathname.split('/')[3], 10); return apiActivateTarget(request, id);
  }
  if (request.method === 'POST' && pathname.endsWith('/deactivate')) {
    const id = parseInt(pathname.split('/')[3], 10); return apiDeactivateTarget(request, id);
  }
  if (request.method === 'DELETE' && /^\/api\/targets\/\d+$/.test(pathname)) {
    const id = parseInt(pathname.split('/')[3], 10); return apiDeleteTarget(request, id);
  }

  // Viewer
  if (request.method === 'GET' && pathname === '/api/viewer/active')         return apiViewerActive(request);

  // Products (shop catalog)
  if (request.method === 'GET'  && pathname === '/api/product-image')        return apiGetProductImage(request);
  if (request.method === 'GET'  && pathname === '/api/products')             return apiListProducts(request);
  if (request.method === 'POST' && pathname === '/api/products')             return apiCreateProduct(request);
  if (request.method === 'POST' && /^\/api\/products\/\d+$/.test(pathname)) {
    const id = parseInt(pathname.split('/')[3], 10); return apiUpdateProduct(request, id);
  }
  if (request.method === 'DELETE' && /^\/api\/products\/\d+$/.test(pathname)) {
    const id = parseInt(pathname.split('/')[3], 10); return apiDeleteProduct(request, id);
  }

  // Reviews (shop)
  if (request.method === 'GET'  && pathname === '/api/reviews')              return apiListReviews(request);
  if (request.method === 'POST' && pathname === '/api/reviews')              return apiCreateReview(request);

  // Homepage content (shop)
  if (request.method === 'GET'  && pathname === '/api/homepage')             return apiGetHomepage(request);
  if (request.method === 'POST' && pathname === '/api/homepage')             return apiUpdateHomepage(request);

  return jsonResponse({ error: 'Not Found' }, 404, request);
}

// ---------- Homepage content APIs (shop) ----------

function clampStr(s, maxLen) {
  const v = String(s || '').trim();
  if (!v) return '';
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

function normalizeHomepagePayload(body) {
  const billboardIn = body && typeof body.billboard === 'object' && body.billboard ? body.billboard : {};
  const title = clampStr(billboardIn.title, 120);
  const description = clampStr(billboardIn.description, 600);

  const slidesIn = Array.isArray(body && body.slides) ? body.slides : [];
  const slides = slidesIn.slice(0, 12).map(s => {
    const image = clampStr(s && s.image, 800);
    const stitle = clampStr(s && s.title, 120);
    const text = clampStr(s && s.text, 400);
    const href = clampStr(s && s.href, 800);
    const linkLabel = clampStr(s && s.linkLabel, 60);
    return { image, title: stitle, text, href, linkLabel };
  }).filter(s => s.image || s.title || s.text || s.href || s.linkLabel);

  return { billboard: { title, description }, slides };
}

function defaultHomepageContent() {
  return {
    billboard: {
      title: 'New Collections',
      description: 'Lorem ipsum dolor sit amet consectetur adipisicing elit. Saepe voluptas ut dolorum consequuntur, adipisci repellat! Eveniet commodi voluptatem voluptate, eum minima, in suscipit explicabo voluptatibus harum, quibusdam ex repellat eaque!'
    },
    slides: [
      {
        image: 'images/banner-image-6.jpg',
        title: 'Soft leather jackets',
        text: 'Scelerisque duis aliquam qui lorem ipsum dolor amet, consectetur adipiscing elit.',
        href: 'index.html',
        linkLabel: 'Discover Now'
      }
    ]
  };
}

async function apiGetHomepage(request) {
  try {
    const row = await dbGet('select json, updated_at, updated_by from site_content where key = ?', 'homepage');
    if (!row || !row.json) {
      return jsonResponse({ ok: true, content: defaultHomepageContent(), updated_at: null }, 200, request);
    }
    let parsed = null;
    try { parsed = JSON.parse(String(row.json)); } catch { parsed = null; }
    const content = parsed && typeof parsed === 'object' ? parsed : defaultHomepageContent();
    return jsonResponse({ ok: true, content, updated_at: row.updated_at || null, updated_by: row.updated_by || null }, 200, request);
  } catch (e) {
    const msg = String(e || '');
    if (msg.toLowerCase().includes('no such table') && msg.includes('site_content')) {
      return jsonResponse({ error: 'DB migration required: create site_content table (run sql/homepage_content_migration.sql)' }, 500, request);
    }
    throw e;
  }
}

async function apiUpdateHomepage(request) {
  const sess = await getSessionUser(request);
  if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
  if (sess.user.role !== 'admin') return jsonResponse({ error: 'Forbidden' }, 403, request);

  const body = await readJson(request);
  const normalized = normalizeHomepagePayload(body);

  // Require at least a title or one slide so the page isn't blank.
  if (!normalized.billboard.title && !normalized.slides.length) {
    return jsonResponse({ error: 'billboard.title or at least one slide required' }, 400, request);
  }

  const now = new Date().toISOString();
  const payload = JSON.stringify(normalized);

  try {
    await dbRun(
      `insert into site_content (key, json, updated_at, updated_by)
       values (?, ?, ?, ?)
       on conflict(key) do update set json = excluded.json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      'homepage',
      payload,
      now,
      sess.user.email || sess.user.id
    );
  } catch (e) {
    const msg = String(e || '');
    if (msg.toLowerCase().includes('no such table') && msg.includes('site_content')) {
      return jsonResponse({ error: 'DB migration required: create site_content table (run sql/homepage_content_migration.sql)' }, 500, request);
    }
    throw e;
  }

  return jsonResponse({ ok: true, content: normalized, updated_at: now, updated_by: sess.user.email || sess.user.id }, 200, request);
}

function parseImageDataUrl(dataUrl) {
  const s = String(dataUrl || '');
  if (!s.startsWith('data:')) return null;
  const commaIdx = s.indexOf(',');
  if (commaIdx < 0) return null;
  const meta = s.slice(5, commaIdx); // "image/png;base64"
  const payload = s.slice(commaIdx + 1);
  const [mimeRaw, ...params] = meta.split(';');
  const mime = (mimeRaw || '').trim().toLowerCase();
  const isBase64 = params.map(p => p.trim().toLowerCase()).includes('base64');
  if (!mime.startsWith('image/')) return null;
  if (!isBase64) return null;
  return { mime, base64: payload };
}

function base64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function parseImageUrlsField(value) {
  if (value == null) return null;
  const v = value;
  let arr = null;
  if (Array.isArray(v)) arr = v;
  else if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    try {
      const j = JSON.parse(s);
      if (Array.isArray(j)) arr = j;
      else return null;
    } catch {
      // Treat a single URL string as a one-item list
      arr = [s];
    }
  } else {
    return null;
  }

  const cleaned = arr
    .map(x => String(x || '').trim())
    .filter(Boolean);

  if (cleaned.length > 5) return null;
  for (const u of cleaned) {
    if (!/^https?:\/\//i.test(u) && !u.startsWith('/')) return null;
  }
  return cleaned;
}

function firstImageUrl(imageUrl, imageUrlsJson) {
  const direct = String(imageUrl || '').trim();
  if (direct) return direct;
  if (!imageUrlsJson) return '';
  try {
    const arr = typeof imageUrlsJson === 'string' ? JSON.parse(imageUrlsJson) : imageUrlsJson;
    if (Array.isArray(arr) && arr.length) return String(arr[0] || '').trim();
  } catch {}
  return '';
}

function parseImageUrlsFromRow(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    const cleaned = value.map(x => String(x || '').trim()).filter(Boolean);
    return cleaned.length ? cleaned.slice(0, 5) : null;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    try {
      const j = JSON.parse(s);
      if (!Array.isArray(j)) return null;
      const cleaned = j.map(x => String(x || '').trim()).filter(Boolean);
      return cleaned.length ? cleaned.slice(0, 5) : null;
    } catch {
      return [s].slice(0, 5);
    }
  }
  return null;
}

// ---------- Role / input helpers ----------

function normalizeSlug(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  return s
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-');
}

function parsePriceCents(body) {
  if (body && body.price_cents != null && body.price_cents !== '') {
    const n = Number(body.price_cents);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.round(n));
  }
  if (body && body.price != null && body.price !== '') {
    const n = Number(String(body.price).replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.round(n * 100));
  }
  return 0;
}

function isPrivilegedRole(role) {
  return role === 'admin' || role === 'brand';
}

function isAdminRole(role) {
  return role === 'admin';
}

async function requirePrivilegedSession(request) {
  const sess = await getSessionUser(request);
  if (!sess) return { error: jsonResponse({ error: 'Unauthorized' }, 401, request) };
  if (!isPrivilegedRole(sess.user.role)) return { error: jsonResponse({ error: 'Forbidden' }, 403, request) };
  return { sess };
}

async function requireAdminSession(request) {
  const sess = await getSessionUser(request);
  if (!sess) return { error: jsonResponse({ error: 'Unauthorized' }, 401, request) };
  if (!isAdminRole(sess.user.role)) return { error: jsonResponse({ error: 'Forbidden' }, 403, request) };
  return { sess };
}

function isValidEmail(email) {
  const s = String(email || '').trim().toLowerCase();
  if (!s) return false;
  if (s.length > 254) return false;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

async function getScopedBrandIds(sess) {
  if (!sess) return [];
  if (sess.user.role === 'brand') return (sess.user.brands || []).map(b => b.id);
  return [];
}

async function ensureBrandIdByName(brandName) {
  const name = (brandName || '').trim();
  if (!name) return null;
  let b = await dbGet('select id from brands where name = ?', name);
  if (!b) {
    await dbRun('insert into brands (name) values (?)', name);
    b = await dbGet('select id from brands where name = ?', name);
  }
  return b ? b.id : null;
}

// ---------- Auth APIs ----------

async function apiBootstrapAdmin(request) {
  const body = await readJson(request);
  const provided = request.headers.get('x-bootstrap-key') || '';
  if (!BOOTSTRAP_ADMIN_KEY || provided !== BOOTSTRAP_ADMIN_KEY) {
    return jsonResponse({ error: 'Unauthorized' }, 401, request);
  }
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !password) return jsonResponse({ error: 'email and password required' }, 400, request);

  const existing = await dbGet('select id from users where email = ?', email);
  if (existing) return jsonResponse({ error: 'admin already exists for this email' }, 400, request);

  const salt = randomId('salt_');
  const hash = await hashPassword(password, salt);
  const userId = randomId('usr_');
  await dbRun('insert into users (id, email, password_hash, role) values (?, ?, ?, ?)', userId, email, hash, 'admin');
  const token = await createSession(userId);
  const res = jsonResponse({ ok: true, user: { id: userId, email, role: 'admin' } }, 200, request);
  res.headers.append('Set-Cookie', buildSessionCookie(token, request));
  return res;
}

async function apiRegister(request) {
  const body = await readJson(request);
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  if (!isValidEmail(email)) return jsonResponse({ error: 'Valid email required' }, 400, request);
  if (!password || String(password).length < 8) return jsonResponse({ error: 'Password must be at least 8 characters' }, 400, request);

  const existing = await dbGet('select id from users where email = ?', email);
  if (existing) return jsonResponse({ error: 'Email already registered' }, 409, request);

  const salt = randomId('salt_');
  const hash = await hashPassword(password, salt);
  const userId = randomId('usr_');
  await dbRun('insert into users (id, email, password_hash, role) values (?, ?, ?, ?)', userId, email, hash, 'client');

  const token = await createSession(userId);
  const res = jsonResponse({ ok: true, user: { id: userId, email, role: 'client' } }, 201, request);
  res.headers.append('Set-Cookie', buildSessionCookie(token, request));
  return res;
}

async function apiLogin(request) {
  const body = await readJson(request);
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !password) return jsonResponse({ error: 'email and password required' }, 400, request);

  const user = await dbGet('select id, email, password_hash, role from users where email = ?', email);
  if (!user) return jsonResponse({ error: 'Invalid credentials' }, 401, request);

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return jsonResponse({ error: 'Invalid credentials' }, 401, request);

  const token = await createSession(user.id);
  const brands = await dbAll(
    'select b.id, b.name from brand_users bu join brands b on b.id = bu.brand_id where bu.user_id = ?',
    user.id
  );
  const res = jsonResponse({ ok: true, user: { id: user.id, email: user.email, role: user.role, brands } }, 200, request);
  res.headers.append('Set-Cookie', buildSessionCookie(token, request));
  return res;
}

async function apiLogout(request) {
  const sess = await getSessionUser(request);
  if (sess?.token) await dbRun('delete from sessions where token = ?', sess.token);
  const res = jsonResponse({ ok: true }, 200, request);
  res.headers.append('Set-Cookie', clearSessionCookie());
  return res;
}

async function apiMe(request) {
  const sess = await getSessionUser(request);
  return jsonResponse({ user: sess ? sess.user : null }, 200, request);
}

async function apiChangePassword(request) {
  const sess = await getSessionUser(request);
  if (!sess?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401, request);

  const body = await readJson(request);
  const currentPassword = body.currentPassword || '';
  const newPassword = body.newPassword || '';

  if (!currentPassword || !newPassword) {
    return jsonResponse({ error: 'currentPassword and newPassword required' }, 400, request);
  }
  if (String(newPassword).length < 8) {
    return jsonResponse({ error: 'Password must be at least 8 characters' }, 400, request);
  }

  const user = await dbGet('select id, password_hash from users where id = ?', sess.user.id);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401, request);

  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) return jsonResponse({ error: 'Invalid current password' }, 401, request);

  const salt = randomId('salt_');
  const hash = await hashPassword(newPassword, salt);
  await dbRun('update users set password_hash = ? where id = ?', hash, user.id);

  // Rotate sessions for this user.
  await dbRun('delete from sessions where user_id = ?', user.id);
  const token = await createSession(user.id);

  const res = jsonResponse({ ok: true }, 200, request);
  res.headers.append('Set-Cookie', buildSessionCookie(token, request));
  return res;
}

// ---------- Orders APIs ----------

function normalizeCartItem(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const id = o.id != null ? String(o.id).trim() : '';
  const slug = o.slug != null ? String(o.slug).trim() : '';
  const name = String(o.name || o.title || '').trim();
  const qty = Math.max(1, Math.min(99, parseInt(o.qty, 10) || 0));
  const price = Number(o.price);
  const image = String(o.image || o.image_url || '').trim();

  if (!name) return null;
  if (!Number.isFinite(price) || price < 0) return null;
  if (!qty) return null;

  return { id: id || null, slug: slug || null, name, qty, price, image: image || null };
}

function computeOrderTotalCents(cartItems) {
  let total = 0;
  for (const it of cartItems) {
    const line = Math.round(Number(it.price) * 100) * Number(it.qty);
    if (!Number.isFinite(line) || line < 0) return null;
    total += line;
  }
  if (!Number.isFinite(total) || total < 0) return null;
  return Math.round(total);
}

async function apiCreateOrder(request) {
  const body = await readJson(request);
  const cartIn = Array.isArray(body.cart) ? body.cart : [];
  const cart = cartIn.map(normalizeCartItem).filter(Boolean);
  if (!cart.length) return jsonResponse({ error: 'cart is required' }, 400, request);

  const customer = body.customer && typeof body.customer === 'object' ? body.customer : {};
  const firstName = clampStr(customer.firstName, 80);
  const lastName = clampStr(customer.lastName, 80);
  const email = String(customer.email || '').trim().toLowerCase();
  const address = clampStr(customer.address, 220);
  const country = clampStr(customer.country, 80);
  const state = clampStr(customer.state, 80);
  const zip = clampStr(customer.zip, 20);
  if (!firstName || !lastName) return jsonResponse({ error: 'firstName and lastName required' }, 400, request);
  if (!isValidEmail(email)) return jsonResponse({ error: 'Valid email required' }, 400, request);
  if (!address || !country || !state || !zip) return jsonResponse({ error: 'address, country, state, zip required' }, 400, request);

  const currency = String(body.currency || 'USD').trim().toUpperCase() || 'USD';
  const totalCents = computeOrderTotalCents(cart);
  if (totalCents == null) return jsonResponse({ error: 'Invalid cart pricing' }, 400, request);

  const sess = await getSessionUser(request);
  const orderId = randomId('ord_');
  const now = new Date().toISOString();

  try {
    await dbRun(
      `insert into orders (id, user_id, email, first_name, last_name, address, country, state, zip, currency, total_cents, items_json, status, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      orderId,
      sess?.user?.id || null,
      email,
      firstName,
      lastName,
      address,
      country,
      state,
      zip,
      currency,
      totalCents,
      JSON.stringify(cart),
      'created',
      now
    );
  } catch (e) {
    const msg = String(e || '');
    if (msg.toLowerCase().includes('no such table') && msg.includes('orders')) {
      return jsonResponse({ error: 'DB migration required: create orders table (run sql/orders_migration.sql)' }, 500, request);
    }
    throw e;
  }

  return jsonResponse({ ok: true, order_id: orderId, total_cents: totalCents, currency }, 201, request);
}

// ---------- Admin APIs ----------

async function apiAdminCreateBrandUser(request) {
  const { sess, error } = await requireAdminSession(request);
  if (error) return error;

  const body = await readJson(request);
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const brandName = (body.brand || '').trim();

  if (!brandName) return jsonResponse({ error: 'brand required' }, 400, request);
  if (!isValidEmail(email)) return jsonResponse({ error: 'Valid email required' }, 400, request);
  if (!password || String(password).length < 8) return jsonResponse({ error: 'Password must be at least 8 characters' }, 400, request);

  const existing = await dbGet('select id from users where email = ?', email);
  if (existing) return jsonResponse({ error: 'Email already exists' }, 409, request);

  const brandId = await ensureBrandIdByName(brandName);
  if (!brandId) return jsonResponse({ error: 'Invalid brand' }, 400, request);

  const salt = randomId('salt_');
  const hash = await hashPassword(password, salt);
  const userId = randomId('usr_');
  await dbRun('insert into users (id, email, password_hash, role) values (?, ?, ?, ?)', userId, email, hash, 'brand');
  await dbRun('insert into brand_users (user_id, brand_id) values (?, ?)', userId, brandId);

  return jsonResponse(
    { ok: true, user: { id: userId, email, role: 'brand', brand: { id: brandId, name: brandName } }, created_by: sess.user.email || sess.user.id },
    201,
    request
  );
}

// ---------- Products APIs ----------

async function apiListProducts(request) {
  const url = new URL(request.url);
  const brandName = (url.searchParams.get('brand') || '').trim();
  const includeUnpublished = url.searchParams.get('includeUnpublished') === '1';

  const sess = await getSessionUser(request);
  const role = sess?.user?.role || 'anonymous';

  let sql = `
    select p.id, p.title, p.slug, p.category, p.color, p.sizes, p.description, p.price_cents, p.currency, p.image_url, p.image_urls,
           case when p.image_data is not null and length(p.image_data) > 0 then 1 else 0 end as has_image_data,
           p.is_published, p.ar_target_id, p.created_at, p.updated_at,
           b.name as brand
    from products p
    left join brands b on b.id = p.brand_id
  `;
  const where = [];
  const params = [];

  if (sess && role === 'brand') {
    const brandIds = (sess.user.brands || []).map(b => b.id);
    if (!brandIds.length) return jsonResponse({ items: [] }, 200, request);
    where.push(`p.brand_id in (${brandIds.map(() => '?').join(',')})`);
    params.push(...brandIds);
  }

  if (brandName) {
    where.push('lower(b.name) = lower(?)');
    params.push(brandName);
  }

  const canSeeUnpublished = sess && isPrivilegedRole(role) && includeUnpublished;
  if (!canSeeUnpublished) {
    where.push('p.is_published = 1');
  }

  if (where.length) sql += ' where ' + where.join(' and ');
  sql += ' order by p.created_at desc';

  let rows;
  try {
    rows = await dbAll(sql, ...params);
  } catch (e) {
    const msg = String(e || '');
    if (msg.toLowerCase().includes('no such column') && (msg.includes('category') || msg.includes('color') || msg.includes('sizes') || msg.includes('image_data') || msg.includes('image_urls'))) {
      // Backward-compatible fallback if DB hasn't been migrated yet.
      const fallbackSql = `
        select p.id, p.title, p.slug, p.description, p.price_cents, p.currency, p.image_url,
               p.is_published, p.ar_target_id, p.created_at, p.updated_at,
               b.name as brand
        from products p
        left join brands b on b.id = p.brand_id
      `;
      let fb = fallbackSql;
      if (where.length) fb += ' where ' + where.join(' and ');
      fb += ' order by p.created_at desc';
      rows = await dbAll(fb, ...params);
    } else {
      throw e;
    }
  }
  const items = rows.map(r => {
    const qs = new URLSearchParams();
    if (r.brand) qs.set('brand', r.brand);
    if (r.slug) qs.set('product', r.slug);
    const viewer_url = `/index.html${qs.toString() ? `?${qs.toString()}` : ''}`;
    const parsedImageUrls = parseImageUrlsFromRow(r.image_urls);
    const firstUrl = firstImageUrl(r.image_url, parsedImageUrls || r.image_urls);
    const computedImageUrl = firstUrl || ((r.has_image_data || 0) ? `/api/product-image?id=${encodeURIComponent(r.id)}&i=0` : null);
    return {
      id: r.id,
      title: r.title,
      slug: r.slug,
      category: r.category || null,
      color: r.color || null,
      sizes: r.sizes || null,
      description: r.description,
      price_cents: r.price_cents,
      currency: r.currency,
      image_url: computedImageUrl,
      image_urls: parsedImageUrls,
      is_published: !!r.is_published,
      ar_target_id: r.ar_target_id == null ? null : Number(r.ar_target_id),
      brand: r.brand || null,
      viewer_url,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });
  return jsonResponse({ items }, 200, request);
}

async function apiGetProductImage(request) {
  const url = new URL(request.url);
  const id = Number(url.searchParams.get('id'));
  const idx = Math.max(0, Number(url.searchParams.get('i') || '0') || 0);
  if (!Number.isFinite(id) || id <= 0) return new Response('Bad Request', { status: 400 });

  let row;
  try {
    row = await dbGet('select image_data from products where id = ?', id);
  } catch (e) {
    const msg = String(e || '');
    if (msg.toLowerCase().includes('no such column') && msg.includes('image_data')) {
      return new Response('DB migration required', { status: 500 });
    }
    throw e;
  }
  if (!row || !row.image_data) return new Response('Not Found', { status: 404 });

  let picked = null;
  const raw = String(row.image_data || '').trim();
  if (raw.startsWith('[')) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) picked = String(arr[Math.min(idx, arr.length - 1)] || '');
    } catch {}
  }
  if (!picked) picked = raw;

  const parsed = parseImageDataUrl(picked);
  if (!parsed) return new Response('Invalid image data', { status: 500 });

  let bytes;
  try {
    bytes = base64ToBytes(parsed.base64);
  } catch {
    return new Response('Invalid image data', { status: 500 });
  }

  const headers = buildCorsHeaders(request);
  headers.set('Content-Type', parsed.mime);
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(bytes, { status: 200, headers });
}

async function apiCreateProduct(request) {
  const { sess, error } = await requirePrivilegedSession(request);
  if (error) return error;

  const body = await readJson(request);
  const title = (body.title || '').trim();
  const category = (body.category || '').trim();
  const color = (body.color || '').trim();
  const sizes = (body.sizes || '').trim();
  const description = (body.description || '').trim() || null;
  const currency = (body.currency || 'USD').trim().toUpperCase() || 'USD';
  const imageUrl = (body.image_url || '').trim() || null;
  const imageData = (body.image_data || '').trim() || null;
  const imageUrlsArr = parseImageUrlsField(body.image_urls);
  const imageUrlsJson = imageUrlsArr ? JSON.stringify(imageUrlsArr) : null;
  const isPublished = body.is_published ? 1 : 0;
  if (imageUrlsArr == null && body.image_urls != null) return jsonResponse({ error: 'Invalid image_urls (max 5)' }, 400, request);
  if (imageData) {
    if (imageData.length > 2_000_000) return jsonResponse({ error: 'image too large' }, 413, request);
    const parsed = parseImageDataUrl(imageData);
    if (!parsed) return jsonResponse({ error: 'Invalid image_data' }, 400, request);
  }
  const priceCents = parsePriceCents(body);
  if (priceCents == null) return jsonResponse({ error: 'Invalid price' }, 400, request);

  let slug = normalizeSlug(body.slug || title);
  if (!title) return jsonResponse({ error: 'title required' }, 400, request);
  if (!slug) return jsonResponse({ error: 'slug required' }, 400, request);
  if (!category) return jsonResponse({ error: 'category required' }, 400, request);
  if (!color) return jsonResponse({ error: 'color required' }, 400, request);
  if (!sizes) return jsonResponse({ error: 'sizes required' }, 400, request);

  let brandId = null;
  if (sess.user.role === 'admin') {
    const brandName = (body.brand || '').trim();
    if (brandName) brandId = await ensureBrandIdByName(brandName);
  } else {
    const brandIds = await getScopedBrandIds(sess);
    if (!brandIds.length) return jsonResponse({ error: 'Brand account has no brand assigned' }, 400, request);
    brandId = brandIds[0];
  }

  let targetId = body.ar_target_id != null && body.ar_target_id !== '' ? Number(body.ar_target_id) : null;
  if (targetId != null && !Number.isFinite(targetId)) return jsonResponse({ error: 'Invalid ar_target_id' }, 400, request);
  if (targetId != null) {
    const t = await dbGet('select id, brand_id from targets where id = ?', targetId);
    if (!t) return jsonResponse({ error: 'Target not found' }, 404, request);
    if (sess.user.role === 'brand') {
      const brandIds = (sess.user.brands || []).map(b => b.id);
      if (!brandIds.includes(t.brand_id)) return jsonResponse({ error: 'Forbidden' }, 403, request);
    }
  }

  try {
    await dbRun(
      'insert into products (brand_id, title, slug, category, color, sizes, description, price_cents, currency, image_url, image_urls, image_data, is_published, ar_target_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      brandId,
      title,
      slug,
      category,
      color,
      sizes,
      description,
      priceCents,
      currency,
      imageUrl,
      imageUrlsJson,
      imageData,
      isPublished,
      targetId
    );
  } catch (e) {
    const msg = String(e || '');
    if (msg.toLowerCase().includes('no such column') && (msg.includes('category') || msg.includes('color') || msg.includes('sizes') || msg.includes('image_data') || msg.includes('image_urls'))) {
      return jsonResponse({ error: 'DB migration required: run sql/product_attributes_migration.sql, sql/product_images_migration.sql, and sql/product_image_urls_migration.sql against D1' }, 500, request);
    }
    throw e;
  }

  const row = await dbGet(
    `select p.id, p.title, p.slug, p.category, p.color, p.sizes, p.description, p.price_cents, p.currency, p.image_url, p.image_urls,
            case when p.image_data is not null and length(p.image_data) > 0 then 1 else 0 end as has_image_data,
            p.is_published, p.ar_target_id, p.created_at, p.updated_at, b.name as brand
     from products p
     left join brands b on b.id = p.brand_id
     where p.rowid = last_insert_rowid()`
  );

  if (row) {
    const parsedImageUrls = parseImageUrlsFromRow(row.image_urls);
    const firstUrl = firstImageUrl(row.image_url, parsedImageUrls || row.image_urls);
    if (!firstUrl && (row.has_image_data || 0)) row.image_url = `/api/product-image?id=${encodeURIComponent(row.id)}&i=0`;
    else row.image_url = firstUrl || null;
    row.image_urls = parsedImageUrls;
    if (row.has_image_data != null) delete row.has_image_data;
  }
  return jsonResponse({ ok: true, item: row || null }, 201, request);
}

async function apiUpdateProduct(request, id) {
  const { sess, error } = await requirePrivilegedSession(request);
  if (error) return error;
  if (!id) return jsonResponse({ error: 'id required' }, 400, request);

  const existing = await dbGet('select id, brand_id from products where id = ?', id);
  if (!existing) return jsonResponse({ error: 'Not found' }, 404, request);

  if (sess.user.role === 'brand') {
    const brandIds = (sess.user.brands || []).map(b => b.id);
    if (!brandIds.includes(existing.brand_id)) return jsonResponse({ error: 'Forbidden' }, 403, request);
  }

  const body = await readJson(request);
  const fields = [];
  const params = [];

  if (body.title != null) { fields.push('title = ?'); params.push(String(body.title).trim()); }
  if (body.slug != null) {
    const slug = normalizeSlug(body.slug);
    if (!slug) return jsonResponse({ error: 'Invalid slug' }, 400, request);
    fields.push('slug = ?'); params.push(slug);
  }
  if (body.description != null) { fields.push('description = ?'); params.push(String(body.description).trim() || null); }
  if (body.currency != null) { fields.push('currency = ?'); params.push(String(body.currency).trim().toUpperCase() || 'USD'); }
  if (body.image_url != null) { fields.push('image_url = ?'); params.push(String(body.image_url).trim() || null); }
  if (body.image_urls !== undefined) {
    const parsed = parseImageUrlsField(body.image_urls);
    if (parsed == null) return jsonResponse({ error: 'Invalid image_urls (max 5)' }, 400, request);
    fields.push('image_urls = ?');
    params.push(parsed.length ? JSON.stringify(parsed) : null);
  }
  if (body.image_data !== undefined) {
    const v = String(body.image_data || '').trim();
    if (!v) {
      fields.push('image_data = ?');
      params.push(null);
    } else {
      if (v.length > 2_000_000) return jsonResponse({ error: 'image too large' }, 413, request);
      const parsed = parseImageDataUrl(v);
      if (!parsed) return jsonResponse({ error: 'Invalid image_data' }, 400, request);
      fields.push('image_data = ?');
      params.push(v);
    }
  }
  if (body.is_published != null) { fields.push('is_published = ?'); params.push(body.is_published ? 1 : 0); }

  if (body.price_cents != null || body.price != null) {
    const cents = parsePriceCents(body);
    if (cents == null) return jsonResponse({ error: 'Invalid price' }, 400, request);
    fields.push('price_cents = ?'); params.push(cents);
  }

  if (body.ar_target_id !== undefined) {
    let targetId = body.ar_target_id != null && body.ar_target_id !== '' ? Number(body.ar_target_id) : null;
    if (targetId != null && !Number.isFinite(targetId)) return jsonResponse({ error: 'Invalid ar_target_id' }, 400, request);
    if (targetId != null) {
      const t = await dbGet('select id, brand_id from targets where id = ?', targetId);
      if (!t) return jsonResponse({ error: 'Target not found' }, 404, request);
      if (sess.user.role === 'brand') {
        const brandIds = (sess.user.brands || []).map(b => b.id);
        if (!brandIds.includes(t.brand_id)) return jsonResponse({ error: 'Forbidden' }, 403, request);
      }
    }
    fields.push('ar_target_id = ?'); params.push(targetId);
  }

  if (body.category != null) {
    const v = String(body.category).trim();
    if (!v) return jsonResponse({ error: 'Invalid category' }, 400, request);
    fields.push('category = ?');
    params.push(v);
  }

  if (body.color != null) {
    const v = String(body.color).trim();
    if (!v) return jsonResponse({ error: 'Invalid color' }, 400, request);
    fields.push('color = ?');
    params.push(v);
  }

  if (body.sizes != null) {
    const v = String(body.sizes).trim();
    if (!v) return jsonResponse({ error: 'Invalid sizes' }, 400, request);
    fields.push('sizes = ?');
    params.push(v);
  }

  if (!fields.length) return jsonResponse({ ok: true }, 200, request);
  fields.push("updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))");

  try {
    await dbRun(`update products set ${fields.join(', ')} where id = ?`, ...params, id);
  } catch (e) {
    const msg = String(e || '');
    if (msg.toLowerCase().includes('unique') && msg.toLowerCase().includes('slug')) {
      return jsonResponse({ error: 'slug already exists' }, 409, request);
    }
    if (msg.toLowerCase().includes('no such column') && (msg.includes('category') || msg.includes('color') || msg.includes('sizes') || msg.includes('image_data') || msg.includes('image_urls'))) {
      return jsonResponse({ error: 'DB migration required: run sql/product_attributes_migration.sql, sql/product_images_migration.sql, and sql/product_image_urls_migration.sql against D1' }, 500, request);
    }
    throw e;
  }

  let row;
  try {
    row = await dbGet(
      `select p.id, p.title, p.slug, p.category, p.color, p.sizes, p.description, p.price_cents, p.currency, p.image_url, p.image_urls,
              case when p.image_data is not null and length(p.image_data) > 0 then 1 else 0 end as has_image_data,
              p.is_published, p.ar_target_id, p.created_at, p.updated_at, b.name as brand
       from products p
       left join brands b on b.id = p.brand_id
       where p.id = ?`,
      id
    );
  } catch (e) {
    const msg = String(e || '');
    if (msg.toLowerCase().includes('no such column') && (msg.includes('category') || msg.includes('color') || msg.includes('sizes') || msg.includes('image_data') || msg.includes('image_urls'))) {
      row = await dbGet(
        `select p.id, p.title, p.slug, p.description, p.price_cents, p.currency, p.image_url,
                p.is_published, p.ar_target_id, p.created_at, p.updated_at, b.name as brand
         from products p
         left join brands b on b.id = p.brand_id
         where p.id = ?`,
        id
      );
    } else {
      throw e;
    }
  }
  if (row) {
    const parsedImageUrls = parseImageUrlsFromRow(row.image_urls);
    const firstUrl = firstImageUrl(row.image_url, parsedImageUrls || row.image_urls);
    if (!firstUrl && (row.has_image_data || 0)) row.image_url = `/api/product-image?id=${encodeURIComponent(row.id)}&i=0`;
    else row.image_url = firstUrl || row.image_url || null;
    row.image_urls = parsedImageUrls;
    if (row.has_image_data != null) delete row.has_image_data;
  }
  return jsonResponse({ ok: true, item: row || null }, 200, request);
}

async function apiDeleteProduct(request, id) {
  const { sess, error } = await requirePrivilegedSession(request);
  if (error) return error;
  if (!id) return jsonResponse({ error: 'id required' }, 400, request);

  const existing = await dbGet('select id, brand_id from products where id = ?', id);
  if (!existing) return jsonResponse({ error: 'Not found' }, 404, request);
  if (sess.user.role === 'brand') {
    const brandIds = (sess.user.brands || []).map(b => b.id);
    if (!brandIds.includes(existing.brand_id)) return jsonResponse({ error: 'Forbidden' }, 403, request);
  }

  await dbRun('delete from products where id = ?', id);
  return jsonResponse({ ok: true }, 200, request);
}

// ---------- Reviews APIs (shop) ----------

function isDigits(s) {
  return /^\d+$/.test(String(s || '').trim());
}

async function resolvePublishedProductByRef(ref) {
  const raw = String(ref || '').trim();
  if (!raw) return null;
  if (isDigits(raw)) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) return null;
    const row = await dbGet('select id, slug, is_published from products where id = ?', id);
    if (!row || !row.is_published) return null;
    return { id: Number(row.id), slug: row.slug || null };
  }
  const row = await dbGet('select id, slug, is_published from products where slug = ?', raw);
  if (!row || !row.is_published) return null;
  return { id: Number(row.id), slug: row.slug || raw };
}

async function apiListReviews(request) {
  const url = new URL(request.url);
  const ref = (url.searchParams.get('product') || url.searchParams.get('product_id') || url.searchParams.get('product_slug') || '').trim();
  if (!ref) return jsonResponse({ error: 'product required' }, 400, request);

  let product;
  try {
    product = await resolvePublishedProductByRef(ref);
  } catch (e) {
    const msg = String(e || '');
    if (msg.toLowerCase().includes('no such table') && msg.includes('product_reviews')) {
      return jsonResponse({ error: 'DB migration required: create product_reviews table' }, 500, request);
    }
    throw e;
  }
  if (!product) return jsonResponse({ error: 'Not found' }, 404, request);

  let items = [];
  let statsRow = null;
  try {
    items = await dbAll(
      'select id, rating, author, comment, created_at from product_reviews where product_id = ? order by created_at desc limit 50',
      product.id
    );
    statsRow = await dbGet(
      'select avg(rating) as average, count(*) as count from product_reviews where product_id = ?',
      product.id
    );
  } catch (e) {
    const msg = String(e || '');
    if (msg.toLowerCase().includes('no such table') && msg.includes('product_reviews')) {
      return jsonResponse({ error: 'DB migration required: create product_reviews table' }, 500, request);
    }
    throw e;
  }

  const avg = statsRow && statsRow.average != null ? Number(statsRow.average) : 0;
  const count = statsRow && statsRow.count != null ? Number(statsRow.count) : 0;
  return jsonResponse(
    {
      product,
      stats: { average: Number.isFinite(avg) ? avg : 0, count: Number.isFinite(count) ? count : 0 },
      items: (items || []).map(r => ({
        id: r.id,
        rating: Number(r.rating) || 0,
        author: r.author || null,
        comment: r.comment || null,
        created_at: r.created_at || null,
      })),
    },
    200,
    request
  );
}

async function apiCreateReview(request) {
  const body = await readJson(request);
  const ref = (body.product || body.product_id || body.product_slug || '').toString().trim();
  if (!ref) return jsonResponse({ error: 'product required' }, 400, request);

  const rating = parseInt(body.rating, 10);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return jsonResponse({ error: 'rating must be 1-5' }, 400, request);
  }

  const authorRaw = (body.author || '').toString().trim();
  const commentRaw = (body.comment || '').toString().trim();
  if (authorRaw.length > 60) return jsonResponse({ error: 'author too long' }, 400, request);
  if (commentRaw.length > 1000) return jsonResponse({ error: 'comment too long' }, 400, request);
  const author = authorRaw || null;
  const comment = commentRaw || null;

  let product;
  try {
    product = await resolvePublishedProductByRef(ref);
  } catch (e) {
    const msg = String(e || '');
    if (msg.toLowerCase().includes('no such table') && msg.includes('product_reviews')) {
      return jsonResponse({ error: 'DB migration required: create product_reviews table' }, 500, request);
    }
    throw e;
  }
  if (!product) return jsonResponse({ error: 'Not found' }, 404, request);

  try {
    await dbRun(
      'insert into product_reviews (product_id, product_slug, rating, author, comment) values (?, ?, ?, ?, ?)',
      product.id,
      product.slug,
      rating,
      author,
      comment
    );
  } catch (e) {
    const msg = String(e || '');
    if (msg.toLowerCase().includes('no such table') && msg.includes('product_reviews')) {
      return jsonResponse({ error: 'DB migration required: create product_reviews table' }, 500, request);
    }
    throw e;
  }

  const row = await dbGet(
    'select id, rating, author, comment, created_at from product_reviews where rowid = last_insert_rowid()'
  );
  return jsonResponse(
    {
      ok: true,
      item: row
        ? { id: row.id, rating: Number(row.rating) || rating, author: row.author || null, comment: row.comment || null, created_at: row.created_at || null }
        : null,
    },
    201,
    request
  );
}

// ---------- Targets APIs (admin + brand) ----------

async function apiListTargets(request) {
  const sess = await getSessionUser(request);
  if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
  const role = sess.user.role;
  const url = new URL(request.url);
  const brandName = (url.searchParams.get('brand') || '').trim();
  const product   = (url.searchParams.get('product') || '').trim();
  const clientId  = (url.searchParams.get('clientId') || '').trim();
  const uploaderRole = (url.searchParams.get('uploaderRole') || '').trim().toLowerCase();

  let sql = `
    select t.id, t.user_id, u.email as uploader_email, u.role as uploader_role,
      t.name, t.product, t.mind_url, t.video_url, t.image_url,
      t.is_active, t.created_at, b.name as brand
    from targets t
    left join brands b on b.id = t.brand_id
    left join users u on u.id = t.user_id
  `;
  const where = [];
  const params = [];

  if (role === 'brand') {
    const brandIds = (sess.user.brands || []).map(b => b.id);
    if (!brandIds.length) return jsonResponse({ items: [] }, 200, request);
    where.push(`t.brand_id in (${brandIds.map(() => '?').join(',')})`);
    params.push(...brandIds);
  }
  if (brandName) { where.push('b.name = ?');      params.push(brandName); }
  if (product)   { where.push('t.product = ?');   params.push(product);   }
  if (clientId && role === 'admin') { where.push('t.user_id = ?'); params.push(clientId); }
  if (uploaderRole && role === 'admin') {
    if (!['admin', 'brand', 'client'].includes(uploaderRole)) {
      return jsonResponse({ error: 'Invalid uploaderRole' }, 400, request);
    }
    where.push('lower(u.role) = lower(?)');
    params.push(uploaderRole);
  }

  if (where.length) sql += ' where ' + where.join(' and ');
  sql += ' order by t.created_at desc';

  const rows = await dbAll(sql, ...params);
  const items = rows.map(r => ({
    id: r.id,
    user_id: r.user_id,
    uploader_email: r.uploader_email || null,
    uploader_role: r.uploader_role || null,
    name: r.name,
    product: r.product,
    mindurl: r.mind_url,
    videourl: r.video_url,
    imageurl: r.image_url,
    is_active: !!r.is_active,
    created_at: r.created_at,
    brand: r.brand || null
  }));
  return jsonResponse({ items }, 200, request);
}

async function apiCreateTarget(request) {
  const sess = await getSessionUser(request);
  if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
  const body = await readJson(request);
  const name    = (body.name || '').trim();
  const product = (body.product || '').trim() || null;
  const mindUrl = (body.mind_url || '').trim();
  const videoUrl= (body.video_url || '').trim();
  const imageUrl= (body.image_url || '').trim() || null;
  let brandName = (body.brand || '').trim();

  if (!name || !mindUrl || !videoUrl) {
    return jsonResponse({ error: 'name, mind_url, video_url required' }, 400, request);
  }

  let brandId = null;
  if (sess.user.role === 'admin') {
    if (brandName) {
      let b = await dbGet('select id from brands where name = ?', brandName);
      if (!b) {
        await dbRun('insert into brands (name) values (?)', brandName);
        b = await dbGet('select id from brands where name = ?', brandName);
      }
      brandId = b.id;
    }
  } else if (sess.user.role === 'brand') {
    const brands = sess.user.brands || [];
    if (!brands.length) return jsonResponse({ error: 'Brand account has no brand assigned' }, 400, request);
    brandId = brands[0].id;
    brandName = brands[0].name;
  } else {
    return jsonResponse({ error: 'Forbidden' }, 403, request);
  }

  await dbRun(
    'insert into targets (user_id, brand_id, name, product, mind_url, video_url, image_url, is_active) values (?, ?, ?, ?, ?, ?, ?, 0)',
    sess.user.id, brandId, name, product, mindUrl, videoUrl, imageUrl
  );

  const row = await dbGet(
    `select t.id, t.name, t.product, t.mind_url, t.video_url, t.image_url,
            t.is_active, t.created_at, b.name as brand
     from targets t
     left join brands b on b.id = t.brand_id
     where t.rowid = last_insert_rowid()`
  );

  const item = row && {
    id: row.id,
    name: row.name,
    product: row.product,
    mindurl: row.mind_url,
    videourl: row.video_url,
    imageurl: row.image_url,
    is_active: !!row.is_active,
    created_at: row.created_at,
    brand: row.brand || brandName || null
  };
  return jsonResponse({ ok: true, item }, 201, request);
}

async function apiActivateTarget(request, id) {
  const sess = await getSessionUser(request);
  if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
  if (!id)   return jsonResponse({ error: 'id required' }, 400, request);

  const t = await dbGet(
    'select t.id, t.brand_id, t.product, b.name as brand from targets t left join brands b on b.id = t.brand_id where t.id = ?',
    id
  );
  if (!t) return jsonResponse({ error: 'Not found' }, 404, request);

  if (sess.user.role === 'brand') {
    const brandIds = (sess.user.brands || []).map(b => b.id);
    if (!brandIds.includes(t.brand_id)) return jsonResponse({ error: 'Forbidden' }, 403, request);
  }

  let maxActive = 3;
  if (t.brand_id != null) {
    const limitRow = await dbGet('select max_active from brand_limits where brand_id = ?', t.brand_id);
    if (limitRow && typeof limitRow.max_active === 'number') maxActive = limitRow.max_active;
  }
  const countRow = await dbGet(
    'select count(*) as c from targets where brand_id = ? and is_active = 1',
    t.brand_id
  );
  const activeCount = countRow ? countRow.c : 0;
  if (activeCount >= maxActive) {
    return jsonResponse(
      { error: 'Max active targets for brand reached', brand: t.brand, max: maxActive },
      400,
      request
    );
  }

  await dbRun(
    'update targets set is_active = 0 where brand_id = ? and product is ? and id != ?',
    t.brand_id,
    t.product,
    id
  );
  await dbRun('update targets set is_active = 1 where id = ?', id);
  return jsonResponse({ ok: true }, 200, request);
}

async function apiDeactivateTarget(request, id) {
  const sess = await getSessionUser(request);
  if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
  if (!id)   return jsonResponse({ error: 'id required' }, 400, request);

  const t = await dbGet('select id, brand_id from targets where id = ?', id);
  if (!t) return jsonResponse({ error: 'Not found' }, 404, request);
  if (sess.user.role === 'brand') {
    const brandIds = (sess.user.brands || []).map(b => b.id);
    if (!brandIds.includes(t.brand_id)) return jsonResponse({ error: 'Forbidden' }, 403, request);
  }
  await dbRun('update targets set is_active = 0 where id = ?', id);
  return jsonResponse({ ok: true }, 200, request);
}

async function apiDeleteTarget(request, id) {
  const sess = await getSessionUser(request);
  if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
  if (!id)   return jsonResponse({ error: 'id required' }, 400, request);

  const row = await dbGet('select id, brand_id, mind_url, video_url, image_url from targets where id = ?', id);
  if (!row) return jsonResponse({ error: 'Not found' }, 404, request);
  if (sess.user.role === 'brand') {
    const brandIds = (sess.user.brands || []).map(b => b.id);
    if (!brandIds.includes(row.brand_id)) return jsonResponse({ error: 'Forbidden' }, 403, request);
  }

  await dbRun('delete from targets where id = ?', id);

  const assets = [row.mind_url, row.video_url, row.image_url].filter(Boolean);
  const results = [];
  for (const u of assets) {
    try {
      const key = keyFromPublicUrl(u);
      await ASSETS_BUCKET.delete(key);
      results.push({ url: u, ok: true });
    } catch (e) {
      results.push({ url: u, ok: false, error: String(e) });
    }
  }
  return jsonResponse({ ok: true, deleteResults: results }, 200, request);
}

// ---------- Viewer API ----------

async function apiViewerActive(request) {
  const url = new URL(request.url);
  const brand   = (url.searchParams.get('brand') || '').trim();
  const product = (url.searchParams.get('product') || '').trim();

  // Step 12 integration: if a product slug is provided, prefer the catalog link
  // (products.ar_target_id) so ecommerce can drive AR without duplicating product
  // strings into targets.
  if (product) {
    try {
      let psql = `
        select p.ar_target_id, p.slug, b.name as brand
        from products p
        left join brands b on b.id = p.brand_id
        where lower(p.slug) = lower(?)
          and p.is_published = 1
      `;
      const pparams = [product];
      if (brand) {
        psql += ' and lower(b.name) = lower(?)';
        pparams.push(brand);
      }
      psql += ' limit 1';

      const prow = await dbGet(psql, ...pparams);
      const targetId = prow?.ar_target_id != null ? Number(prow.ar_target_id) : null;
      if (targetId != null && Number.isFinite(targetId)) {
        const t = await dbGet(`
          select t.id, t.name, t.product, t.mind_url, t.video_url, t.image_url,
                 t.is_active, t.created_at, b.name as brand
          from targets t
          left join brands b on b.id = t.brand_id
          where t.id = ?
          limit 1
        `, targetId);

        if (t && t.is_active) {
          return jsonResponse({
            id: t.id,
            name: t.name,
            product: t.product,
            brand: t.brand || null,
            mindurl: t.mind_url,
            videourl: t.video_url,
            imageurl: t.image_url,
            is_active: !!t.is_active,
            created_at: t.created_at,
            source: 'product_link'
          }, 200, request);
        }
      }
    } catch (e) {
      // If products table isn't present yet (or any other issue), fall back to legacy.
      console.warn('viewer active: product link lookup failed; falling back', e);
    }
  }

  let sql = `
    select t.id, t.name, t.product, t.mind_url, t.video_url, t.image_url,
           t.is_active, t.created_at, b.name as brand
    from targets t
    left join brands b on b.id = t.brand_id
    where t.is_active = 1
  `;
  const where = [];
  const params = [];

  if (brand)   { where.push('lower(b.name) = lower(?)');    params.push(brand);   }
  if (product) { where.push('lower(t.product) = lower(?)'); params.push(product); }

  if (!brand && !product) {
    where.push('t.brand_id is null');
    where.push('t.product is null');
  }
  if (where.length) sql += ' and ' + where.join(' and ');
  sql += ' order by t.created_at desc limit 1';

  const row = await dbGet(sql, ...params);
  if (!row) return jsonResponse({ error: 'No active target found' }, 404, request);

  return jsonResponse({
    id: row.id,
    name: row.name,
    product: row.product,
    brand: row.brand || null,
    mindurl: row.mind_url,
    videourl: row.video_url,
    imageurl: row.image_url,
    is_active: !!row.is_active,
    created_at: row.created_at,
    source: 'targets_active'
  }, 200, request);
}

// ---------- Existing R2 handlers (unchanged from your current worker) ----------

async function handleGet(request) {
  try {
    if (!ASSETS_BUCKET || typeof ASSETS_BUCKET.get !== 'function') {
      return new Response(
        JSON.stringify({ error: 'R2 binding missing: ASSETS_BUCKET' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(request.url);
    let key = url.pathname.replace(/^\//, '');
    if (!key) return new Response('Not Found', { status: 404 });

    const obj = await ASSETS_BUCKET.get(key, { allowUnencrypted: true });
    if (!obj || !obj.body) return new Response('Not Found', { status: 404 });

    const headers = new Headers();
    const ct = (obj.httpMetadata && obj.httpMetadata.contentType) ||
               (obj.customMetadata && obj.customMetadata.contentType) ||
               'application/octet-stream';
    headers.set('Content-Type', ct);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');

    const allowed = getAllowedOrigins();
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
    if (!ASSETS_BUCKET || typeof ASSETS_BUCKET.put !== 'function') {
      return jsonResponse({ error: 'R2 binding missing: ASSETS_BUCKET' }, 500, request);
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!file) return jsonResponse({ error: 'file required' }, 400, request);

    const path = (form.get('path') || 'videos').toString();
    const filename = (form.get('filename') || (file.name || `${Date.now()}`)).toString();
    const key = `${path}/${Date.now()}-${filename}`;

    await ASSETS_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' }
    });

    let assetsDomain = (typeof ASSETS_DOMAIN === 'string' ? ASSETS_DOMAIN : '') || '';
    assetsDomain = assetsDomain.replace(/\/$/, '');
    if (assetsDomain && !/^https?:\/\//i.test(assetsDomain)) assetsDomain = 'https://' + assetsDomain;
    const publicUrl = `${assetsDomain}/${key}`;

    const headers = buildCorsHeaders(request);
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ ok: true, key, url: publicUrl }), { status: 200, headers });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500, request);
  }
}

async function handleDelete(request) {
  try {
    if (!ASSETS_BUCKET || typeof ASSETS_BUCKET.delete !== 'function') {
      return jsonResponse({ error: 'R2 binding missing: ASSETS_BUCKET' }, 500, request);
    }

    const provided = request.headers.get('x-admin-key') || '';
    if (!provided || provided !== (typeof WORKER_DELETE_KEY === 'string' ? WORKER_DELETE_KEY : '')) {
      return jsonResponse({ error: 'unauthorized' }, 401, request);
    }
    const body = await readJson(request);
    const key = body.key || (body.url ? keyFromPublicUrl(body.url) : null);
    if (!key) return jsonResponse({ error: 'key or url required' }, 400, request);

    await ASSETS_BUCKET.delete(key);

    
    try {
      if (CF_ZONE_ID && CF_API_TOKEN) {
        await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: [`${ASSETS_DOMAIN.replace(/\/$/, '')}/${key}`] })
        });
      }
    } catch {
      // ignore purge errors 1
    }

    return jsonResponse({ ok: true }, 200, request);
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500, request);
  }
}

async function handlePurge(request) {
  try {
    const body = await readJson(request);
    const urls = body.urls || [];
    if (!Array.isArray(urls) || !urls.length) return jsonResponse({ error: 'urls required' }, 400, request);
    if (!CF_ZONE_ID || !CF_API_TOKEN)       return jsonResponse({ error: 'CF purge not configured' }, 500, request);

    const resp = await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: urls })
    });
    const j = await resp.json().catch(() => ({}));
    return jsonResponse({ ok: true, result: j }, 200, request);
  } catch (e) {
  

    return jsonResponse({ error: String(e) }, 500, request);
  }
}

