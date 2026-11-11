/* Placement maths for the per-shirt QR: where the slot is in a print file, where the QR goes,
   how the art sits in the print area, what a shirt's print file is called and how its paper
   test sheet is laid out. Pure functions (no DOM) so the dashboard and the tests share them.
   Units: px are print-file pixels, in are inches inside the placement's print area. */
(function (root) {
  'use strict';

  var DPI = 300;
  // Smallest emblem: 1 in, scanned fine on paper at 1.08 in (2026-11-06; was 2 in). Paper
  // prints sharper than fabric, so print a test shirt before selling a design this small.
  var MIN_QR_IN = 1;
  // Smallest QR spot accepted: a spot measured a hair under MIN_QR_IN (measuring error) is
  // grown to it.
  var MIN_SPOT_IN = 0.95;
  // Each shirt's emblem is exactly the size of the spot the design marks (a placeholder QR or
  // a #FF00FF disc). The marker itself is erased from the print file when it is saved
  // (eraseSpot), so nothing of it shows round an emblem whose outline differs.

  // A slot marker pixel: the solid #FF00FF disc the designer leaves where the QR goes. A
  // little tolerance covers PNG export colour shifts; JPEG is refused upstream.
  function isMarker(r, g, b, a) { return a > 200 && r >= 230 && b >= 230 && g <= 40; }

  // findSlot(rgba, width, height) -> { left, top, size } in px, or { error }.
  // Errors: 'none' (no marker), 'not_round' (oval, two blobs or a ragged shape).
  function findSlot(rgba, width, height) {
    var minX = width, minY = height, maxX = -1, maxY = -1, count = 0;
    for (var y = 0; y < height; y++) {
      var row = y * width * 4;
      for (var x = 0; x < width; x++) {
        var i = row + x * 4;
        if (!isMarker(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3])) continue;
        count++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (!count) return { error: 'none' };
    var w = maxX - minX + 1, h = maxY - minY + 1;
    // A disc is as wide as it is tall and fills pi/4 of its bounding square.
    var squareness = Math.abs(w - h) / Math.max(w, h);
    var fill = count / (Math.PI / 4 * w * h);
    if (squareness > 0.03 || fill < 0.9 || fill > 1.1) return { error: 'not_round' };
    return { left: minX, top: minY, size: Math.max(w, h) };
  }

  // A placeholder QR left in the design marks the spot too. Its footprint (code, quiet zone,
  // and for an emblem its white backing and rings) is measured outward from the code; an
  // emblem's backing is at most 2.12x its code's side (measured over 3000 links), a plain QR
  // with a 4-module quiet zone at most 1.95x, so the scan never goes past PLACEHOLDER_MAX.
  var PLACEHOLDER_MAX = 2.2;
  // An emblem is 2.076 to 2.123 times as wide as its code (2000 shirt links): a placeholder
  // emblem's measured width is kept in this range, so design touching it can't stretch it.
  var EMBLEM_PER_CODE_MIN = 2.07, EMBLEM_PER_CODE_MAX = 2.13;
  var RAYS = 120;
  // Smoothed corner-to-side reach above which a placeholder is a square, not an emblem.
  var SQUARE_CORNER_RATIO = 1.2;
  // How far (fraction of the code's side) one ray may run past its neighbours' median and
  // still be erased to: small, as a longer ray is mostly design touching the placeholder.
  var SPIKE_TOLERANCE = 0.015;
  // Blended rim: pixels inside a placeholder's edge, or this close outside it (px), that are a
  // blend of it and the design round it, rather than the design itself, are erased with it.
  var RIM_PX = 2.5, RIM_SAMPLE_PX = 5, RIM_MATCH = 36;

  // Black, white or the grey of their blended edges: the placeholder. Colour and transparency
  // are the design around it.
  function isPlaceholderPixel(r, g, b, a) { return a >= 200 && Math.max(r, g, b) - Math.min(r, g, b) <= 40; }

  // A placeholder printed in one colour instead of black (a red QR, say): its ink colour, the
  // average of the coloured dark pixels in the middle of its code, or null when the code is
  // black. Pixels near that colour then count as placeholder too (nearInk).
  var INK_MATCH = 90;
  function inkColour(rgba, width, height, cx, cy, side) {
    var step = Math.max(1, Math.round(side / 80)), half = side * 0.4, dark = 0, n = 0, sum = [0, 0, 0];
    for (var y = Math.round(cy - half); y <= cy + half; y += step) {
      for (var x = Math.round(cx - half); x <= cx + half; x += step) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        var i = (y * width + x) * 4, r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
        if (rgba[i + 3] < 200 || Math.min(r, g, b) > 200) continue; // light: the code's white
        dark++;
        if (Math.max(r, g, b) - Math.min(r, g, b) <= 40) continue;
        n++; sum[0] += r; sum[1] += g; sum[2] += b;
      }
    }
    return dark && n / dark > 0.6 ? sum.map(function (v) { return v / n; }) : null;
  }
  // The ink, or a blend of it with the white backing (its anti-aliased edges).
  function nearInk(ink, r, g, b) {
    if (!ink) return false;
    var span = (255 - ink[0]) + (255 - ink[1]) + (255 - ink[2]);
    var t = span > 0 ? Math.min(1, Math.max(0, ((r - ink[0]) + (g - ink[1]) + (b - ink[2])) / span)) : 0;
    return Math.abs(r - ink[0] - t * (255 - ink[0])) + Math.abs(g - ink[1] - t * (255 - ink[1])) + Math.abs(b - ink[2] - t * (255 - ink[2])) <= INK_MATCH * (1 - t * 0.6);
  }

  // placeholderSlot(rgba, width, height, corners) -> { left, top, size, cx, cy, rays | square } in px:
  // the placeholder's own size and centre, or { error: 'too_small' } for a code under 40 px.
  // corners: the code's four corner points as a QR reader reports them. Each of RAYS rays
  // walks out from inside the code to the placeholder's edge; a median over neighbouring rays
  // drops the spikes where design of the same black or white touches it (a line running into
  // it). For eraseSpot: an emblem's rays[n], its edge at angle n * 2pi / RAYS; a plain QR's
  // square, its axis (ux, uy) and reach either side of the centre (a0, a1 along it, b0, b1
  // across).
  // An emblem (white all round its code) is as wide as its outline's furthest point; a plain
  // QR is as wide as its square with its quiet zone.
  function placeholderSlot(rgba, width, height, corners) {
    var cx = 0, cy = 0, side = 0;
    for (var k = 0; k < 4; k++) {
      var p = corners[k], q = corners[(k + 1) % 4];
      cx += p.x / 4; cy += p.y / 4;
      side += Math.hypot(q.x - p.x, q.y - p.y) / 4;
    }
    if (!(side >= 40)) return { error: 'too_small' };
    var ink = inkColour(rgba, width, height, cx, cy, side);
    var start = side * 0.45, cap = side * PLACEHOLDER_MAX / 2, gap = Math.max(3, Math.round(side / 60));
    var raw = [];
    for (var n = 0; n < RAYS; n++) {
      var dx = Math.cos(n * 2 * Math.PI / RAYS), dy = Math.sin(n * 2 * Math.PI / RAYS);
      var last = start, run = 0;
      for (var r = start; r <= cap; r++) {
        var x = Math.round(cx + dx * r), y = Math.round(cy + dy * r);
        var i = (y * width + x) * 4;
        var inside = x >= 0 && y >= 0 && x < width && y < height && (isPlaceholderPixel(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]) ||
          (rgba[i + 3] >= 200 && nearInk(ink, rgba[i], rgba[i + 1], rgba[i + 2])));
        if (inside) { last = r; run = 0; } else if (++run >= gap) break;
      }
      raw.push(last + 0.5);
    }
    var smooth = raw.map(function (_, n) {
      var w = [];
      for (var j = -4; j <= 4; j++) w.push(raw[(n + j + RAYS) % RAYS]);
      return w.sort(function (a, b) { return a - b; })[4];
    });
    var at = function (a) { // smoothed edge distance at angle a
      var t = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI) * RAYS;
      var n0 = Math.floor(t) % RAYS, f = t - Math.floor(t);
      return smooth[n0] * (1 - f) + smooth[(n0 + 1) % RAYS] * f;
    };
    var u = Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x);
    // An emblem is white all round its code and roughly round; a square reaches about 1.3x
    // further at its corners than at its sides (after smoothing), however wide its quiet zone.
    var axes = 0, diags = 0;
    for (var q = 0; q < 4; q++) { axes += at(u + q * Math.PI / 2); diags += at(u + Math.PI / 4 + q * Math.PI / 2); }
    var minR = Math.min.apply(null, smooth), maxR = Math.max.apply(null, smooth);
    if (minR >= side * 0.8 && diags / axes < SQUARE_CORNER_RATIO) {
      var size = Math.min(Math.max(2 * maxR, side * EMBLEM_PER_CODE_MIN), side * EMBLEM_PER_CODE_MAX);
      // The edge to erase to: each ray as measured, unless it runs past its neighbours (design
      // of the same black or white touching it), and never past the emblem that replaces it,
      // so no design beyond the new emblem's edge is erased.
      var rays = raw.map(function (d, n) { return Math.min(d, smooth[n] + side * SPIKE_TOLERANCE, size / 2); });
      return { left: Math.round(cx - size / 2), top: Math.round(cy - size / 2), size: Math.round(size), cx: cx, cy: cy, rays: rays, ink: ink };
    }
    // A plain QR: a square turned like its code, reaching its quiet zone's edge on each side,
    // and never inside the code itself. A code exported as dark modules only (light ones
    // transparent) has gaps wider than the edge search allows, so on its own the search can
    // stop a module or two in and leave the code's outer ring behind when it is erased.
    var half = side / 2, edgeAt = function (a) { return Math.max(at(a), half); };
    var sq = { ux: Math.cos(u), uy: Math.sin(u), a0: edgeAt(u + Math.PI), a1: edgeAt(u), b0: edgeAt(u - Math.PI / 2), b1: edgeAt(u + Math.PI / 2) };
    var sz = Math.max(sq.a0 + sq.a1, sq.b0 + sq.b1);
    var du = (sq.a1 - sq.a0) / 2, dv = (sq.b1 - sq.b0) / 2;
    var mx = cx + sq.ux * du - sq.uy * dv, my = cy + sq.uy * du + sq.ux * dv;
    return { left: Math.round(mx - sz / 2), top: Math.round(my - sz / 2), size: Math.round(sz), cx: cx, cy: cy, square: sq, ink: ink };
  }

  // eraseSpot(rgba, width, height, slot): clears the spot's marker to transparent, in place:
  // a placeholder QR's black, white and grey inside its measured edge (plus 2 px), with its
  // blended rim, or a disc's magenta with its blended rim. Design in other colours stays.
  // The rim of a placeholder on coloured design is a blend of grey and that colour, and its
  // jagged outline runs either side of the measured edge, so any other colour inside the edge
  // (plus RIM_PX) is told apart from the design by comparing it with the design just outside
  // (RIM_SAMPLE_PX past the edge the same way): one that doesn't match it is erased.
  function eraseSpot(rgba, width, height, slot) {
    var matchesOutside = function (i, sx, sy) {
      sx = Math.round(sx); sy = Math.round(sy);
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) return false;
      var j = (sy * width + sx) * 4;
      if (rgba[j + 3] < 200) return false;
      return Math.abs(rgba[i] - rgba[j]) + Math.abs(rgba[i + 1] - rgba[j + 1]) + Math.abs(rgba[i + 2] - rgba[j + 2]) <= RIM_MATCH;
    };
    var cx = slot.cx, cy = slot.cy, reach, sq = slot.square;
    if (slot.rays) reach = Math.max.apply(null, slot.rays) + 3;
    else if (sq) reach = Math.hypot(Math.max(sq.a0, sq.a1), Math.max(sq.b0, sq.b1)) + 3;
    else { cx = slot.left + slot.size / 2; cy = slot.top + slot.size / 2; reach = slot.size / 2 + 3; }
    var x0 = Math.max(0, Math.floor(cx - reach)), x1 = Math.min(width - 1, Math.ceil(cx + reach));
    var y0 = Math.max(0, Math.floor(cy - reach)), y1 = Math.min(height - 1, Math.ceil(cy + reach));
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var i = (y * width + x) * 4;
        if (!rgba[i + 3]) continue;
        var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        var r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], hit;
        var grey = Math.max(r, g, b) - Math.min(r, g, b) <= 40 || nearInk(slot.ink, r, g, b);
        if (slot.rays) {
          var t = (Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI) * RAYS;
          var n0 = Math.floor(t) % RAYS, n1 = (n0 + 1) % RAYS;
          var d = Math.hypot(dx, dy), edge = Math.max(slot.rays[n0], slot.rays[n1]);
          hit = grey ? d <= edge + 2
            : d <= edge + RIM_PX && !matchesOutside(i, cx + dx / d * (edge + RIM_SAMPLE_PX), cy + dy / d * (edge + RIM_SAMPLE_PX));
        } else if (sq) {
          var pu = dx * sq.ux + dy * sq.uy, pv = -dx * sq.uy + dy * sq.ux;
          // How far outside the square (negative inside), and the side it is nearest.
          var sides = [[-sq.a0 - pu, -1, 0], [pu - sq.a1, 1, 0], [-sq.b0 - pv, 0, -1], [pv - sq.b1, 0, 1]];
          var out = sides[0];
          for (var s = 1; s < 4; s++) if (sides[s][0] > out[0]) out = sides[s];
          if (grey) hit = out[0] <= 2;
          else if (out[0] <= RIM_PX) {
            var step = RIM_SAMPLE_PX - out[0], nu = out[1] * step, nv = out[2] * step;
            hit = !matchesOutside(i, x + 0.5 + nu * sq.ux - nv * sq.uy, y + 0.5 + nu * sq.uy + nv * sq.ux);
          } else hit = false;
        } else {
          hit = Math.hypot(dx, dy) <= reach && r - g >= 90 && b - g >= 90;
        }
        if (hit) rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
      }
    }
  }

  // fitArtBox(area, art) -> the art drawn whole and centred in the print area, in inches.
  // area: { w, h } inches; art: { w, h } px.
  function fitArtBox(area, art) {
    var s = Math.min(area.w / art.w, area.h / art.h);
    var w = art.w * s, h = art.h * s;
    var r = function (n) { return Math.round(n * 10000) / 10000; };
    return { left_in: r((area.w - w) / 2), top_in: r((area.h - h) / 2), width_in: r(w), height_in: r(h) };
  }

  // slotPlacement(slot, art, box, area) -> { size_in, top_in, left_in } or { error }.
  // The emblem takes the spot's own size and centre, clamped to the print area. A spot under
  // MIN_QR_IN is grown to it round the same centre (grown: true; the emblem then covers a
  // little of the design round the spot), down to MIN_SPOT_IN; a smaller one is refused.
  function slotPlacement(slot, art, box, area) {
    var inPerPx = box.width_in / art.w;
    var slotIn = slot.size * inPerPx;
    if (slotIn < MIN_SPOT_IN) return { error: 'too_small', size_in: slotIn };
    var size = Math.max(slotIn, MIN_QR_IN);
    var round = function (n) { return Math.round(n * 1000) / 1000; };
    var left = box.left_in + slot.left * inPerPx + slotIn / 2 - size / 2;
    var top = box.top_in + slot.top * inPerPx + slotIn / 2 - size / 2;
    left = Math.min(Math.max(0, left), area.w - size);
    top = Math.min(Math.max(0, top), area.h - size);
    var out = { size_in: round(size), top_in: round(top), left_in: round(left) };
    if (size > slotIn + 0.005) out.grown = true;
    return out;
  }

  // printFileName({ order, line, shirt, size, code, placement })
  // -> "<order>-L<line>-S<shirt>-<size>-<code>-<placement>.png", file-system safe.
  function printFileName(p) {
    var clean = function (v) { return String(v == null || v === '' ? 'NA' : v).replace(/[^A-Za-z0-9_]+/g, '_'); };
    return clean(p.order) + '-L' + clean(p.line) + '-S' + clean(p.shirt) + '-' + clean(p.size) + '-' +
      clean(p.code) + '-' + clean(p.placement) + '.png';
  }

  // testSheetLayout({ qrSizeIn, label }) -> drawing plan for a US Letter page at 300 DPI:
  // the shirt's QR at true size, a 1 in and a 25 mm ruler, corner marks 0.25 in outside the
  // QR's square, and a label. Measure the rulers after printing at 100% / Actual size.
  function testSheetLayout(p) {
    var W = 8.5 * DPI, H = 11 * DPI;
    var qrPx = Math.round(p.qrSizeIn * DPI);
    var qrX = Math.round((W - qrPx) / 2), qrY = Math.round(1.5 * DPI);
    var m = Math.round(0.25 * DPI), arm = Math.round(0.2 * DPI);
    var corners = [[qrX - m, qrY - m, 1, 1], [qrX + qrPx + m, qrY - m, -1, 1], [qrX - m, qrY + qrPx + m, 1, -1], [qrX + qrPx + m, qrY + qrPx + m, -1, -1]];
    var rulerY = qrY + qrPx + Math.round(1 * DPI);
    return {
      width: W, height: H,
      qr: { x: qrX, y: qrY, size: qrPx },
      corners: corners.map(function (c) { return { x: c[0], y: c[1], dx: c[2] * arm, dy: c[3] * arm }; }),
      rulers: [
        { label: '1 in', x: Math.round(W / 2 - DPI / 2), y: rulerY, length: DPI },
        { label: '25 mm', x: Math.round(W / 2 - (25 / 25.4) * DPI / 2), y: rulerY + Math.round(0.6 * DPI), length: Math.round((25 / 25.4) * DPI) },
      ],
      label: { x: Math.round(W / 2), y: Math.round(0.8 * DPI), text: p.label || '' },
      note: { x: Math.round(W / 2), y: rulerY + Math.round(1.4 * DPI), text: 'Print at 100% / Actual size, not Fit to page. Both rulers must measure exactly.' },
    };
  }

  var api = { DPI: DPI, MIN_QR_IN: MIN_QR_IN, MIN_SPOT_IN: MIN_SPOT_IN, PLACEHOLDER_MAX: PLACEHOLDER_MAX, EMBLEM_PER_CODE_MIN: EMBLEM_PER_CODE_MIN, EMBLEM_PER_CODE_MAX: EMBLEM_PER_CODE_MAX, isMarker: isMarker, findSlot: findSlot, placeholderSlot: placeholderSlot, eraseSpot: eraseSpot, fitArtBox: fitArtBox, slotPlacement: slotPlacement, printFileName: printFileName, testSheetLayout: testSheetLayout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QrPrint = api;
})(this);
