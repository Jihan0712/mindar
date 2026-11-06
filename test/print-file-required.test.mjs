// Checkout only sells a product that has real print files (products.printful_design_images).
// The storefront photo is never printed in their place: it is usually a Printful mockup of the
// whole shirt, which would print a picture of a shirt onto the shirt. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, seedUser } from './helpers/worker-harness.mjs';

const MOCKUP = 'https://files.cdn.printful.com/files/adc/adcb79e3e4eef475aa2794f9891ae988_preview.png';
const CUSTOMER = { firstName: 'B', lastName: 'One', email: 'buyer1@example.com', address: '1 St', city: 'LA', country: 'US', state: 'CA', zip: '90001' };

async function checkout(designImages) {
  const h = await makeHarness({ PRINTFUL_API_KEY: 'pf_test' });
  const token = seedUser(h, 'buyer1', 'client');
  h.exec(`insert into products (id, title, slug, price_cents, is_published, image_url, printful_catalog_product_id,
                                printful_variant_map, printful_design_images)
          values (24, 'Coffee Shirt', 'coffee-shirt', 2500, 1, ?, 12, ?, ?)`,
    MOCKUP, JSON.stringify({ M: '4012' }), designImages ? JSON.stringify(designImages) : null);
  // Past the print-file check the next step is the shipping quote; a refused quote ends it there.
  h.onFetch(() => new Response('{}', { status: 500 }));
  try {
    return await h.call('POST', '/api/checkout/session', { token, body: { customer: CUSTOMER, cart: [{ slug: 'coffee-shirt', size: 'M', qty: 1 }] } });
  } finally { h.restore(); }
}

test('a product with only a storefront photo (no print file) is not for sale', async () => {
  const res = await checkout(null);
  assert.equal(res.status, 400);
  assert.match(res.json.error, /Not available for purchase yet: coffee-shirt/);
});

test('the same product with a print file passes the check', async () => {
  const res = await checkout({ front: 'https://assets.test/products/24/art-front.png' });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /calculate shipping/, 'stopped at the shipping quote, after the print-file check');
});

test('saving a front print file (Edit Design/Price) makes the product sellable', async () => {
  const h = await makeHarness({ PRINTFUL_API_KEY: 'pf_test' });
  const admin = seedUser(h, 'admin1', 'admin');
  const buyer = seedUser(h, 'buyer1', 'client');
  h.exec(`insert into products (id, title, slug, price_cents, is_published, image_url, printful_catalog_product_id, printful_variant_map)
          values (24, 'Coffee Shirt', 'coffee-shirt', 2500, 1, ?, 12, ?)`, MOCKUP, JSON.stringify({ M: '4012' }));
  h.onFetch(() => new Response('{}', { status: 500 }));
  try {
    const FRONT = 'https://assets.test/products/24/print/front.png';
    const up = await h.call('POST', '/api/products/24', { token: admin, body: { printful_design_images: { front: FRONT } } });
    assert.equal(up.status, 200);
    const row = h.q('select image_url, printful_design_images from products where id = 24')[0];
    assert.deepEqual(JSON.parse(row.printful_design_images), { front: FRONT });
    assert.equal(row.image_url, MOCKUP, 'the listing photo is left alone');
    const res = await h.call('POST', '/api/checkout/session', { token: buyer, body: { customer: CUSTOMER, cart: [{ slug: 'coffee-shirt', size: 'M', qty: 1 }] } });
    assert.match(res.json.error, /calculate shipping/, 'past the print-file check');
  } finally { h.restore(); }
});
