// A placeholder QR left in the design marks where each shirt's QR goes (ecommerce/js/qr-print.js
// placeholderSlot). Each shirt's emblem takes the placeholder's own size and centre, and
// eraseSpot takes the placeholder out of the print file, so none of it shows round an emblem
// whose outline differs. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import QrPrint from '../ecommerce/js/qr-print.js';
import { loadQr } from './helpers/worker-harness.mjs';

const { placeholderSlot, eraseSpot, EMBLEM_PER_CODE_MAX } = QrPrint;
const ORANGE = [235, 110, 60, 255];

// An RGBA canvas filled with one colour, with put(x, y, rgba) drawing on top.
function canvas(w, h, fill) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) px.set(fill, i);
  return { w, h, px, put: (x, y, rgba) => px.set(rgba, (y * w + x) * 4) };
}

// 8-bit grey+alpha PNG (what qrPng writes) -> { width, grey(x, y), alpha(x, y) }
function decodeGreyAlpha(png) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let o = 8, width = 0;
  const idat = [];
  while (o < png.length) {
    const len = dv.getUint32(o), type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    if (type === 'IHDR') width = dv.getUint32(o + 8);
    if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * 2 + 1;
  return { width, grey: (x, y) => raw[y * stride + 1 + x * 2], alpha: (x, y) => raw[y * stride + 2 + x * 2] };
}

// An emblem placeholder drawn on orange art at (ox, oy), and its code's corners as a reader gives them.
async function emblemOnArt(link, sizeIn, W, H, ox, oy, extra) {
  const QR = await loadQr();
  const L = QR.emblemLayout(link);
  const { png, pixels } = await QR.qrPng(link, sizeIn);
  const em = decodeGreyAlpha(png);
  const art = canvas(W, H, ORANGE);
  if (extra) extra(art);
  for (let y = 0; y < pixels; y++) for (let x = 0; x < pixels; x++) {
    const a = em.alpha(x, y) / 255, g = em.grey(x, y);
    if (a > 0) {
      const i = ((oy + y) * W + ox + x) * 4;
      art.put(ox + x, oy + y, [0, 1, 2].map(k => Math.round(g * a + art.px[i + k] * (1 - a))).concat(255));
    }
  }
  const scale = pixels / (L.extent * 2), at = m => (m - L.half + L.extent) * scale;
  const corners = [[0, 0], [L.size, 0], [L.size, L.size], [0, L.size]].map(([c, r]) => ({ x: ox + at(c), y: oy + at(r) }));
  return { art, em, pixels, corners };
}

for (const link of ['https://shop.inrl.co/p/SAMP-LE00', 'http://localhost:8787/p/FZPUDFYE']) {
  test(`an emblem placeholder: same size and centre, and erased whole (${link.slice(0, 26)})`, async () => {
    const W = 1400, H = 1200, ox = 500, oy = 380;
    const { art, em, pixels, corners } = await emblemOnArt(link, 2, W, H, ox, oy);
    const slot = placeholderSlot(art.px, W, H, corners);
    assert.ok(Math.abs(slot.size - pixels) <= pixels * 0.01, `size ${slot.size}px = the ${pixels}px emblem`);
    assert.ok(Math.abs(slot.left - ox) <= 4 && Math.abs(slot.top - oy) <= 4, `at ${slot.left},${slot.top} = ${ox},${oy}`);
    const before = new Uint8ClampedArray(art.px);
    eraseSpot(art.px, W, H, slot);
    let left = 0, orangeHit = 0;
    for (let y = 0; y < pixels; y++) for (let x = 0; x < pixels; x++) if (em.alpha(x, y) >= 250 && art.px[((oy + y) * W + ox + x) * 4 + 3]) left++;
    for (let i = 0; i < before.length; i += 4) if (before[i] === ORANGE[0] && before[i + 1] === ORANGE[1] && art.px[i + 3] === 0) orangeHit++;
    assert.equal(left, 0, 'no placeholder pixel left');
    assert.equal(orangeHit, 0, 'the design round it is untouched');
  });
}

