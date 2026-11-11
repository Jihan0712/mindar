// Asset files (assets.inrl.co/<key>) answer HEAD like GET minus the body, so link checkers and
// link previews see that a marker, video or image exists. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness } from './helpers/worker-harness.mjs';

test('HEAD on an asset gives its headers and no body; a missing one is 404', async () => {
  const h = await makeHarness({ ALLOWED_ORIGINS: 'https://shop.inrl.co' });
  try {
    await h.ASSETS_BUCKET.put('videos/a.mp4', new Uint8Array([1, 2, 3, 4]), { httpMetadata: { contentType: 'video/mp4' } });
    const head = await h.handle(new Request('https://assets.test/videos/a.mp4', { method: 'HEAD', headers: { Origin: 'https://shop.inrl.co' } }));
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-type'), 'video/mp4');
    assert.equal(head.headers.get('access-control-allow-origin'), 'https://shop.inrl.co');
    assert.equal(head.body, null);

    const get = await h.handle(new Request('https://assets.test/videos/a.mp4'));
    assert.equal(get.status, 200);
    assert.equal((await get.arrayBuffer()).byteLength, 4);

    const missing = await h.handle(new Request('https://assets.test/videos/none.mp4', { method: 'HEAD' }));
    assert.equal(missing.status, 404);
  } finally { h.restore(); }
});
