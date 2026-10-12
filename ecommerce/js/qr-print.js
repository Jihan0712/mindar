/* Placement maths for the per-shirt QR: where the slot is in a print file, where the QR goes,
   how the art sits in the print area, what a shirt's print file is called and how its paper
   test sheet is laid out. Pure functions (no DOM) so the dashboard and the tests share them.
   Units: px are print-file pixels, in are inches inside the placement's print area. */
(function (root) {
  'use strict';

  var DPI = 300;
  var BLEED_IN = 0.03;   // the emblem overhangs the slot this much on every side (hides the marker)
  var MIN_QR_IN = 2;     // smallest emblem phones read reliably from fabric
  // The emblem's white backing is a fingerprint-shaped blob; at its narrowest it is never
  // less than this fraction of the emblem width (0.857 measured over 3000 links).
  var RIM_MIN = 0.85;

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

  // fitArtBox(area, art) -> the art drawn whole and centred in the print area, in inches.
  // area: { w, h } inches; art: { w, h } px.
  function fitArtBox(area, art) {
    var s = Math.min(area.w / art.w, area.h / art.h);
    var w = art.w * s, h = art.h * s;
    var r = function (n) { return Math.round(n * 10000) / 10000; };
    return { left_in: r((area.w - w) / 2), top_in: r((area.h - h) / 2), width_in: r(w), height_in: r(h) };
  }

  // slotPlacement(slot, art, box, area) -> { size_in, top_in, left_in } or { error }.
  // The emblem is centred on the slot and sized so the narrowest part of its white blob still
  // reaches BLEED_IN past the slot's edge, covering the marker and its blended edge in every
  // direction (the blob bulges past the slot elsewhere); clamped to the print area.
  function slotPlacement(slot, art, box, area) {
    var inPerPx = box.width_in / art.w;
    var slotIn = slot.size * inPerPx;
    var size = (slotIn + 2 * BLEED_IN) / RIM_MIN;
    if (slotIn + 2 * BLEED_IN < MIN_QR_IN * RIM_MIN) return { error: 'too_small', size_in: size };
    var round = function (n) { return Math.round(n * 1000) / 1000; };
    var left = box.left_in + slot.left * inPerPx + slotIn / 2 - size / 2;
    var top = box.top_in + slot.top * inPerPx + slotIn / 2 - size / 2;
    left = Math.min(Math.max(0, left), area.w - size);
    top = Math.min(Math.max(0, top), area.h - size);
    return { size_in: round(size), top_in: round(top), left_in: round(left) };
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

  var api = { DPI: DPI, BLEED_IN: BLEED_IN, MIN_QR_IN: MIN_QR_IN, RIM_MIN: RIM_MIN, isMarker: isMarker, findSlot: findSlot, fitArtBox: fitArtBox, slotPlacement: slotPlacement, printFileName: printFileName, testSheetLayout: testSheetLayout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QrPrint = api;
})(this);
