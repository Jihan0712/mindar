// The product editor's tracked-area box: TargetLocate finds a target's tracked image (a crop
// of the print file, at another resolution) inside the print file. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TL = require('../ecommerce/js/target-locate.js');

// Deterministic blobby "artwork": smoothed noise, so it has structure at every scale.
function artwork(w, h, seed) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const g = new Float32Array(w * h);
  for (let i = 0; i < 60; i++) {
    const cx = rnd() * w, cy = rnd() * h, r = (0.04 + rnd() * 0.18) * w, v = rnd() * 255;
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, cy + r); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, cx + r); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) g[y * w + x] = (g[y * w + x] + v) / 2;
  }
  for (let i = 0; i < g.length; i++) g[i] = Math.min(255, g[i] + (rnd() - 0.5) * 30);
  return g;
}

function crop(g, w, x, y, cw, ch) {
  const out = new Float32Array(cw * ch);
  for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) out[yy * cw + xx] = g[(y + yy) * w + x + xx];
  return out;
}

test('finds a rescaled crop of the print file', () => {
  const W = 600, H = 870;
  const print = artwork(W, H, 7);
  const box = { x: 40, y: 70, w: 520, h: 650 };
  const c = crop(print, W, box.x, box.y, box.w, box.h);
  // The tracked image is stored at a different resolution from the print.
  const tw = 300, th = Math.round(300 * box.h / box.w);
  const tracked = TL.resize(c, box.w, box.h, tw, th);
  const r = TL.locate({ gray: print, w: W, h: H }, { gray: tracked, w: tw, h: th });
  assert.ok(r && r.found, 'found, score ' + (r && r.score));
  assert.ok(Math.abs(r.x - box.x / W) < 0.02, 'x ' + r.x);
  assert.ok(Math.abs(r.y - box.y / H) < 0.02, 'y ' + r.y);
  assert.ok(Math.abs(r.w - box.w / W) < 0.03, 'w ' + r.w);
  assert.ok(Math.abs(r.h - box.h / H) < 0.03, 'h ' + r.h);
});

test('a small crop off-centre is found too', () => {
  const W = 500, H = 700;
  const print = artwork(W, H, 11);
  const box = { x: 260, y: 380, w: 180, h: 240 };
  const tracked = crop(print, W, box.x, box.y, box.w, box.h);
  const r = TL.locate({ gray: print, w: W, h: H }, { gray: tracked, w: box.w, h: box.h });
  assert.ok(r && r.found, 'found, score ' + (r && r.score));
  assert.ok(Math.abs(r.x - box.x / W) < 0.02 && Math.abs(r.y - box.y / H) < 0.02, JSON.stringify(r));
});

test('the whole print file as the target is the whole print', () => {
  const W = 400, H = 400;
  const print = artwork(W, H, 3);
  const r = TL.locate({ gray: print, w: W, h: H }, { gray: print, w: W, h: H });
  assert.ok(r.found);
  assert.ok(r.x < 0.02 && r.y < 0.02 && r.w > 0.97 && r.h > 0.97, JSON.stringify(r));
});

test('an unrelated image is not reported as found', () => {
  const print = artwork(500, 700, 5);
  const other = artwork(300, 300, 99);
  const r = TL.locate({ gray: print, w: 500, h: 700 }, { gray: other, w: 300, h: 300 });
  assert.ok(!r || !r.found, 'score ' + (r && r.score));
});

test('toGray reads brightness and treats transparency as black', () => {
  const g = TL.toGray(new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 0, 30, 60, 90, 255]), 3, 1);
  assert.deepEqual(Array.from(g), [255, 0, 60]);
});
