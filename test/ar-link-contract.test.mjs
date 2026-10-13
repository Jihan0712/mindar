// THE AR LINK CONTRACT — printed shirts depend on it and can never be re-printed.
// Every QR on a shirt encodes https://shop.inrl.co/p/<claim_code>. That link must keep
// opening the shirt's AR forever, whatever else changes:
//   1. /p/<code> redirects to /viewer?piece=<code>                       (_redirects)
//   2. viewer.html asks /api/viewer/piece?code=<code>                    (viewer.html)
//   3. apiViewerPiece answers with the fields viewer.html reads, even if the product is
//      later unpublished or its target switched off                      (worker)
//   4. a shirt's QR encodes exactly <PUBLIC_SITE_URL>/p/<code>           (worker)
// If one of these tests fails, the change breaks shirts already in people's hands: fix the
// change, not the test. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness, seedUser, loadQr } from './helpers/worker-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://shop.inrl.co';
const read = p => readFileSync(join(ROOT, p), 'utf8');

test('1. /p/<code> redirects to the viewer with the code (_redirects)', () => {
  const rules = read('_redirects').split(/\r?\n/).map(l => l.trim().split(/\s+/));
  const rule = rules.find(r => r[0] === '/p/:code');
  assert.deepEqual(rule, ['/p/:code', '/viewer?piece=:code', '302'], 'the /p/:code rule must stay exactly as printed shirts expect');
  // Nothing earlier in the file may catch /p/... first.
  const i = rules.indexOf(rule);
  for (const r of rules.slice(0, i)) assert.ok(!r[0] || !('/p/X'.startsWith(r[0].replace(/[:*].*$/, '')) && r[0] !== '/'), `rule ${r[0]} would shadow /p/:code`);
});

test('2. viewer.html reads ?piece= and asks /api/viewer/piece?code=, and uses the contract fields', () => {
  const html = read('viewer.html');
  assert.match(html, /params\.get\('piece'\)/, 'viewer reads the piece query parameter');
  assert.match(html, /qs\.set\('code', piece\)/, 'viewer passes it as code');
  assert.match(html, /\/api\/viewer\/piece\?/, 'viewer calls /api/viewer/piece');
  for (const field of ['mindurl', 'videourl', 'imageurl']) assert.ok(html.includes(field), `viewer still reads ${field}`);
});

async function shirt({ published = 1, active = 1, layer = false } = {}) {
  const h = await makeHarness({ PUBLIC_SITE_URL: SITE });
  seedUser(h, 'owner1', 'client');
  h.exec(`insert into targets (id, user_id, name, mind_url, video_url, image_url, is_active)
          values (7, 'owner1', 'BETA', 'https://a/m.mind', 'https://a/default.mp4', 'https://a/marker.jpg', ?)`, active);
  h.exec(`insert into products (id, title, slug, price_cents, is_published, ar_target_id) values (19, 'INRL BETA', 'inrl-beta', 2300, ?, 7)`, published);
  h.exec("insert into garment_units (id, claim_code, product_id, owner_user_id) values ('u1', 'FQP5-KZ5W', 19, 'owner1')");
  if (layer) h.exec("insert into garment_layers (unit_id, video_url, version) values ('u1', 'https://a/owner.mp4', 1)");
  return h;
}

test('3. /api/viewer/piece answers with marker + video for anyone, even if unpublished or switched off', async () => {
  for (const opts of [{}, { published: 0 }, { active: 0 }, { published: 0, active: 0 }]) {
    const h = await shirt(opts);
    try {
      const r = await h.call('GET', '/api/viewer/piece?code=FQP5-KZ5W'); // no session: a stranger scanning the shirt
      assert.equal(r.status, 200, JSON.stringify(opts) + ' ' + r.text);
      assert.equal(r.json.mindurl, 'https://a/m.mind');
      assert.equal(r.json.videourl, 'https://a/default.mp4');
      assert.equal(r.json.imageurl, 'https://a/marker.jpg');
      assert.ok(Number.isFinite(r.json.version));
      // Codes are matched case-insensitively (people type them).
      assert.equal((await h.call('GET', '/api/viewer/piece?code=fqp5-kz5w')).status, 200);
    } finally { h.restore(); }
  }
});

test("3b. the shirt's own video wins over the default, and a missing shirt is a clean 404", async () => {
  const h = await shirt({ layer: true });
  try {
    assert.equal((await h.call('GET', '/api/viewer/piece?code=FQP5-KZ5W')).json.videourl, 'https://a/owner.mp4');
    assert.equal((await h.call('GET', '/api/viewer/piece?code=NOPE-0000')).status, 404);
  } finally { h.restore(); }
});

test('4. a shirt\'s stored QR encodes exactly <PUBLIC_SITE_URL>/p/<code>', async () => {
  const h = await shirt();
  try {
    const r = await h.call('GET', '/api/pieces/u1', { token: 'sess_owner1' }); // makes the QR if missing
    assert.equal(r.json.viewer_url, `${SITE}/p/FQP5-KZ5W`);
    const key = decodeURIComponent(new URL(r.json.qr_url).pathname).replace(/^\/+/, '').replace(/^api\/r2\//, '');
    const stored = h.ASSETS_BUCKET.objects.get(key);
    // Rendering is deterministic: the stored PNG must equal a fresh render of the exact link.
    const QR = await loadQr();
    const { png } = await QR.qrPng(`${SITE}/p/FQP5-KZ5W`, Number(stored.customMetadata.size_in));
    assert.deepEqual(Buffer.from(stored.body), Buffer.from(png), 'stored QR encodes the /p/<code> link');
  } finally { h.restore(); }
});
