// The QR placer's saved art box: validated on save, sent to Printful as the art layer's
// exact position (only for the art file it was placed on), and handed to the dashboard
// for each shirt's own print file. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeHarness, seedUser } from './helpers/worker-harness.mjs';

const SITE = 'https://shop.inrl.co';
const ART = 'https://assets.test/products/19/print/front.png';
const QR = { placement: 'front', size_in: 2.5, top_in: 13.1, left_in: 9.2, area_width_in: 12, area_height_in: 16 };
const BOX = { url: ART, top_in: 0, left_in: 0.3375, width_in: 11.325, height_in: 16 };

async function setup({ qr = { ...QR, art: BOX }, art = ART } = {}) {
  const secret = 'whsec_test';
  const h = await makeHarness({ PUBLIC_SITE_URL: SITE, STRIPE_WEBHOOK_SECRET: secret, PRINTFUL_API_KEY: 'pf_test' });
  const admin = seedUser(h, 'admin1', 'admin');
  seedUser(h, 'buyer1', 'client');
  h.exec("insert into targets (id, user_id, name, mind_url, video_url, is_active) values (7, 'admin1', 't', 'https://a/m.mind', 'https://a/v.mp4', 1)");
  h.exec(`insert into products (id, title, slug, price_cents, is_published, ar_target_id, printful_catalog_product_id,
                                printful_variant_map, printful_design_images, printful_qr)
          values (19, 'INRL BETA', 'inrl-beta', 1900, 1, 7, 760, ?, ?, ?)`,
    JSON.stringify({ M: '19397' }), JSON.stringify({ front: art }), JSON.stringify(qr));
  h.exec(`insert into orders (id, user_id, email, first_name, last_name, address, country, state, zip, total_cents,
                              items_json, status, payment_status)
          values ('ord_1', 'buyer1', 'buyer1@test', 'B', 'One', '1 St', 'US', 'CA', '90001', 1900, ?, 'pending_payment', 'unpaid')`,
    JSON.stringify([{ slug: 'inrl-beta', size: 'M', qty: 1 }]));
  const sent = [];
  h.onFetch((url, opts) => {
    if (url.includes('printful.com') && url.endsWith('/orders') && opts.method === 'POST') {
      sent.push(JSON.parse(opts.body));
      return Response.json({ data: { id: 555 } });
    }
    if (url.includes('printful.com') && url.endsWith('/orders/555/confirm')) return Response.json({ data: { id: 555, status: 'pending' } });
    return new Response('{}', { status: 404 });
  });
  const pay = async () => {
    const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', amount_total: 1900, metadata: { order_id: 'ord_1' } } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    return h.callRaw('POST', '/api/webhooks/stripe', body, { 'Stripe-Signature': `t=${t},v1=${sig}` });
  };
  return { h, admin, sent, pay };
}

test('Printful gets the art at its saved box and the QR at its saved position', async () => {
  const { h, sent, pay } = await setup();
  try {
    assert.equal((await pay()).status, 200);
    assert.equal(sent.length, 1, 'one Printful order');
    const [front] = sent[0].items[0].placements;
    assert.equal(front.placement, 'front');
    assert.deepEqual(front.layers[0], {
      type: 'file', url: ART,
      position: { area_width: 12, area_height: 16, width: 11.325, height: 16, top: 0, left: 0.3375 },
    });
    assert.deepEqual(front.layers[1].position, { area_width: 12, area_height: 16, width: 2.5, height: 2.5, top: 13.1, left: 9.2 });
    assert.equal(h.q("select printful_status from orders where id = 'ord_1'")[0].printful_status, 'pending');
  } finally { h.restore(); }
});

test('a print file replaced after placing goes back to Printful\'s own fit; no box means no art position', async () => {
  for (const opts of [{ art: 'https://assets.test/products/19/print/front-v2.png' }, { qr: QR }]) {
    const { h, sent, pay } = await setup(opts);
    try {
      assert.equal((await pay()).status, 200);
      const [front] = sent[0].items[0].placements;
      assert.equal(front.layers[0].position, undefined);
      assert.ok(front.layers[1].position, 'QR keeps its position');
    } finally { h.restore(); }
  }
});

test('saving QR settings refuses an art box outside the print area or without an http(s) URL', async () => {
  const { h, admin } = await setup();
  try {
    for (const art of [{ ...BOX, width_in: 12.5 }, { ...BOX, url: 'javascript:alert(1)' }, { ...BOX, height_in: 0 }]) {
      const r = await h.call('POST', '/api/products/19', { token: admin, body: { printful_qr: { ...QR, art } } });
      assert.equal(r.status, 400, JSON.stringify(art));
    }
    const ok = await h.call('POST', '/api/products/19', { token: admin, body: { printful_qr: { ...QR, art: BOX } } });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(JSON.parse(h.q('select printful_qr from products where id = 19')[0].printful_qr).art, BOX);
  } finally { h.restore(); }
});

test('the Shirts view hands the dashboard the QR settings and art file for each shirt\'s print file', async () => {
  const { h, admin, pay } = await setup();
  try {
    await pay();
    const r = await h.call('GET', '/api/admin/orders/ord_1/pieces', { token: admin });
    assert.equal(r.status, 200);
    const [shirt] = r.json.items;
    assert.ok(shirt.qr_url);
    assert.equal(shirt.print.art_url, ART);
    assert.deepEqual(shirt.print.qr, { ...QR, art: BOX });
  } finally { h.restore(); }
});
