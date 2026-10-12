// Admin self-fulfil (shirts and QR codes without Printful) and the rule that a QR is never
// printed without PUBLIC_SITE_URL. Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeHarness, seedUser } from './helpers/worker-harness.mjs';

const SITE = 'https://shop.inrl.co';
// R2 key of a stored QR from its public URL.
const qrKey = u => decodeURIComponent(new URL(u).pathname).replace(/^\/+/, '').replace(/^api\/r2\//, '');

async function setup(vars, { stripeStatus = 'open', withSession = true } = {}) {
  const h = await makeHarness(vars);
  const admin = seedUser(h, 'admin1', 'admin');
  const buyer = seedUser(h, 'buyer1', 'client');
  h.exec("insert into targets (id, user_id, name, mind_url, video_url, is_active) values (7, 'admin1', 't', 'https://a/m.mind', 'https://a/v.mp4', 1)");
  h.exec(`insert into products (id, title, slug, price_cents, is_published, ar_target_id, printful_qr)
          values (19, 'INRL BETA', 'inrl-beta', 1900, 1, 7, ?)`,
    JSON.stringify({ placement: 'front', size_in: 2.5, top_in: 13, left_in: 9, area_width_in: 12, area_height_in: 16 }));
  h.exec(`insert into orders (id, user_id, email, first_name, last_name, address, country, state, zip, total_cents,
                              items_json, status, payment_status, stripe_session_id)
          values ('ord_1', 'buyer1', 'buyer1@test', 'B', 'One', '1 St', 'US', 'CA', '90001', 1900, ?, 'pending_payment', 'unpaid', ?)`,
    JSON.stringify([{ slug: 'inrl-beta', size: 'M', qty: 2, name: 'INRL BETA (M)' }]), withSession ? 'cs_1' : null);
  h.onFetch((url, opts) => {
    if (url.endsWith('/checkout/sessions/cs_1')) return Response.json({ id: 'cs_1', status: stripeStatus });
    if (url.endsWith('/checkout/sessions/cs_1/expire')) return Response.json({ id: 'cs_1', status: 'expired' });
    return new Response('{}', { status: 404 });
  });
  return { h, admin, buyer };
}

const order = h => h.q("select status, payment_status, printful_status, printful_order_id from orders where id = 'ord_1'")[0];
const units = h => h.q("select claim_code, owner_user_id, qr_url from garment_units where order_id = 'ord_1' order by unit_index");

test('self-fulfil mints the buyer\'s shirts with QR codes on PUBLIC_SITE_URL and sends nothing to Printful', async () => {
  const { h, admin } = await setup({ PUBLIC_SITE_URL: SITE + '/' });
  try {
    const r = await h.call('POST', '/api/admin/orders/ord_1/self-fulfil', { token: admin });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { ok: true, shirts: 2, qr_codes: 2 });
    assert.deepEqual(order(h), { status: 'paid', payment_status: 'paid', printful_status: 'self', printful_order_id: null });
    const us = units(h);
    assert.equal(us.length, 2);
    for (const u of us) {
      assert.equal(u.owner_user_id, 'buyer1');
      const obj = h.ASSETS_BUCKET.objects.get(qrKey(u.qr_url));
      assert.ok(obj, 'QR image stored');
      assert.equal(obj.customMetadata.size_in, '2.5');
      assert.match(qrKey(u.qr_url), new RegExp('^qr/' + u.claim_code + '-[a-z0-9]+\\.png$'));
    }
    const pieces = await h.call('GET', '/api/admin/orders/ord_1/pieces', { token: admin });
    assert.deepEqual(pieces.json.items.map(i => i.link), us.map(u => `${SITE}/p/${u.claim_code}`));
    assert.ok(h.outside.some(c => c.url.endsWith('/checkout/sessions/cs_1/expire') && c.method === 'POST'), 'open Stripe session expired');
    assert.ok(!h.outside.some(c => c.url.includes('printful')), 'Printful never called');
  } finally { h.restore(); }
});

