// "Import from Printful Sync Products" copies each placement's print file into R2 as the
// product's print file (products.printful_design_images). A file Printful sends without a
// source link is looked up by id once more, and art_report says what happened to each
// placement, so a missing print file is visible instead of the import quietly "working".
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, seedUser } from './helpers/worker-harness.mjs';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PRINT = 'https://files.cdn.printful.com/files/aaa/print-front.png';

function syncProduct(files) {
  return {
    result: {
      sync_product: { id: 480673356, name: 'INRL BETA', thumbnail_url: 'https://files.cdn.printful.com/thumb.png' },
      sync_variants: ['S', 'M'].map((size, i) => ({
        id: 5000 + i, size, color: 'Black', retail_price: '25.00',
        product: { product_id: 760, variant_id: 19396 + i },
        files,
      })),
    },
  };
}

async function importWith(files, { fileById } = {}) {
  const h = await makeHarness({ PRINTFUL_API_KEY: 'pf_test' });
  const token = seedUser(h, 'admin1', 'admin');
  h.exec("insert into products (id, title, slug, price_cents, is_published) values (22, 'INRL BETA', 'inrl-beta', 2500, 1)");
  h.onFetch((url) => {
    if (url === 'https://api.printful.com/store/products/480673356') return Response.json(syncProduct(files));
    if (url.startsWith('https://api.printful.com/files/')) {
      return fileById ? Response.json({ result: fileById }) : Response.json({ error: { message: 'Not found' } }, { status: 404 });
    }
    if (url === PRINT) return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    return new Response('{}', { status: 404 });
  });
  try {
    const res = await h.call('POST', '/api/admin/printful/products/22/link-sync', { token, body: { sync_product_id: 480673356 } });
    const row = h.q('select printful_design_images, image_url from products where id = 22')[0];
    return { res, row };
  } finally { h.restore(); }
}

const MOCKUP = { id: 2, type: 'preview', url: null, preview_url: 'https://files.cdn.printful.com/files/bbb/mockup_preview.png' };

test('a print file with a link is copied and reported', async () => {
  const { res, row } = await importWith([{ id: 1, type: 'default', url: PRINT, width: 3600, height: 4800 }, MOCKUP]);
  assert.equal(res.status, 200);
  assert.equal(res.json.art_report.front.result, 'copied');
  assert.ok(JSON.parse(row.printful_design_images).front, 'front print file stored');
});

test('a print file without a link is found by its id', async () => {
  const { res, row } = await importWith([{ id: 1, type: 'default', url: null }, MOCKUP], { fileById: { id: 1, url: PRINT } });
  assert.equal(res.json.art_report.front.lookup, 'found by id');
  assert.equal(res.json.art_report.front.result, 'copied');
  assert.ok(JSON.parse(row.printful_design_images).front);
});

test('no link anywhere: nothing stored, and the report says why', async () => {
  const { res, row } = await importWith([{ id: 1, type: 'default', url: null }, MOCKUP]);
  assert.equal(res.status, 200);
  assert.equal(res.json.art_report.front.result, 'no download link from Printful');
  assert.equal(res.json.art_report.front.had_url, false);
  assert.equal(row.printful_design_images, null, 'no print file stored');
  assert.deepEqual(res.json.file_types.sort(), ['default', 'preview']);
});

test('only mockups: the report is empty and the file types say so', async () => {
  const { res } = await importWith([MOCKUP]);
  assert.deepEqual(res.json.art_report, {});
  assert.deepEqual(res.json.file_types, ['preview']);
});
