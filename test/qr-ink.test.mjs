// A placeholder QR printed in a colour: each shirt's QR is printed in that ink on a
// transparent background (no white backing), and a black placeholder keeps the classic
// black-on-white emblem. These checks read every module centre of the coloured emblem and
// follow the colour from the saved placement to the QR stored for a paid order. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { createHmac } from 'node:crypto';
import { loadQr, makeHarness, seedUser } from './helpers/worker-harness.mjs';

// 8-bit PNG, filter type 0 rows (what qrPng writes) -> { width, type, px(x, y) -> [r, g, b, a] }
function decodePng(png) {
  png = Buffer.from(png);
  let o = 8, width = 0, height = 0, type = 0;
  const idat = [];
  while (o < png.length) {
    const len = png.readUInt32BE(o), kind = png.toString('latin1', o + 4, o + 8);
    if (kind === 'IHDR') { width = png.readUInt32BE(o + 8); height = png.readUInt32BE(o + 12); assert.equal(png[o + 16], 8); type = png[o + 17]; }
    if (kind === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const ch = type === 6 ? 4 : 2, raw = inflateSync(Buffer.concat(idat)), stride = width * ch + 1;
  for (let y = 0; y < height; y++) assert.equal(raw[y * stride], 0, 'filter type 0');
  const px = (x, y) => {
    const i = y * stride + 1 + x * ch;
    return ch === 4 ? [raw[i], raw[i + 1], raw[i + 2], raw[i + 3]] : [raw[i], raw[i], raw[i], raw[i + 1]];
  };
  return { width, type, px };
}

const LINK = 'https://shop.inrl.co/p/K7QX-9MPZ';

for (const ink of ['#0e8fa3', '#c0392b', '#f5d90a']) {
  test(`a ${ink} emblem: dark modules solid ink, light modules, margin and outside fully transparent`, async () => {
    const QR = await loadQr();
    const { size, modules } = QR.qrMatrix(LINK);
    const L = QR.emblemLayout(LINK);
    const { png, pixels, sizeIn } = await QR.qrPng(LINK, 2.5, ink);
    assert.equal(pixels, 750); assert.equal(sizeIn, 2.5);
    const img = decodePng(png);
    assert.equal(img.type, 6, 'RGBA');
    const rgb = [1, 3, 5].map(i => parseInt(ink.slice(i, i + 2), 16));
    const scale = img.width / (L.extent * 2);
    const at = (c, r) => [Math.floor((c + 0.5 - L.half + L.extent) * scale), Math.floor((r + 0.5 - L.half + L.extent) * scale)];
    let wrong = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const [x, y] = at(c, r), p = img.px(x, y);
      if (modules[r * size + c] === 1 ? p[3] < 250 : p[3] > 5) wrong++;
    }
    assert.equal(wrong, 0, `${wrong} module centres would scan wrong`);
    for (let i = -2; i < size + 2; i++) for (const [c, r] of [[i, -1], [i, -2], [i, size], [i, size + 1], [-1, i], [-2, i], [size, i], [size + 1, i]]) {
      const [x, y] = at(c, r);
      assert.ok(img.px(x, y)[3] <= 5, `margin ${c},${r} is transparent`);
    }
    // Every pixel is the ink itself (only its coverage varies), and the corners are empty.
    let off = 0;
    for (let y = 0; y < img.width; y += 7) for (let x = 0; x < img.width; x += 7) {
      const p = img.px(x, y);
      if (p[3] > 0 && (p[0] !== rgb[0] || p[1] !== rgb[1] || p[2] !== rgb[2])) off++;
    }
    assert.equal(off, 0, 'no other colour anywhere');
    assert.equal(img.px(0, 0)[3], 0);
  });
}

test('no ink, or black, keeps the classic black-on-white grey+alpha emblem byte for byte', async () => {
  const QR = await loadQr();
  const classic = Buffer.from((await QR.qrPng(LINK, 2)).png);
  for (const ink of [undefined, null, '', 'teal', '#12345']) assert.ok(Buffer.from((await QR.qrPng(LINK, 2, ink)).png).equals(classic), String(ink));
  assert.equal(decodePng(classic).type, 4);
});

// ---- From the saved placement to each shirt's stored QR ----

const SITE = 'https://shop.inrl.co';
const ART = 'https://assets.test/products/19/print/front.png';
const QRSET = { placement: 'front', size_in: 2, top_in: 13, left_in: 9, area_width_in: 12, area_height_in: 16 };

async function setup(qr) {
  const secret = 'whsec_test';
  const h = await makeHarness({ PUBLIC_SITE_URL: SITE, STRIPE_WEBHOOK_SECRET: secret, PRINTFUL_API_KEY: 'pf_test' });
  const admin = seedUser(h, 'admin1', 'admin');
  seedUser(h, 'buyer1', 'client');
  h.exec("insert into targets (id, user_id, name, mind_url, video_url, is_active) values (7, 'admin1', 't', 'https://a/m.mind', 'https://a/v.mp4', 1)");
  h.exec(`insert into products (id, title, slug, price_cents, is_published, ar_target_id, printful_catalog_product_id,
                                printful_variant_map, printful_design_images, printful_qr)
          values (19, 'INRL BETA', 'inrl-beta', 1900, 1, 7, 760, ?, ?, ?)`,
    JSON.stringify({ M: '19397' }), JSON.stringify({ front: ART }), JSON.stringify(qr));
  h.exec(`insert into orders (id, user_id, email, first_name, last_name, address, country, state, zip, total_cents,
                              items_json, status, payment_status)
          values ('ord_1', 'buyer1', 'buyer1@test', 'B', 'One', '1 St', 'US', 'CA', '90001', 1900, ?, 'pending_payment', 'unpaid')`,
    JSON.stringify([{ slug: 'inrl-beta', size: 'M', qty: 1 }]));
  h.onFetch((url, opts) => {
    if (url.includes('printful.com') && url.endsWith('/orders') && opts.method === 'POST') return Response.json({ data: { id: 555 } });
    if (url.includes('printful.com') && url.endsWith('/orders/555/confirm')) return Response.json({ data: { id: 555, status: 'pending' } });
    return new Response('{}', { status: 404 });
  });
  const pay = async () => {
    const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', amount_total: 1900, metadata: { order_id: 'ord_1' } } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    return h.callRaw('POST', '/api/webhooks/stripe', body, { 'Stripe-Signature': `t=${t},v1=${sig}` });
  };
  const storedQr = () => {
    const unit = h.q("select qr_url from garment_units where order_id = 'ord_1'")[0];
    const key = decodeURIComponent(new URL(unit.qr_url).pathname).replace(/^\/+/, '').replace(/^api\/r2\//, '');
    return decodePng(h.ASSETS_BUCKET.objects.get(key).body);
  };
  return { h, admin, pay, storedQr };
}

test('the placement saves the ink (lower-cased), drops anything that is not a #rrggbb colour, and black means none', async () => {
  const { h, admin } = await setup(QRSET);
  try {
    const saved = () => JSON.parse(h.q('select printful_qr from products where id = 19')[0].printful_qr);
    for (const [ink, want] of [['#0E8FA3', '#0e8fa3'], ['red', undefined], ['#000000', undefined], [null, undefined]]) {
      const r = await h.call('POST', '/api/products/19', { token: admin, body: { printful_qr: { ...QRSET, ink } } });
      assert.equal(r.status, 200, r.text);
      assert.equal(saved().ink, want, String(ink));
    }
  } finally { h.restore(); }
});

test("a paid order's shirt QR is printed in the placement's ink with no backing; without ink it stays black on white", async () => {
  for (const [qr, type] of [[{ ...QRSET, ink: '#0e8fa3' }, 6], [QRSET, 4]]) {
    const { h, pay, storedQr } = await setup(qr);
    try {
      assert.equal((await pay()).status, 200);
      const img = storedQr();
      assert.equal(img.type, type);
      if (type === 6) {
        const mid = Math.floor(img.width / 2);
        let seen = 0;
        for (let x = 0; x < img.width; x++) { const p = img.px(x, mid); if (p[3] > 250) { seen++; assert.deepEqual(p.slice(0, 3), [14, 143, 163]); } }
        assert.ok(seen > 50, 'ink across the middle row');
        assert.equal(img.px(0, 0)[3], 0, 'transparent corner');
      }
    } finally { h.restore(); }
  }
});

// The harness hands back the body as text; the IHDR bytes for a 600 px PNG are all ASCII,
// so its colour type survives: 6 is RGBA (ink), 4 is grey+alpha (classic).
const pngType = text => text.charCodeAt(text.indexOf('IHDR') + 4 + 9);

test('the QR placer sample comes in the ink as it will print', async () => {
  const { h, admin } = await setup(QRSET);
  try {
    const r = await h.callRaw('GET', '/api/admin/qr-sample?size_in=2&ink=%230e8fa3', undefined, { Cookie: `session=${admin}` });
    assert.equal(r.status, 200);
    assert.equal(pngType(r.text), 6);
    const plain = await h.callRaw('GET', '/api/admin/qr-sample?size_in=2', undefined, { Cookie: `session=${admin}` });
    assert.equal(pngType(plain.text), 4);
  } finally { h.restore(); }
});
