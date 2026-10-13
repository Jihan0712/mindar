// Swapping/cropping a target's tracked image (admin "Edit marker") must update the target
// in place: same target id, so a printed shirt's /p/<code> link picks up the new marker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, seedUser } from './helpers/worker-harness.mjs';

async function setup() {
  const h = await makeHarness({ PUBLIC_SITE_URL: 'https://shop.inrl.co' });
  seedUser(h, 'owner1', 'client');
  seedUser(h, 'admin1', 'admin');
  h.exec(`insert into targets (id, user_id, name, mind_url, video_url, image_url, is_active)
          values (7, 'admin1', 'BETA', 'https://a/m.mind', 'https://a/default.mp4', 'https://a/marker.jpg', 1)`);
  h.exec("insert into products (id, title, slug, price_cents, is_published, ar_target_id) values (19, 'INRL BETA', 'inrl-beta', 2300, 1, 7)");
  h.exec("insert into garment_units (id, claim_code, product_id, owner_user_id) values ('u1', 'FQP5-KZ5W', 19, 'owner1')");
  return h;
}

test('admin replaces the marker; the shirt link serves the new marker with a bumped version', async () => {
  const h = await setup();
  try {
    const targetVersion = () => h.q('select version from targets where id = 7')[0].version;
    const before = targetVersion();
    const r = await h.call('POST', '/api/targets/7/marker', {
      token: 'sess_admin1', body: { mind_url: 'https://a/crop.mind', image_url: 'https://a/crop.png' },
    });
    assert.equal(r.status, 200, r.text);
    const after = (await h.call('GET', '/api/viewer/piece?code=FQP5-KZ5W')).json;
    assert.equal(after.mindurl, 'https://a/crop.mind');
    assert.equal(after.imageurl, 'https://a/crop.png');
    assert.equal(after.videourl, 'https://a/default.mp4');
    assert.equal(targetVersion(), before + 1);
  } finally { h.restore(); }
});

test('marker replace needs a privileged session and both urls', async () => {
  const h = await setup();
  try {
    const body = { mind_url: 'https://a/x.mind', image_url: 'https://a/x.png' };
    assert.equal((await h.call('POST', '/api/targets/7/marker', { body })).status, 401);
    assert.equal((await h.call('POST', '/api/targets/7/marker', { token: 'sess_owner1', body })).status, 403);
    assert.equal((await h.call('POST', '/api/targets/7/marker', { token: 'sess_admin1', body: { mind_url: 'https://a/x.mind' } })).status, 400);
    assert.equal((await h.call('POST', '/api/targets/99/marker', { token: 'sess_admin1', body })).status, 404);
    assert.equal((await h.call('GET', '/api/viewer/piece?code=FQP5-KZ5W')).json.mindurl, 'https://a/m.mind');
  } finally { h.restore(); }
});