test('without PUBLIC_SITE_URL no QR is stored, on-screen links keep the request host, and a rerun fills the QR in', async () => {
  const { h, admin, buyer } = await setup({});
  try {
    const r = await h.call('POST', '/api/admin/orders/ord_1/self-fulfil', { token: admin });
    assert.equal(r.status, 502);
    assert.match(r.json.error, /PUBLIC_SITE_URL/);
    assert.equal(order(h).printful_status, 'self');
    assert.equal(units(h).length, 2);
    assert.ok(units(h).every(u => u.qr_url === null));
    assert.equal([...h.ASSETS_BUCKET.objects.keys()].filter(k => k.startsWith('qr/')).length, 0);

    const code = units(h)[0].claim_code;
    const pieces = await h.call('GET', '/api/admin/orders/ord_1/pieces', { token: admin, host: 'https://shop.example' });
    assert.equal(pieces.json.items[0].link, `https://shop.example/p/${code}`);
    const unitId = h.q('select id from garment_units where claim_code = ?', code)[0].id;
    const piece = await h.call('GET', `/api/pieces/${unitId}`, { token: buyer, host: 'https://shop.example' });
    assert.equal(piece.json.viewer_url, `https://shop.example/p/${code}`);

    h.env.PUBLIC_SITE_URL = SITE;
    const again = await h.call('POST', '/api/admin/orders/ord_1/self-fulfil', { token: admin });
    assert.equal(again.status, 200, again.text);
    assert.deepEqual(again.json, { ok: true, shirts: 2, qr_codes: 2 });
    assert.equal(units(h).length, 2, 'rerun mints nothing new');
  } finally { h.restore(); }
});

test('refused when Stripe already took the payment, for non-admins, and Resubmit to Printful refuses a self order', async () => {
  const paid = await setup({ PUBLIC_SITE_URL: SITE }, { stripeStatus: 'complete' });
  try {
    const r = await paid.h.call('POST', '/api/admin/orders/ord_1/self-fulfil', { token: paid.admin });
    assert.equal(r.status, 409);
    assert.equal(order(paid.h).payment_status, 'unpaid');
    assert.equal(units(paid.h).length, 0);
    const nonAdmin = await paid.h.call('POST', '/api/admin/orders/ord_1/self-fulfil', { token: paid.buyer });
    assert.equal(nonAdmin.status, 403);
  } finally { paid.h.restore(); }

  const self = await setup({ PUBLIC_SITE_URL: SITE }, { withSession: false });
  try {
    assert.equal((await self.h.call('POST', '/api/admin/orders/ord_1/self-fulfil', { token: self.admin })).status, 200);
    const resub = await self.h.call('POST', '/api/admin/orders/ord_1/resubmit', { token: self.admin });
    assert.equal(resub.status, 409);
    assert.ok(!self.h.outside.some(c => c.url.includes('printful')));
  } finally { self.h.restore(); }
});

