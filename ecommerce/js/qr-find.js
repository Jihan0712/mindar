/* Finding the placeholder QR in a print file, by its QR look (finder eyes and modules), in any
   colour. The file is read several ways, cheapest first, and every code found is mapped back to
   the file's own pixels:
     1. the whole file (at most MAX_VIEW px) on mid grey, on white, as an "ink" mask (anything
        opaque and coloured or dark -> black, the rest white: any colour QR becomes black on
        white) and as a "light" mask (opaque white -> black: a white QR on transparency);
     2. only if nothing was found and the file is larger than that: overlapping full-resolution
        tiles, ink mask first, then grey (a small QR on a big file);
     3. each code found on a shrunk view is read again on a full-resolution crop round it, for
        exact corners (they set the emblem's size).
   A read only counts with text and four corners making a square (the design is flat, so a real
   code is never skewed). The same code read in several views counts once.
   findCodes is pure orchestration (view and detect are passed in) so it can be tested; canvasViews
   makes the views from a canvas in the browser. */
(function (root) {
  'use strict';

  var MAX_VIEW = 2000;   // longest side of a whole-file view, px
  var TILE = 1600, STEP = 800;
  var KINDS = ['grey', 'white', 'ink', 'light'];

  // inkMask(rgba, mode), in place: 'ink' makes opaque dark or coloured pixels black and the rest
  // white; 'light' makes opaque near-white pixels black and the rest white.
  function inkMask(rgba, mode) {
    for (var i = 0; i < rgba.length; i += 4) {
      var r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
      var lum = 0.299 * r + 0.587 * g + 0.114 * b, chroma = Math.max(r, g, b) - Math.min(r, g, b);
      var on = mode === 'light' ? a >= 128 && lum >= 200 && chroma < 40 : a >= 128 && (lum < 170 || chroma > 80);
      var v = on ? 0 : 255;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255;
    }
    return rgba;
  }

  function centre(pts) {
    return { x: (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4, y: (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4 };
  }
  function sideOf(pts) {
    var s = 0;
    for (var k = 0; k < 4; k++) s += Math.hypot(pts[(k + 1) % 4].x - pts[k].x, pts[(k + 1) % 4].y - pts[k].y) / 4;
    return s;
  }
  // Four corners making a square: sides within 20% of each other, diagonals within 15%.
  function isSquare(pts) {
    if (!pts || pts.length !== 4) return false;
    var sides = [], k;
    for (k = 0; k < 4; k++) sides.push(Math.hypot(pts[(k + 1) % 4].x - pts[k].x, pts[(k + 1) % 4].y - pts[k].y));
    var d1 = Math.hypot(pts[2].x - pts[0].x, pts[2].y - pts[0].y), d2 = Math.hypot(pts[3].x - pts[1].x, pts[3].y - pts[1].y);
    return Math.min.apply(null, sides) / Math.max.apply(null, sides) >= 0.8 && Math.min(d1, d2) / Math.max(d1, d2) >= 0.85 && sides[0] >= 8;
  }

  // findCodes({ width, height, view, detect, maxView }) -> [{ corners, text, kind }] in file px.
  // view(kind, rect, scale) -> image of that part of the file ({ x, y, w, h } px) at that scale;
  // detect(image) -> [{ cornerPoints, rawValue }] (a BarcodeDetector's detect).
  async function findCodes(o) {
    var W = o.width, H = o.height, maxView = o.maxView || MAX_VIEW, found = [];
    async function read(kind, rect, scale) {
      var hits = [];
      try { hits = (await o.detect(await o.view(kind, rect, scale))) || []; } catch (e) { hits = []; }
      return hits.map(function (h) {
        var pts = (h.cornerPoints || []).map(function (p) { return { x: rect.x + p.x / scale, y: rect.y + p.y / scale }; });
        return { corners: pts, text: String(h.rawValue || ''), kind: kind, scale: scale };
      }).filter(function (c) { return c.text && isSquare(c.corners); });
    }
    function add(list) {
      list.forEach(function (c) {
        var m = centre(c.corners), s = sideOf(c.corners);
        var same = found.find(function (f) {
          var fm = centre(f.corners);
          return Math.hypot(fm.x - m.x, fm.y - m.y) < Math.max(s, sideOf(f.corners)) / 2;
        });
        if (!same) found.push(c);
        else if (c.scale > same.scale) found[found.indexOf(same)] = c; // keep the sharper read
      });
    }
    var whole = { x: 0, y: 0, w: W, h: H }, s0 = Math.min(1, maxView / Math.max(W, H));
    for (var k = 0; k < KINDS.length; k++) add(await read(KINDS[k], whole, s0));
    if (!found.length && s0 < 1) {
      var tiles = [], tw = Math.min(TILE, W), th = Math.min(TILE, H);
      var xs = [], ys = [], x, y;
      for (x = 0; x + tw < W; x += STEP) xs.push(x);
      xs.push(W - tw);
      for (y = 0; y + th < H; y += STEP) ys.push(y);
      ys.push(H - th);
      ys.forEach(function (ty) { xs.forEach(function (tx) { tiles.push({ x: tx, y: ty, w: tw, h: th }); }); });
      var tileKinds = ['ink', 'grey'];
      for (var t = 0; t < tileKinds.length && !found.length; t++) {
        for (var i = 0; i < tiles.length; i++) add(await read(tileKinds[t], tiles[i], 1));
      }
    }
    // Exact corners: read each code again at full resolution on a crop round it.
    for (var f = 0; f < found.length; f++) {
      var c = found[f];
      if (c.scale >= 1) continue;
      var m = centre(c.corners), half = sideOf(c.corners) * 1.4;
      var rx = Math.max(0, Math.floor(m.x - half)), ry = Math.max(0, Math.floor(m.y - half));
      var rect = { x: rx, y: ry, w: Math.min(W, Math.ceil(m.x + half)) - rx, h: Math.min(H, Math.ceil(m.y + half)) - ry };
      var scale = Math.min(1, maxView / Math.max(rect.w, rect.h));
      if (scale <= c.scale) continue;
      var again = (await read(c.kind, rect, scale)).sort(function (a, b) {
        var ma = centre(a.corners), mb = centre(b.corners);
        return Math.hypot(ma.x - m.x, ma.y - m.y) - Math.hypot(mb.x - m.x, mb.y - m.y);
      })[0];
      if (again && Math.hypot(centre(again.corners).x - m.x, centre(again.corners).y - m.y) < sideOf(c.corners) / 4) found[f] = again;
    }
    return found.map(function (c) { return { corners: c.corners, text: c.text, kind: c.kind }; });
  }

  // ---- By look alone: the three finder eyes, for a placeholder that looks like a QR but can't
  // be decoded (restyled, recoloured, partly covered). Each eye crosses as dark-light-dark-
  // light-dark in 1:1:3:1:1 both across and down; three eyes of one module size, two equally
  // far from the third at a right angle, are a code, and give its corners.

  // The 1:1:3:1:1 test on five run lengths, with half a module of slack (rounded eyes, blur).
  function eyeRatio(c) {
    var total = c[0] + c[1] + c[2] + c[3] + c[4];
    if (total < 7) return 0;
    var m = total / 7, tol = m * 0.6;
    return Math.abs(c[0] - m) < tol && Math.abs(c[1] - m) < tol && Math.abs(c[2] - 3 * m) < 3 * tol &&
      Math.abs(c[3] - m) < tol && Math.abs(c[4] - m) < tol ? m : 0;
  }

  // Down the column x from row y (inside the eye's dark core): the eye's vertical centre and
  // module size, or null when the column doesn't cross it 1:1:3:1:1 too.
  function crossDown(mask, w, h, x, y, maxRun) {
    var c = [0, 0, 0, 0, 0], k = y;
    while (k >= 0 && mask[k * w + x]) { c[2]++; k--; }
    while (k >= 0 && !mask[k * w + x] && c[1] <= maxRun) { c[1]++; k--; }
    while (k >= 0 && mask[k * w + x] && c[0] <= maxRun) { c[0]++; k--; }
    k = y + 1;
    while (k < h && mask[k * w + x]) { c[2]++; k++; }
    while (k < h && !mask[k * w + x] && c[3] <= maxRun) { c[3]++; k++; }
    while (k < h && mask[k * w + x] && c[4] <= maxRun) { c[4]++; k++; }
    var m = eyeRatio(c);
    return m ? { y: k - c[4] - c[3] - c[2] / 2, m: m } : null;
  }

  function findEyes(mask, w, h) {
    var eyes = [];
    function seen(x, y, m) {
      for (var i = 0; i < eyes.length; i++) {
        var e = eyes[i];
        if (Math.abs(e.x - x) <= e.m * 2 && Math.abs(e.y - y) <= e.m * 2 && Math.abs(e.m - m) <= Math.max(e.m, m) * 0.4) {
          e.x = (e.x * e.n + x) / (e.n + 1); e.y = (e.y * e.n + y) / (e.n + 1); e.m = (e.m * e.n + m) / (e.n + 1); e.n++;
          return;
        }
      }
      eyes.push({ x: x, y: y, m: m, n: 1 });
    }
    for (var y = 0; y < h; y += 2) {
      var c = [0, 0, 0, 0, 0], state = 0, row = y * w;
      for (var x = 0; x <= w; x++) {
        var on = x < w && mask[row + x];
        if (on) {
          if (state & 1) state++;
          c[state]++;
        } else if (!(state & 1)) {
          if (state === 0 && !c[0]) continue;
          if (state === 4) {
            var m = eyeRatio(c);
            if (m) {
              var cx = Math.round(x - c[4] - c[3] - c[2] / 2);
              var v = crossDown(mask, w, h, cx, y, Math.ceil(m * 5));
              if (v && Math.abs(v.m - m) <= m * 0.4) seen(x - c[4] - c[3] - c[2] / 2, v.y, (m + v.m) / 2);
            }
            c = [c[2], c[3], c[4], 1, 0]; state = 3;
          } else { state++; c[state]++; }
        } else c[state]++;
      }
    }
    return eyes.filter(function (e) { return e.n >= 2; });
  }

  // findByLook(rgba, width, height) -> [{ corners, text: '', kind: 'look' }] in file px: codes
  // found from their eyes alone, on the ink mask and then (for a white QR) the light mask.
  function findByLook(rgba, width, height) {
    var kinds = ['ink', 'light'];
    for (var k = 0; k < kinds.length; k++) {
      var mask = new Uint8Array(width * height);
      for (var i = 0, p = 0; p < mask.length; i += 4, p++) {
        var r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
        var lum = 0.299 * r + 0.587 * g + 0.114 * b, chroma = Math.max(r, g, b) - Math.min(r, g, b);
        mask[p] = kinds[k] === 'light' ? (a >= 128 && lum >= 200 && chroma < 40 ? 1 : 0) : (a >= 128 && (lum < 170 || chroma > 80) ? 1 : 0);
      }
      var codes = codesFromEyes(findEyes(mask, width, height), mask, width, height);
      if (codes.length) return codes.map(function (c) { return { corners: c, text: '', kind: 'look' }; });
    }
    return [];
  }

  // Three eyes of one size at the corners of a right isosceles triangle, with a code-like mix
  // of dark and light between them: [TL, TR, BR, BL] corners of each code. Each eye is used once.
  function codesFromEyes(eyes, mask, w, h) {
    eyes = eyes.sort(function (a, b) { return b.n - a.n; }).slice(0, 40);
    var out = [], tried = [];
    for (var a = 0; a < eyes.length; a++) for (var b = 0; b < eyes.length; b++) for (var c = b + 1; c < eyes.length; c++) {
      if (a === b || a === c) continue;
      var A = eyes[a], B = eyes[b], C = eyes[c];
      var ms = [A.m, B.m, C.m], m = (A.m + B.m + C.m) / 3;
      if (Math.max.apply(null, ms) / Math.min.apply(null, ms) > 1.4) continue;
      var dAB = Math.hypot(B.x - A.x, B.y - A.y), dAC = Math.hypot(C.x - A.x, C.y - A.y), dBC = Math.hypot(C.x - B.x, C.y - B.y);
      if (Math.abs(dAB - dAC) > 0.12 * Math.max(dAB, dAC) || Math.abs(dBC - Math.SQRT2 * (dAB + dAC) / 2) > 0.1 * dBC) continue;
      var span = (dAB + dAC) / 2 / m; // modules between eye centres: 14 (version 1) to 170
      if (span < 12 || span > 175) continue;
      tried.push({ A: A, B: B, C: C, m: m, err: Math.abs(dAB - dAC) / dAB + Math.abs(dBC / ((dAB + dAC) / 2) - Math.SQRT2) });
    }
    tried.sort(function (x, y) { return x.err - y.err; });
    var used = [];
    tried.forEach(function (t) {
      if (used.indexOf(t.A) !== -1 || used.indexOf(t.B) !== -1 || used.indexOf(t.C) !== -1) return;
      var A = t.A, B = t.B, C = t.C;
      var ux = B.x - A.x, uy = B.y - A.y, vx = C.x - A.x, vy = C.y - A.y;
      if (ux * vy - uy * vx < 0) { var T = B; B = C; C = T; ux = B.x - A.x; uy = B.y - A.y; vx = C.x - A.x; vy = C.y - A.y; }
      var lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      // Modules across: a QR is 21, 25, 29 … 177 wide, eye centres 7 apart less than that.
      var N = Math.round(((lu + lv) / 2 / t.m + 7 - 17) / 4) * 4 + 17;
      if (N < 21 || N > 177) return;
      var mu = lu / (N - 7), mv = lv / (N - 7), Ux = ux / lu, Uy = uy / lu, Vx = vx / lv, Vy = vy / lv;
      var o = { x: A.x - 3.5 * mu * Ux - 3.5 * mv * Vx, y: A.y - 3.5 * mu * Uy - 3.5 * mv * Vy };
      // The module in row r, column c: dark (1), light (0), or off the file (-1).
      var at = function (r, c) {
        var x = Math.round(o.x + (c + 0.5) * mu * Ux + (r + 0.5) * mv * Vx), y = Math.round(o.y + (c + 0.5) * mu * Uy + (r + 0.5) * mv * Vy);
        return x < 0 || y < 0 || x >= w || y >= h ? -1 : mask[y * w + x];
      };
      // A QR's own marks, which fingerprint ridges don't make: each eye's full 7 x 7 pattern
      // (dark ring, light ring, dark 3 x 3 core) and the two timing lines between the eyes,
      // dark and light in turn along row 6 and column 6.
      var good = 0, all = 0;
      [[0, 0], [0, N - 7], [N - 7, 0]].forEach(function (e0) {
        for (var r = 0; r < 7; r++) for (var c = 0; c < 7; c++) {
          var ring = Math.max(Math.abs(r - 3), Math.abs(c - 3)), want = ring === 2 ? 0 : 1;
          all++; if (at(e0[0] + r, e0[1] + c) === want) good++;
        }
      });
      if (good / all < 0.85) return;
      good = 0; all = 0;
      for (var k = 8; k <= N - 9; k++) {
        all += 2;
        if (at(6, k) === (k % 2 ? 0 : 1)) good++;
        if (at(k, 6) === (k % 2 ? 0 : 1)) good++;
      }
      if (good / all < 0.8) return;
      var corners = [
        o,
        { x: o.x + N * mu * Ux, y: o.y + N * mu * Uy },
        { x: o.x + N * mu * Ux + N * mv * Vx, y: o.y + N * mu * Uy + N * mv * Vy },
        { x: o.x + N * mv * Vx, y: o.y + N * mv * Vy },
      ];
      used.push(t.A, t.B, t.C);
      out.push(corners);
    });
    return out;
  }

  // Browser views of a canvas: canvasViews(cv)(kind, rect, scale) -> a canvas.
  function canvasViews(cv) {
    return function (kind, rect, scale) {
      var out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(rect.w * scale)); out.height = Math.max(1, Math.round(rect.h * scale));
      var ctx = out.getContext('2d', { willReadFrequently: kind === 'ink' || kind === 'light' });
      if (kind === 'grey' || kind === 'white') {
        ctx.fillStyle = kind === 'grey' ? '#808080' : '#ffffff';
        ctx.fillRect(0, 0, out.width, out.height);
      }
      ctx.drawImage(cv, rect.x, rect.y, rect.w, rect.h, 0, 0, out.width, out.height);
      if (kind === 'ink' || kind === 'light') {
        var img = ctx.getImageData(0, 0, out.width, out.height);
        inkMask(img.data, kind);
        ctx.putImageData(img, 0, 0);
      }
      return out;
    };
  }

  var api = { MAX_VIEW: MAX_VIEW, inkMask: inkMask, isSquare: isSquare, findCodes: findCodes, findByLook: findByLook, canvasViews: canvasViews };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QrFind = api;
})(this);
