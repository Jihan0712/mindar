// Finding the placeholder QR by its look (ecommerce/js/qr-find.js), with a stand-in reader:
// which views are read, how codes found in several views are counted, and the full-resolution
// re-read for exact corners. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import QrFind from '../ecommerce/js/qr-find.js';

const { inkMask, isSquare, findCodes } = QrFind;
const sq = (x, y, s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];

test('inkMask: any opaque colour or dark becomes black; transparency and white stay white', () => {
  const px = new Uint8ClampedArray([
    210, 35, 45, 255,    // red ink
    20, 20, 20, 255,     // black
    255, 255, 255, 255,  // white
    210, 35, 45, 0,      // transparent
    240, 220, 0, 255,    // yellow (light but coloured)
  ]);
  inkMask(px, 'ink');
  assert.deepEqual([px[0], px[4], px[8], px[12], px[16]], [0, 0, 255, 255, 0]);
  const light = new Uint8ClampedArray([255, 255, 255, 255, 20, 20, 20, 255, 255, 255, 255, 0]);
  inkMask(light, 'light');
  assert.deepEqual([light[0], light[4], light[8]], [0, 255, 255]);
});

test('isSquare accepts a code, turned or not, and refuses skewed or tiny reads', () => {
  assert.ok(isSquare(sq(10, 10, 100)));
  const turned = [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }];
  assert.ok(isSquare(turned));
  assert.ok(!isSquare([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 40 }]));
  assert.ok(!isSquare(sq(0, 0, 5)));
  assert.ok(!isSquare(sq(0, 0, 50).slice(0, 3)));
});

// A stand-in file with codes at known file-pixel squares; seenIn(kind) says which views can read
// each. The reader reports corners in the view's own pixels, as a real one does.
function stub(W, H, codes) {
  const calls = [];
  const view = async (kind, rect, scale) => ({ kind, rect, scale });
  const detect = async ({ kind, rect, scale }) => {
    calls.push({ kind, rect, scale });
    return codes.filter(c => c.seenIn(kind, scale) && c.x >= rect.x && c.y >= rect.y && c.x + c.s <= rect.x + rect.w && c.y + c.s <= rect.y + rect.h)
      .map(c => ({ rawValue: c.text, cornerPoints: sq((c.x - rect.x) * scale + (scale < 1 ? 1.5 : 0), (c.y - rect.y) * scale, c.s * scale) }));
  };
  return { calls, view, detect, width: W, height: H };
}

test('a code read in several views counts once, and is re-read at full size for exact corners', async () => {
  const s = stub(3600, 4800, [{ x: 2479, y: 4122, s: 290, text: 'https://x/p/A', seenIn: () => true }]);
  const codes = await findCodes(s);
  assert.equal(codes.length, 1);
  assert.equal(codes[0].text, 'https://x/p/A');
  // The shrunk views' corners are 1.5 view px off; the full-resolution re-read is exact.
  assert.deepEqual(codes[0].corners[0], { x: 2479, y: 4122 });
  assert.ok(s.calls.some(c => c.scale === 1 && c.rect.w < 3600), 'a full-resolution crop was read');
  assert.ok(!s.calls.some(c => c.rect.w === 1600), 'no tiles once the whole file found it');
});

test('a coloured code only the ink mask reads is still found', async () => {
  const s = stub(3600, 4800, [{ x: 1000, y: 1000, s: 300, text: 'red', seenIn: k => k === 'ink' }]);
  const codes = await findCodes(s);
  assert.equal(codes.length, 1);
  assert.equal(codes[0].kind, 'ink');
});

test('a small code only readable at full size is found in the tiles', async () => {
  const s = stub(3600, 4800, [{ x: 3100, y: 4300, s: 150, text: 'small', seenIn: (k, scale) => scale === 1 && k === 'ink' }]);
  const codes = await findCodes(s);
  assert.equal(codes.length, 1);
  assert.deepEqual(codes[0].corners[0], { x: 3100, y: 4300 });
});

test('two different codes are both reported (the placer refuses the file)', async () => {
  const s = stub(3600, 4800, [
    { x: 2479, y: 4122, s: 290, text: 'a', seenIn: () => true },
    { x: 600, y: 600, s: 300, text: 'b', seenIn: k => k === 'grey' },
  ]);
  assert.equal((await findCodes(s)).length, 2);
});

test('nothing to find: every view and tile is tried, and a reader error is not fatal', async () => {
  const s = stub(3600, 4800, []);
  const detect = s.detect;
  let n = 0;
  s.detect = async (v) => { if (++n === 2) throw new Error('decoder hiccup'); return detect(v); };
  assert.deepEqual(await findCodes(s), []);
  assert.ok(s.calls.filter(c => c.rect.w === 1600).length >= 20, 'tiles were read');
});