test('a late Stripe "session expired" event leaves a self-fulfilled order paid', async () => {
  const secret = 'whsec_test';
  const { h, admin } = await setup({ PUBLIC_SITE_URL: SITE, STRIPE_WEBHOOK_SECRET: secret });
  try {
    assert.equal((await h.call('POST', '/api/admin/orders/ord_1/self-fulfil', { token: admin })).status, 200);
    const body = JSON.stringify({ type: 'checkout.session.expired', data: { object: { id: 'cs_1', metadata: { order_id: 'ord_1' } } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    const res = await h.callRaw('POST', '/api/webhooks/stripe', body, { 'Stripe-Signature': `t=${t},v1=${sig}` });
    assert.equal(res.status, 200);
    assert.deepEqual(order(h), { status: 'paid', payment_status: 'paid', printful_status: 'self', printful_order_id: null });
  } finally { h.restore(); }
});

test('self-fulfil reports a line whose product no longer exists instead of passing with no shirts', async () => {
  const { h, admin } = await setup({ PUBLIC_SITE_URL: SITE }, { withSession: false });
  try {
    h.exec('update orders set items_json = ? where id = ?', JSON.stringify([
      { slug: 'hoodie', size: 'S', qty: 1, name: 'Uni (S)' },
      { slug: 'inrl-beta', size: 'M', qty: 1, name: 'INRL BETA (M)' },
    ]), 'ord_1');
    const r = await h.call('POST', '/api/admin/orders/ord_1/self-fulfil', { token: admin });
    assert.equal(r.status, 502);
    assert.match(r.json.error, /line 1 \(hoodie\).*no longer exists/);
    assert.deepEqual(h.q("select item_index from garment_units where order_id = 'ord_1'"), [{ item_index: 1 }], 'the line with a product still gets its shirt');
  } finally { h.restore(); }
});

test('an admin scan of a shirt is not counted and shows its order line; other scans are counted', async () => {
  const { h, admin, buyer } = await setup({ PUBLIC_SITE_URL: SITE });
  try {
    assert.equal((await h.call('POST', '/api/admin/orders/ord_1/self-fulfil', { token: admin })).status, 200);
    const { claim_code: code, id } = h.q("select claim_code, id from garment_units where order_id = 'ord_1' and unit_index = 1")[0];
    const count = () => h.q('select scan_count from garment_units where id = ?', id)[0].scan_count;

    const asAdmin = await h.call('GET', `/api/viewer/piece?code=${code}`, { token: admin });
    assert.equal(asAdmin.status, 200);
    assert.deepEqual(asAdmin.json.admin, {
      unit_id: id, claim_code: code, order_id: 'ord_1', line: 1, shirt: 2, size: 'M', owner_email: 'buyer1@test', verified_at: null,
    });
    assert.equal(count(), 0, 'admin scan not counted');

    const anon = await h.call('GET', `/api/viewer/piece?code=${code}`);
    assert.equal(anon.json.admin, null);
    await h.call('GET', `/api/viewer/piece?code=${code}`, { token: buyer });
    assert.equal(count(), 2, 'anonymous and customer scans counted');

    assert.equal((await h.call('POST', `/api/admin/pieces/${id}/verify`, { token: buyer })).status, 403);
    const v = await h.call('POST', `/api/admin/pieces/${id}/verify`, { token: admin });
    assert.equal(v.status, 200);
    assert.match(v.json.verified_at, /^\d{4}-\d\d-\d\dT/);
    const pieces = await h.call('GET', '/api/admin/orders/ord_1/pieces', { token: admin });
    assert.equal(pieces.json.items.find(i => i.id === id).verified_at, v.json.verified_at);
  } finally { h.restore(); }
});

test('a shirt without a QR says why: unpaid, then PUBLIC_SITE_URL missing', async () => {
  const { h, admin } = await setup({});
  try {
    h.exec("insert into garment_units (id, claim_code, product_id, order_id, item_index, unit_index) values ('u_x', 'XXXX-0000', 19, 'ord_1', 0, 0)");
    let r = await h.call('GET', '/api/admin/orders/ord_1/pieces', { token: admin });
    assert.equal(r.json.items[0].issue, 'unpaid');
    h.exec("update orders set payment_status = 'paid' where id = 'ord_1'");
    r = await h.call('GET', '/api/admin/orders/ord_1/pieces', { token: admin });
    assert.equal(r.json.items[0].issue, 'site_url');
    assert.equal(r.json.items[0].size, 'M');
  } finally { h.restore(); }
});

test('the QR placer gets a sample emblem PNG at the requested width; admins only', async () => {
  const { h, admin, buyer } = await setup({ PUBLIC_SITE_URL: SITE });
  try {
    const worker = await h.handle(new Request('https://edge.test/api/admin/qr-sample?size_in=2.5', { headers: { Cookie: `session=${admin}` } }));
    assert.equal(worker.status, 200);
    assert.equal(worker.headers.get('content-type'), 'image/png');
    const png = new Uint8Array(await worker.arrayBuffer());
    assert.equal(new DataView(png.buffer).getUint32(16), 750, '2.5 in at 300 DPI');
    assert.equal((await h.call('GET', '/api/admin/qr-sample?size_in=2.5', { token: buyer })).status, 403);
    assert.equal((await h.call('GET', '/api/admin/qr-sample?size_in=9', { token: admin })).status, 400);
  } finally { h.restore(); }
});

test('the shirt page makes a missing QR, lets the owner download it, and gives the print file to admins only', async () => {
  const { h, admin, buyer } = await setup({ PUBLIC_SITE_URL: SITE });
  try {
    // A shirt made outside checkout (no order, no QR yet), owned by the buyer.
    h.exec("insert into garment_units (id, claim_code, product_id, owner_user_id, claimed_at) values ('unit_t', 'FQP5-KZ5W', 19, 'buyer1', '2026-10-12T00:00:00Z')");
    const own = await h.call('GET', '/api/pieces/unit_t', { token: buyer });
    assert.equal(own.status, 200, own.text);
    assert.match(qrKey(own.json.qr_url || ''), /^qr\/FQP5-KZ5W-[a-z0-9]+\.png$/, 'QR generated on view');
    assert.ok(h.ASSETS_BUCKET.objects.has(qrKey(own.json.qr_url)));
    assert.equal(own.json.is_owner, true);
    assert.equal(own.json.print, null, 'owner gets no print file');

    const asAdmin = await h.call('GET', '/api/pieces/unit_t', { token: admin });
    assert.equal(asAdmin.status, 200);
    assert.equal(asAdmin.json.is_owner, false);
    assert.equal(asAdmin.json.print.qr.placement, 'front', 'admin gets the print spec');

    seedUser(h, 'other1', 'client');
    assert.equal((await h.call('GET', '/api/pieces/unit_t', { token: 'sess_other1' })).status, 404, 'other customers cannot see it');
    assert.equal((await h.call('PATCH', '/api/pieces/unit_t', { token: admin, body: { nickname: 'x' } })).status, 404, 'admin view is read-only');
  } finally { h.restore(); }
});
