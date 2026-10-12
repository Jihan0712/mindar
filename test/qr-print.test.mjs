// Placement maths shared by the dashboard's QR placer, proof and test sheet
// (ecommerce/js/qr-print.js). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import QrPrint from '../ecommerce/js/qr-print.js';

const { findSlot, fitArtBox, slotPlacement, printFileName, testSheetLayout, BLEED_IN } = QrPrint;

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

test('slotPlacement: slot plus a 0.03 in bleed each side, clamped to the area; too small is an error', () => {
  const area = { w: 12, h: 16 }, art = { w: 3600, h: 4800 }, box = fitArtBox(area, art);
  // A 2.5 in slot at 9.2 / 13.1 in.
  assert.deepEqual(slotPlacement({ left: 2760, top: 3930, size: 750 }, art, box, area), { size_in: 2.56, top_in: 13.07, left_in: 9.17 });
  assert.equal(BLEED_IN, 0.03);
  // Touching the right edge: clamped so the emblem stays inside.
  assert.deepEqual(slotPlacement({ left: 2850, top: 0, size: 750 }, art, box, area), { size_in: 2.56, top_in: 0, left_in: 9.44 });
  assert.equal(slotPlacement({ left: 0, top: 0, size: 300 }, art, box, area).error, 'too_small');
  // On a letterboxed file the art box offset is added.
  const art2 = { w: 849, h: 1199 }, box2 = fitArtBox(area, art2);
  const p = slotPlacement({ left: 650, top: 1090, size: 180 }, art2, box2, area);
  assert.ok(Math.abs(p.left_in - (box2.left_in + 650 * box2.width_in / 849 - 0.03)) < 0.001);
});

test('printFileName says order, line, shirt, size, code and placement, and is file-system safe', () => {
  assert.equal(printFileName({ order: 'ord_8f2c', line: 1, shirt: 2, size: 'M', code: 'K7QX-9MPZ', placement: 'front' }),
    'ord_8f2c-L1-S2-M-K7QX_9MPZ-front.png');
  assert.equal(printFileName({ order: 'ord/1', line: 1, shirt: 1, size: '', code: 'A B', placement: 'back' }), 'ord_1-L1-S1-NA-A_B-back.png');
});

test('testSheetLayout puts the QR at true size and rulers of exactly 1 in and 25 mm on a Letter page', () => {
  const t = testSheetLayout({ qrSizeIn: 2.56, label: 'ord_1-L1-S1' });
  assert.deepEqual([t.width, t.height], [2550, 3300]);
  assert.equal(t.qr.size, 768);
  assert.deepEqual(t.rulers.map(r => [r.label, r.length]), [['1 in', 300], ['25 mm', 295]]);
  assert.equal(t.corners.length, 4);
  assert.ok(t.qr.x > 0 && t.qr.x + t.qr.size < t.width);
  assert.match(t.note.text, /100%/);
  assert.equal(t.label.text, 'ord_1-L1-S1');
});
