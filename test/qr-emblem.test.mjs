// The printed QR emblem must scan: a phone samples each module's centre, the finder eyes and
// the light margin. These checks decode the PNG and compare every module centre with the
// QR matrix, so a style change that breaks scanning fails here. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { loadQr } from './helpers/worker-harness.mjs';

// 8-bit grey+alpha PNG (what qrPng writes) -> { width, grey(x, y), alpha(x, y) }
function decodeGreyAlpha(png) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let o = 8, width = 0, height = 0;
  const idat = [];
  while (o < png.length) {
    const len = dv.getUint32(o), type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    if (type === 'IHDR') {
      width = dv.getUint32(o + 8); height = dv.getUint32(o + 12);
      assert.equal(png[o + 16], 8); assert.equal(png[o + 17], 4, 'grey+alpha');
    }
    if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 2 + 1;
  for (let y = 0; y < height; y++) assert.equal(raw[y * stride], 0, 'filter type 0');
  return { width, grey: (x, y) => raw[y * stride + 1 + x * 2], alpha: (x, y) => raw[y * stride + 2 + x * 2] };
}

const TEXTS = [
  'https://shop.inrl.co/p/K7QX-9MPZ',
  'https://shop.inrl.co/p/SAMP-LE00',
  'https://example.com/p/' + 'A'.repeat(90), // a larger version with more alignment eyes
];

for (const text of TEXTS) {
  test(`every module centre reads correctly: ${text.slice(0, 40)}`, async () => {
    const QR = await loadQr();
    const { size, modules } = QR.qrMatrix(text);
    const L = QR.emblemLayout(text);
    const { png, pixels } = await QR.qrPng(text, 2.5);
    assert.equal(pixels, 750);
    const img = decodeGreyAlpha(png);
    const scale = img.width / (L.extent * 2);
    const at = (c, r) => [Math.floor((c + 0.5 - L.half + L.extent) * scale), Math.floor((r + 0.5 - L.half + L.extent) * scale)];
    let wrong = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const [x, y] = at(c, r);
      const g = img.grey(x, y), a = img.alpha(x, y);
      assert.ok(a > 250, `module ${c},${r} sits on the white backing`);
      if (modules[r * size + c] === 1 ? g > 40 : g < 215) wrong++;
    }
    assert.equal(wrong, 0, `${wrong} module centres would scan wrong`);
    // The 2-module light margin around the code stays white.
    for (let i = -2; i < size + 2; i++) for (const [c, r] of [[i, -1], [i, -2], [i, size], [i, size + 1], [-1, i], [-2, i], [size, i], [size + 1, i]]) {
      const [x, y] = at(c, r);
      assert.ok(img.grey(x, y) > 215 && img.alpha(x, y) > 250, `margin ${c},${r} is light`);
    }
  });
}

test('neighbouring dark squares join with no light seam or notch anywhere along their edges', async () => {
  const QR = await loadQr();
  for (const text of TEXTS) {
    const L = QR.emblemLayout(text);
    const { size, dark } = L;
    const img = decodeGreyAlpha((await QR.qrPng(text, 2.5)).png);
    const scale = img.width / (L.extent * 2);
    const g = (u, v) => img.grey(Math.floor((u - L.half + L.extent) * scale), Math.floor((v - L.half + L.extent) * scale));
    let edges = 0, worst = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (!dark[r * size + c]) continue;
      // Along the shared edge with the right and lower neighbour (a pixel clear of the outer
      // boundary, where a pixel straddles the edge), and through a 2x2 block's centre.
      if (c + 1 < size && dark[r * size + c + 1]) { edges++; for (let t = 0.15; t < 0.86; t += 0.05) worst = Math.max(worst, g(c + 1, r + t)); }
      if (r + 1 < size && dark[(r + 1) * size + c]) { edges++; for (let t = 0.15; t < 0.86; t += 0.05) worst = Math.max(worst, g(c + t, r + 1)); }
      if (c + 1 < size && r + 1 < size && dark[r * size + c + 1] && dark[(r + 1) * size + c] && dark[(r + 1) * size + c + 1]) worst = Math.max(worst, g(c + 1, r + 1));
    }
    assert.ok(edges > 100);
    assert.ok(worst <= 10, `lightest pixel on a shared edge is grey ${worst} (${text.slice(0, 30)})`);
  }
});

test('the white backing is a fingerprint blob that always covers a centred circle of 85% of the width', async () => {
  const QR = await loadQr();
  for (const text of [...TEXTS, 'https://shop.inrl.co/p/ZZZZ-0001', 'https://shop.inrl.co/p/AB12-CD34']) {
    assert.ok(QR.emblemLayout(text).rimMin >= 0.85, 'narrowest rim at least 85% of the width');
    const img = decodeGreyAlpha((await QR.qrPng(text, 2.5)).png);
    const c = img.width / 2, r = 0.85 * c - 2;
    let widestOpaque = 0;
    for (let deg = 0; deg < 360; deg += 3) {
      const th = deg * Math.PI / 180;
      const x = Math.floor(c + r * Math.cos(th)), y = Math.floor(c + r * Math.sin(th));
      assert.ok(img.alpha(x, y) > 245, `opaque backing at 85% radius, ${deg} deg (${text.slice(-9)})`);
      // How far out the backing reaches along this ray.
      let k = c; while (k > 1 && img.alpha(Math.min(img.width - 1, Math.floor(c + k * Math.cos(th))), Math.min(img.width - 1, Math.floor(c + k * Math.sin(th)))) < 128) k--;
      widestOpaque = Math.max(widestOpaque, k);
    }
    assert.ok(widestOpaque > c - 3, 'the blob touches the image edge at its widest point');
    for (const [x, y] of [[1, 1], [img.width - 2, 1], [1, img.width - 2], [img.width - 2, img.width - 2]]) {
      assert.ok(img.alpha(x, y) < 10, `corner ${x},${y} is transparent`);
    }
  }
});