test('on coloured art the placeholder\'s blended rim goes too, so no ring of it is left', async () => {
  const W = 1400, H = 1200, ox = 500, oy = 380;
  const { art, em, pixels, corners } = await emblemOnArt('https://shop.inrl.co/p/SAMP-LE00', 2, W, H, ox, oy);
  eraseSpot(art.px, W, H, placeholderSlot(art.px, W, H, corners));
  // Any pixel the placeholder touched (even partly) is now erased or back to the orange design.
  let ring = 0;
  for (let y = 0; y < pixels; y++) for (let x = 0; x < pixels; x++) {
    if (em.alpha(x, y) < 30) continue;
    const i = ((oy + y) * W + ox + x) * 4;
    if (!art.px[i + 3]) continue;
    if (Math.abs(art.px[i] - ORANGE[0]) + Math.abs(art.px[i + 1] - ORANGE[1]) + Math.abs(art.px[i + 2] - ORANGE[2]) > 36) ring++;
  }
  assert.equal(ring, 0, 'no blended rim pixel left');
});

test('a white line running into an emblem placeholder does not change its size', async () => {
  const W = 1400, H = 1200, ox = 500, oy = 380;
  const bar = (art) => { for (let y = 520; y < 534; y++) for (let x = 0; x < W; x++) art.put(x, y, [255, 255, 255, 255]); };
  const { art, pixels, corners } = await emblemOnArt('https://shop.inrl.co/p/SAMP-LE00', 2, W, H, ox, oy, bar);
  const slot = placeholderSlot(art.px, W, H, corners);
  assert.ok(Math.abs(slot.size - pixels) <= pixels * 0.012, `size ${slot.size}px = the ${pixels}px emblem`);
  eraseSpot(art.px, W, H, slot);
  let kept = 0;
  for (let x = 0; x < 380; x++) if (art.px[(527 * W + x) * 4 + 3]) kept++;
  for (let x = 1220; x < W; x++) if (art.px[(527 * W + x) * 4 + 3]) kept++;
  assert.equal(kept, 380 + (W - 1220), 'the line away from the placeholder stays');
  // Nothing past the emblem that replaces it is erased: no gap opens in the line at its edge.
  const cx = slot.left + slot.size / 2, cy = slot.top + slot.size / 2;
  let beyond = 0;
  for (let y = 520; y < 534; y++) for (let x = 0; x < W; x++) {
    if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > slot.size / 2 + 3 && !art.px[(y * W + x) * 4 + 3]) beyond++;
  }
  assert.equal(beyond, 0, 'no line pixel erased outside the new emblem');
});

