// Runs cloudflare/worker/index.js in Node: a D1 stand-in on node:sqlite (schema from
// sql/d1_schema.sql plus the sql/*.sql migrations), a Map-backed R2 bucket, and a fetch
// stub for outside APIs. No dependencies beyond Node 24.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Migrations that rebuild or delete tables; the base schema already has their result.
const SKIP_SQL = new Set([
  'd1_schema.sql', 'fix_users_role_migration.sql', 'garment_units_restrict_migration.sql',
  'cleanup_unowned_test_pieces.sql', 'target_brand_backfill.sql',
]);

function statements(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').split(/;\s*(?:\r?\n|$)/)
    .map(s => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
}

function makeDb() {
  const db = new DatabaseSync(':memory:');
  for (const st of statements(readFileSync(join(ROOT, 'sql', 'd1_schema.sql'), 'utf8'))) db.exec(st);
  for (const f of readdirSync(join(ROOT, 'sql')).filter(f => f.endsWith('.sql') && !SKIP_SQL.has(f)).sort()) {
    for (const st of statements(readFileSync(join(ROOT, 'sql', f), 'utf8'))) {
      try { db.exec(st); } catch { /* column/table already there */ }
    }
  }
  const val = v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  const stmt = (sql, params = []) => ({
    bind: (...p) => stmt(sql, p.map(val)),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => {
      const r = db.prepare(sql).run(...params);
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return { raw: db, prepare: sql => stmt(sql), batch: async list => Promise.all(list.map(s => s.run())) };
}

function makeBucket() {
  const objects = new Map();
  return {
    objects,
    put: async (key, body, opts = {}) => {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, { body: bytes, size: bytes.length, httpMetadata: opts.httpMetadata || {}, customMetadata: opts.customMetadata || {} });
    },
    head: async key => (objects.has(key) ? { size: objects.get(key).size, customMetadata: objects.get(key).customMetadata } : null),
    get: async key => {
      const o = objects.get(key);
      return o ? { ...o, body: new Blob([o.body]).stream() } : null;
    },
    delete: async key => { objects.delete(key); },
  };
}

let workerPromise;
async function loadWorker() {
  // The worker is an ES module in a .js file outside any "type": "module" package.
  workerPromise ||= (async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mindar-worker-'));
    const file = join(dir, 'worker.mjs');
    // Also export the inline QR module so its output can be checked directly.
    writeFileSync(file, readFileSync(join(ROOT, 'cloudflare', 'worker', 'index.js'), 'utf8') + '\nexport { QR as __QR };\n');
    const mod = await import(pathToFileURL(file).href);
    return Object.assign(mod.default, { QR: mod.__QR });
  })();
  return workerPromise;
}

export async function loadQr() {
  return (await loadWorker()).QR;
}

export async function makeHarness(vars = {}) {
  const worker = await loadWorker();
  const DB = makeDb();
  const ASSETS_BUCKET = makeBucket();
  const outside = [];
  let outsideHandler = () => new Response('{}', { status: 404 });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    outside.push({ url: String(url), method: (opts && opts.method) || 'GET' });
    return outsideHandler(String(url), opts);
  };
  const env = { DB, ASSETS_BUCKET, ASSETS_DOMAIN: 'https://assets.test', STRIPE_SECRET_KEY: 'sk_test_x', ...vars };

  return {
    DB, ASSETS_BUCKET, env, outside,
    onFetch(fn) { outsideHandler = fn; },
    restore() { globalThis.fetch = realFetch; },
    handle: request => worker.fetch(request, env, { waitUntil() {} }),
    q: (sql, ...p) => DB.raw.prepare(sql).all(...p).map(r => ({ ...r })),
    exec: (sql, ...p) => DB.raw.prepare(sql).run(...p),
    async call(method, path, { token, body, host = 'https://edge.test' } = {}) {
      const headers = {};
      if (token) headers.Cookie = `session=${token}`;
      return this.callRaw(method, path, body === undefined ? undefined : JSON.stringify(body), headers, host);
    },
    async callRaw(method, path, body, headers = {}, host = 'https://edge.test') {
      const res = await worker.fetch(new Request(host + path, {
        method, headers: { 'Content-Type': 'application/json', ...headers }, body,
      }), env, { waitUntil() {} });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      return { status: res.status, json, text };
    },
  };
}

export function seedUser(h, id, role) {
  h.exec("insert into users (id, email, password_hash, role) values (?, ?, 'x', ?)", id, `${id}@test`, role);
  const token = `sess_${id}`;
  h.exec('insert into sessions (token, user_id) values (?, ?)', token, id);
  return token;
}
