// Placement maths shared by the dashboard's QR placer, proof and test sheet
// (ecommerce/js/qr-print.js). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import QrPrint from '../ecommerce/js/qr-print.js';

const { findSlot, fitArtBox, slotPlacement, printFileName, testSheetLayout } = QrPrint;

// An RGBA image filled with dark art, with optional magenta shapes painted in.
function image(w, h, paint = () => false) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const m = paint(x, y);
    px[i] = m ? 255 : 30; px[i + 1] = m ? 0 : 30; px[i + 2] = m ? 255 : 40; px[i + 3] = 255;
  }
  return px;
}
const disc = (cx, cy, r) => (x, y) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;

test('findSlot: a disc gives its bounding square; nothing, ovals and two blobs are errors', () => {
  const W = 400, H = 500;
  assert.deepEqual(findSlot(image(W, H, disc(300, 400, 40)), W, H), { left: 260, top: 360, size: 80 });
  assert.deepEqual(findSlot(image(W, H), W, H), { error: 'none' });
  const oval = (x, y) => ((x + 0.5 - 200) / 60) ** 2 + ((y + 0.5 - 250) / 40) ** 2 <= 1;
  assert.deepEqual(findSlot(image(W, H, oval), W, H), { error: 'not_round' });
  const two = (x, y) => disc(100, 100, 30)(x, y) || disc(300, 100, 30)(x, y);
  assert.deepEqual(findSlot(image(W, H, two), W, H), { error: 'not_round' });
  const square = (x, y) => x >= 100 && x < 180 && y >= 100 && y < 180;
  assert.deepEqual(findSlot(image(W, H, square), W, H), { error: 'not_round' });
});

test('findSlot ignores pinks and reds in the art that are not the marker', () => {
  const W = 200, H = 200;
  const px = image(W, H, disc(100, 100, 30));
  for (let i = 0; i < 40 * 4; i += 4) { px[i] = 255; px[i + 1] = 105; px[i + 2] = 180; } // hot pink row
  assert.deepEqual(findSlot(px, W, H), { left: 70, top: 70, size: 60 });
});

test('fitArtBox fills an exact-size file and centres a narrower one', () => {
  assert.deepEqual(fitArtBox({ w: 12, h: 16 }, { w: 3600, h: 4800 }), { left_in: 0, top_in: 0, width_in: 12, height_in: 16 });
  assert.deepEqual(fitArtBox({ w: 12, h: 16 }, { w: 849, h: 1199 }), { left_in: 0.3353, top_in: 0, width_in: 11.3294, height_in: 16 });
});

test('slotPlacement: the emblem takes the spot\'s own size and centre', () => {
  const area = { w: 12, h: 16 }, art = { w: 3600, h: 4800 }, box = fitArtBox(area, art);
  // A 2.0 in spot at 9.2, 13.0 in: a 2.0 in emblem exactly there.
  assert.deepEqual(slotPlacement({ left: 2760, top: 3900, size: 600 }, art, box, area), { size_in: 2, top_in: 13, left_in: 9.2 });
  assert.deepEqual(slotPlacement({ left: 2700, top: 3800, size: 750 }, art, box, area), { size_in: 2.5, top_in: 12.667, left_in: 9 });
  // Touching the right/bottom edges: clamped so the emblem stays inside.
  const e = slotPlacement({ left: 3100, top: 4300, size: 600 }, art, box, area);
  assert.ok(Math.abs(e.left_in + e.size_in - 12) < 0.002 && Math.abs(e.top_in + e.size_in - 16) < 0.002);
  // Under 2 in: a measuring hair under is rounded up round the same centre, more is too small.
  const near = slotPlacement({ left: 1000, top: 1000, size: 590 }, art, box, area);
  assert.equal(near.size_in, 2);
  assert.ok(Math.abs(near.left_in + 1 - (1000 + 295) / 300) < 0.002);
  // Down to MIN_SPOT_IN (what the earlier rule accepted) a spot is grown to 2 in, not refused.
  const small = slotPlacement({ left: 1000, top: 1000, size: 510 }, art, box, area);
  assert.equal(small.size_in, 2);
  assert.equal(small.grown, true);
  assert.ok(Math.abs(small.left_in + 1 - (1000 + 255) / 300) < 0.002, 'grown round the same centre');
  assert.equal(slotPlacement({ left: 2760, top: 3900, size: 600 }, art, box, area).grown, undefined);
  assert.equal(slotPlacement({ left: 0, top: 0, size: 450 }, art, box, area).error, 'too_small');
  // On a letterboxed file the art box offset is added.
  const art2 = { w: 849, h: 1199 }, box2 = fitArtBox(area, art2);
  const ppi = 849 / box2.width_in;
  const q = slotPlacement({ left: 400, top: 700, size: 180 }, art2, box2, area);
  assert.ok(Math.abs(q.size_in - 180 / ppi) < 0.001);
  assert.ok(Math.abs(q.left_in + q.size_in / 2 - (box2.left_in + (400 + 90) / ppi)) < 0.001);
});

test('eraseSpot clears a #FF00FF disc and its blended rim, and nothing else', () => {
  const W = 300, H = 300;
  const px = image(W, H, disc(150, 150, 60));
  // A blended rim pixel (half magenta over transparency) and art just outside the disc.
  const rim = (150 * W + 211) * 4; px[rim] = 255; px[rim + 1] = 0; px[rim + 2] = 255; px[rim + 3] = 120;
  const slot = findSlot(px, W, H);
  QrPrint.eraseSpot(px, W, H, slot);
  let left = 0, art = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] && px[i] - px[i + 1] >= 90) left++;
    if (px[i + 3] === 255 && px[i] === 30) art++;
  }
  assert.equal(left, 0, 'no magenta left');
  assert.equal(px[rim + 3], 0, 'blended rim erased');
  assert.ok(art >= W * H - Math.PI * 61 * 61 && art <= W * H - Math.PI * 59 * 59, 'only the disc went');
});

test('printFileName says order, line, shirt, size, code and placement, and is file-system safe', () => {
  assert.equal(printFileName({ order: 'ord_8f2c', line: 1, shirt: 2, size: 'M', code: 'K7QX-9MPZ', placement: 'front' }),
    'ord_8f2c-L1-S2-M-K7QX_9MPZ-front.png');
  assert.equal(printFileName({ order: 'ord/1', line: 1, shirt: 1, size: '', code: 'A B', placement: 'back' }), 'ord_1-L1-S1-NA-A_B-back.png');
});

test('testSheetLayout puts the QR at true size and rulers of exactly 1 in and 25 mm on a Letter page', () => {
  const t = testSheetLayout({ qrSizeIn: 2.56, label: 'ord_1-L1-S1' }); // any emblem width
  assert.deepEqual([t.width, t.height], [2550, 3300]);
  assert.equal(t.qr.size, 768);
  assert.deepEqual(t.rulers.map(r => [r.label, r.length]), [['1 in', 300], ['25 mm', 295]]);
  assert.equal(t.corners.length, 4);
  assert.ok(t.qr.x > 0 && t.qr.x + t.qr.size < t.width);
  assert.match(t.note.text, /100%/);
  assert.equal(t.label.text, 'ord_1-L1-S1');
});
