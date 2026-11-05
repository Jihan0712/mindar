// A placeholder QR left in the design marks where each shirt's QR goes (ecommerce/js/qr-print.js
// placeholderSlot). The slot it measures must hold the whole placeholder, so the shirt's emblem
// sized by slotPlacement hides it completely. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import QrPrint from '../ecommerce/js/qr-print.js';
import { loadQr } from './helpers/worker-harness.mjs';

const { placeholderSlot, slotPlacement, fitArtBox, RIM_MIN, PLACEHOLDER_MAX } = QrPrint;
const ORANGE = [235, 110, 60, 255];

// An RGBA canvas filled with one colour, with paint(x, y, put) drawing on top.
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

const inside = (slot, x, y) => Math.hypot(x + 0.5 - (slot.left + slot.size / 2), y + 0.5 - (slot.top + slot.size / 2)) <= slot.size / 2 + 1;

for (const link of ['https://shop.inrl.co/p/SAMP-LE00', 'http://localhost:8787/p/FZPUDFYE']) {
  test(`an emblem placeholder on coloured art: the slot holds all of it (${link.slice(0, 26)})`, async () => {
    const QR = await loadQr();
    const L = QR.emblemLayout(link);
    const { png, pixels } = await QR.qrPng(link, 2);
    const em = decodeGreyAlpha(png);
    const W = 1400, H = 1200, ox = 500, oy = 380;
    const art = canvas(W, H, ORANGE);
    for (let y = 0; y < pixels; y++) for (let x = 0; x < pixels; x++) {
      const a = em.alpha(x, y) / 255, g = em.grey(x, y);
      if (a > 0) art.put(ox + x, oy + y, [0, 1, 2].map(k => Math.round(g * a + ORANGE[k] * (1 - a))).concat(255));
    }
    // The code's corners, as a QR reader reports them.
    const scale = pixels / (L.extent * 2), at = m => (m - L.half + L.extent) * scale;
    const corners = [[0, 0], [L.size, 0], [L.size, L.size], [0, L.size]].map(([c, r]) => ({ x: ox + at(c), y: oy + at(r) }));
    const slot = placeholderSlot(art.px, W, H, corners);
    let missed = 0;
    for (let y = 0; y < pixels; y++) for (let x = 0; x < pixels; x++) if (em.alpha(x, y) > 128 && !inside(slot, ox + x, oy + y)) missed++;
    assert.equal(missed, 0, 'every opaque emblem pixel is inside the slot');
    assert.ok(slot.size <= pixels + 4, `slot ${slot.size}px is not larger than the ${pixels}px emblem`);
    // So the shirt's emblem, sized by slotPlacement, hides it: its narrowest blob reaches past the slot.
    const area = { w: W / 300, h: H / 300 };
    const p = slotPlacement(slot, { w: W, h: H }, fitArtBox(area, { w: W, h: H }), area);
    assert.ok(p.size_in * RIM_MIN * 300 >= slot.size, 'replacement covers the slot');
  });
}

test('a plain QR placeholder with its white quiet zone: the slot holds the whole square', () => {
  const W = 900, H = 900, side = 300, quiet = 40, x0 = 300, y0 = 300;
  const art = canvas(W, H, ORANGE);
  for (let y = y0 - quiet; y < y0 + side + quiet; y++) for (let x = x0 - quiet; x < x0 + side + quiet; x++) {
    const inCode = x >= x0 && y >= y0 && x < x0 + side && y < y0 + side;
    art.put(x, y, inCode && ((x >> 4) + (y >> 4)) % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  }
  const corners = [{ x: x0, y: y0 }, { x: x0 + side, y: y0 }, { x: x0 + side, y: y0 + side }, { x: x0, y: y0 + side }];
  const slot = placeholderSlot(art.px, W, H, corners);
  for (const [x, y] of [[x0 - quiet, y0 - quiet], [x0 + side + quiet - 1, y0 - quiet], [x0 - quiet, y0 + side + quiet - 1], [x0 + side + quiet - 1, y0 + side + quiet - 1]]) {
    assert.ok(inside(slot, x, y), `quiet-zone corner ${x},${y} is inside the slot`);
  }
  assert.ok(slot.size <= Math.ceil((side + 2 * quiet) * Math.SQRT2) + 6, 'and not much more');
});

test('on plain white or black art the scan stops at PLACEHOLDER_MAX; a tiny code is too small', () => {
  const W = 1000, H = 1000, side = 200;
  const corners = [{ x: 400, y: 400 }, { x: 600, y: 400 }, { x: 600, y: 600 }, { x: 400, y: 600 }];
  for (const fill of [[255, 255, 255, 255], [0, 0, 0, 255]]) {
    const slot = placeholderSlot(canvas(W, H, fill).px, W, H, corners);
    assert.ok(Math.abs(slot.size - side * PLACEHOLDER_MAX) <= 4, `capped at ${side * PLACEHOLDER_MAX}px, got ${slot.size}`);
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
  const diag = (side + 60) * Math.SQRT2;
  assert.ok(slot.size >= diag - 2 && slot.size <= diag + 6, `slot ${slot.size}px ~ the white square's diagonal ${diag.toFixed(0)}px`);
});
