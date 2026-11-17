// A draft's product page can be checked before it is published: the product API returns an
// unpublished product to an admin (or to a brand user for their own brand's piece), never
// cached, and still answers Not found to shoppers. The dashboard's list (drafts included) is
// never cached either. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, seedUser } from './helpers/worker-harness.mjs';

async function setup() {
  const h = await makeHarness({ PUBLIC_SITE_URL: 'https://shop.inrl.co' });
  const admin = seedUser(h, 'admin1', 'admin');
  const buyer = seedUser(h, 'buyer1', 'client');
  const brandA = seedUser(h, 'branda', 'brand');
  const brandB = seedUser(h, 'brandb', 'brand');
  h.exec("insert into brands (id, name) values (1, 'Alpha'), (2, 'Beta')");
  h.exec("insert into brand_users (user_id, brand_id) values ('branda', 1), ('brandb', 2)");
  h.exec(`insert into products (id, title, slug, price_cents, is_published, brand_id)
          values (27, 'Fingerprints Tee', 'fingerprints-tee', 2300, 0, 1),
                 (22, 'INRL BETA', 'inrl-beta', 2300, 1, null)`);
  return { h, admin, buyer, brandA, brandB };
}

test('a draft is Not found for shoppers and signed-in buyers', async () => {
  const { h, buyer } = await setup();
  try {
    assert.equal((await h.call('GET', '/api/products/fingerprints-tee')).status, 404);
    assert.equal((await h.call('GET', '/api/products/fingerprints-tee', { token: buyer })).status, 404);
    assert.equal((await h.call('GET', '/api/products/27')).status, 404);
  } finally { h.restore(); }
});

test('an admin can open a draft on its product page, uncached, marked unpublished', async () => {
  const { h, admin } = await setup();
  try {
    const r = await h.call('GET', '/api/products/fingerprints-tee', { token: admin });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.product.title, 'Fingerprints Tee');
    assert.equal(r.json.product.is_published, false);
    assert.match(r.headers.get('cache-control'), /no-store/);
    assert.doesNotMatch(r.headers.get('cache-control'), /public/);
  } finally { h.restore(); }
});

test("a brand user sees their own brand's draft, not another brand's", async () => {
  const { h, brandA, brandB } = await setup();
  try {
    assert.equal((await h.call('GET', '/api/products/fingerprints-tee', { token: brandA })).status, 200);
    assert.equal((await h.call('GET', '/api/products/fingerprints-tee', { token: brandB })).status, 404);
  } finally { h.restore(); }
});

test('published products stay publicly cacheable; the admin list with drafts is never cached', async () => {
  const { h, admin } = await setup();
  try {
    const pub = await h.call('GET', '/api/products/inrl-beta');
    assert.equal(pub.status, 200);
    assert.match(pub.headers.get('cache-control'), /public/);
    const list = await h.call('GET', '/api/products?includeUnpublished=1', { token: admin });
    assert.equal(list.status, 200);
    assert.ok(list.json.items.some(p => p.slug === 'fingerprints-tee'));
    assert.match(list.headers.get('cache-control'), /no-store/);
    const shop = await h.call('GET', '/api/products');
    assert.ok(!shop.json.items.some(p => p.slug === 'fingerprints-tee'));
    assert.match(shop.headers.get('cache-control'), /public/);
  } finally { h.restore(); }
});