// ---- By look: the finder eyes alone ----
import { inflateSync } from 'node:zlib';
import { loadQr } from './helpers/worker-harness.mjs';

function greyAlpha(png) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let o = 8, width = 0; const idat = [];
  while (o < png.length) {
    const len = dv.getUint32(o), type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    if (type === 'IHDR') width = dv.getUint32(o + 8);
    if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * 2 + 1;
  return { width, grey: (x, y) => raw[y * stride + 1 + x * 2], alpha: (x, y) => raw[y * stride + 2 + x * 2] };
}
function art(W, H, fill) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < px.length; i += 4) px.set(fill, i);
  return px;
}
const corner = (L, scale, ox, oy) => [[0, 0], [L.size, 0], [L.size, L.size], [0, L.size]]
  .map(([c, r]) => ({ x: ox + (c - L.half + L.extent) * scale, y: oy + (r - L.half + L.extent) * scale }));
const near = (a, b, tol) => a.every((p, k) => Math.hypot(p.x - b[k].x, p.y - b[k].y) <= tol);

for (const [name, ink, bg] of [['black emblem on orange', null, [235, 110, 60, 255]], ['red emblem on transparency', [210, 35, 45], [0, 0, 0, 0]]]) {
  test(`findByLook: a ${name} is found from its eyes, with its code's corners`, async () => {
    const QR = await loadQr();
    const link = 'https://shop.inrl.co/p/SAMP-LE00', L = QR.emblemLayout(link);
    const { png, pixels } = await QR.qrPng(link, 1.2);
    const em = greyAlpha(png), W = 900, H = 800, ox = 260, oy = 200, px = art(W, H, bg);
    for (let y = 0; y < pixels; y++) for (let x = 0; x < pixels; x++) {
      const a = em.alpha(x, y) / 255, t = em.grey(x, y) / 255, i = ((oy + y) * W + ox + x) * 4;
      if (!a) continue;
      const col = ink ? ink.map(c => c + (255 - c) * t) : [255 * t, 255 * t, 255 * t];
      for (let k = 0; k < 3; k++) px[i + k] = Math.round(col[k] * a + px[i + k] * (1 - a) * (px[i + 3] / 255));
      px[i + 3] = Math.max(px[i + 3], Math.round(a * 255));
    }
    const found = QrFind.findByLook(px, W, H);
    assert.equal(found.length, 1);
    const scale = pixels / (L.extent * 2);
    assert.ok(near(found[0].corners, corner(L, scale, ox, oy), scale * 1.2), JSON.stringify(found[0].corners));
  });
}

test('findByLook: a QR that cannot be decoded (data scrambled) is still found by its look', async () => {
  const QR = await loadQr();
  const { size, modules } = QR.qrMatrix('https://shop.inrl.co/p/SAMP-LE00');
  const mod = 8, q = 4, W = 700, H = 700, ox = 120, oy = 90;
  const px = art(W, H, [0, 0, 0, 0]);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const eye = (r, c) => (r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8) || r === 6 || c === 6; // eyes and timing lines kept
  for (let r = -q; r < size + q; r++) for (let c = -q; c < size + q; c++) {
    const inside = r >= 0 && c >= 0 && r < size && c < size;
    let dark = inside && modules[r * size + c] === 1;
    if (inside && !eye(r, c) && rnd() < 0.5) dark = !dark; // half the data flipped: no reader can decode it
    for (let y = 0; y < mod; y++) for (let x = 0; x < mod; x++) px.set(dark ? [0, 0, 0, 255] : [255, 255, 255, 255], ((oy + (r + q) * mod + y) * W + ox + (c + q) * mod + x) * 4);
  }
  const found = QrFind.findByLook(px, W, H);
  assert.equal(found.length, 1);
  const x0 = ox + q * mod, y0 = oy + q * mod, s = size * mod;
  assert.ok(near(found[0].corners, [{ x: x0, y: y0 }, { x: x0 + s, y: y0 }, { x: x0 + s, y: y0 + s }, { x: x0, y: y0 + s }], mod * 1.2), JSON.stringify(found[0].corners));
});

test('findByLook finds nothing in art with no QR (stripes, dots, blobs)', () => {
  const W = 800, H = 800, px = art(W, H, [0, 0, 0, 0]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ridge = Math.sin(Math.hypot(x - 300, y - 400) / 6) > 0.2 && Math.hypot(x - 300, y - 400) < 280; // fingerprint-like rings
    const dots = (x % 23 < 6) && (y % 19 < 6) && x > 560;
    if (ridge || dots) px.set([235, 110, 60, 255], (y * W + x) * 4);
  }
  assert.deepEqual(QrFind.findByLook(px, W, H), []);
});