test('a plain QR with a wide quiet zone is still measured as a square', () => {
  const W = 1200, H = 1200, side = 300, quiet = 120, x0 = 450, y0 = 450;
  const art = canvas(W, H, ORANGE);
  for (let y = y0 - quiet; y < y0 + side + quiet; y++) for (let x = x0 - quiet; x < x0 + side + quiet; x++) {
    const inCode = x >= x0 && x < x0 + side && y >= y0 && y < y0 + side;
    art.put(x, y, inCode && ((x >> 4) + (y >> 4)) % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  }
  const corners = [{ x: x0, y: y0 }, { x: x0 + side, y: y0 }, { x: x0 + side, y: y0 + side }, { x: x0, y: y0 + side }];
  const slot = placeholderSlot(art.px, W, H, corners);
  const full = side + 2 * quiet;
  assert.ok(slot.square, 'measured as a square');
  assert.ok(Math.abs(slot.size - full) <= 4, `size ${slot.size}px = the ${full}px square`);
});

test('a plain QR placeholder: as wide as its square with the quiet zone, erased corners and all', () => {
  const W = 900, H = 900, side = 300, quiet = 40, x0 = 300, y0 = 300;
  const art = canvas(W, H, ORANGE);
  for (let y = y0 - quiet; y < y0 + side + quiet; y++) for (let x = x0 - quiet; x < x0 + side + quiet; x++) {
    const inCode = x >= x0 && y >= y0 && x < x0 + side && y < y0 + side;
    art.put(x, y, inCode && ((x >> 4) + (y >> 4)) % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  }
  const corners = [{ x: x0, y: y0 }, { x: x0 + side, y: y0 }, { x: x0 + side, y: y0 + side }, { x: x0, y: y0 + side }];
  const slot = placeholderSlot(art.px, W, H, corners);
  const full = side + 2 * quiet;
  assert.ok(Math.abs(slot.size - full) <= 4, `size ${slot.size}px = the ${full}px square`);
  assert.ok(Math.abs(slot.left - (x0 - quiet)) <= 3 && Math.abs(slot.top - (y0 - quiet)) <= 3);
  eraseSpot(art.px, W, H, slot);
  let left = 0, orange = 0;
  for (let i = 0; i < art.px.length; i += 4) {
    if (art.px[i + 3] && art.px[i] !== ORANGE[0]) left++;
    if (art.px[i + 3] && art.px[i] === ORANGE[0]) orange++;
  }
  assert.equal(left, 0, 'the whole square is gone');
  assert.equal(orange, W * H - full * full, 'the orange round it stays');
});

test('on plain white or black art the size stops at the widest an emblem can be; a tiny code is too small', () => {
  const W = 1000, H = 1000, side = 200;
  const corners = [{ x: 400, y: 400 }, { x: 600, y: 400 }, { x: 600, y: 600 }, { x: 400, y: 600 }];
  for (const fill of [[255, 255, 255, 255], [0, 0, 0, 255]]) {
    const slot = placeholderSlot(canvas(W, H, fill).px, W, H, corners);
    assert.ok(Math.abs(slot.size - side * EMBLEM_PER_CODE_MAX) <= 2, `capped at ${side * EMBLEM_PER_CODE_MAX}px, got ${slot.size}`);
    assert.ok(Math.abs(slot.left + slot.size / 2 - 500) <= 1 && Math.abs(slot.top + slot.size / 2 - 500) <= 1, 'centred on the code');
  }
  const tiny = [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }, { x: 10, y: 40 }];
  assert.deepEqual(placeholderSlot(canvas(100, 100, ORANGE).px, 100, 100, tiny), { error: 'too_small' });
});

test('a placeholder on transparency (the usual print file) ends at its own edge', () => {
  const W = 800, H = 800, side = 240, x0 = 280, y0 = 280;
  const art = canvas(W, H, [0, 0, 0, 0]);
  for (let y = y0 - 30; y < y0 + side + 30; y++) for (let x = x0 - 30; x < x0 + side + 30; x++) art.put(x, y, [255, 255, 255, 255]);
  const corners = [{ x: x0, y: y0 }, { x: x0 + side, y: y0 }, { x: x0 + side, y: y0 + side }, { x: x0, y: y0 + side }];
  const slot = placeholderSlot(art.px, W, H, corners);
  assert.ok(Math.abs(slot.size - (side + 60)) <= 4, `size ${slot.size}px = the ${side + 60}px white square`);
});

test('a placeholder printed in red (not black) on a transparent file is measured and erased whole', async () => {
  const QR = await loadQr();
  const link = 'https://shop.inrl.co/p/SAMP-LE00', L = QR.emblemLayout(link);
  const { png, pixels } = await QR.qrPng(link, 2);
  const em = decodeGreyAlpha(png);
  const W = 1200, H = 1000, ox = 300, oy = 200, RED = [210, 35, 45];
  const art = canvas(W, H, [0, 0, 0, 0]);
  for (let y = 0; y < pixels; y++) for (let x = 0; x < pixels; x++) {
    const a = em.alpha(x, y), t = em.grey(x, y) / 255; // white stays white, black becomes red
    if (a) art.put(ox + x, oy + y, RED.map((c, k) => Math.round(c + (255 - c) * t)).concat(a));
  }
  const scale = pixels / (L.extent * 2), at = m => (m - L.half + L.extent) * scale;
  const corners = [[0, 0], [L.size, 0], [L.size, L.size], [0, L.size]].map(([c, r]) => ({ x: ox + at(c), y: oy + at(r) }));
  const slot = placeholderSlot(art.px, W, H, corners);
  assert.ok(Math.abs(slot.size - pixels) <= pixels * 0.01, `size ${slot.size}px = the ${pixels}px emblem`);
  eraseSpot(art.px, W, H, slot);
  let left = 0;
  for (let y = 0; y < pixels; y++) for (let x = 0; x < pixels; x++) if (em.alpha(x, y) >= 250 && art.px[((oy + y) * W + ox + x) * 4 + 3]) left++;
  assert.equal(left, 0, 'no red placeholder pixel left');
});
