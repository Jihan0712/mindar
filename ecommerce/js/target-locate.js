/* Finds where a target's tracked image sits inside a product's print file, so the product
   editor can draw a box round the part of the design the AR locks onto (and the video
   covers). The tracked image is usually a crop of the print file at some other resolution,
   so this searches position and uniform scale with normalised cross-correlation on
   brightness, coarse first, then refined round the best few hits.
   Pure functions (no DOM) so the dashboard and the tests share them. */
(function (root) {
  'use strict';

  var COARSE_MAX = 72;    // print file's long side during the full search, px
  var FINE_MAX = 240;     // ... during refinement
  var MIN_FRACTION = 0.12; // smallest tracked area searched, as a share of the print's width
  var SCALE_STEP = 1.07;
  var CANDIDATES = 4;     // coarse hits refined
  // Below this the tracked image is probably not in this print file (another design, or a
  // photo of it), so the editor shows it without a box.
  var MIN_SCORE = 0.8;

  // Brightness as MindAR sees it ((R+G+B)/3). Transparent pixels count as black, the same
  // for both images, so a transparent print and a crop of it still agree.
  function toGray(rgba, w, h) {
    var out = new Float32Array(w * h);
    for (var i = 0; i < w * h; i++) {
      var b = i * 4;
      out[i] = (rgba[b] + rgba[b + 1] + rgba[b + 2]) / 3 * (rgba[b + 3] / 255);
    }
    return out;
  }

  // Area-average resample (box filter), so shrinking doesn't alias fine detail.
  function resize(src, w, h, nw, nh) {
    var out = new Float32Array(nw * nh);
    var sx = w / nw, sy = h / nh;
    for (var y = 0; y < nh; y++) {
      var y0 = y * sy, y1 = y0 + sy;
      for (var x = 0; x < nw; x++) {
        var x0 = x * sx, x1 = x0 + sx;
        var sum = 0, area = 0;
        for (var yy = Math.floor(y0); yy < Math.min(h, Math.ceil(y1)); yy++) {
          var wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
          if (wy <= 0) continue;
          for (var xx = Math.floor(x0); xx < Math.min(w, Math.ceil(x1)); xx++) {
            var wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
            if (wx <= 0) continue;
            sum += src[yy * w + xx] * wx * wy;
            area += wx * wy;
          }
        }
        out[y * nw + x] = area ? sum / area : 0;
      }
    }
    return out;
  }

  function fit(w, h, max) {
    var s = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }

  // Zero-mean template and its norm.
  function prepTemplate(t) {
    var n = t.length, mean = 0;
    for (var i = 0; i < n; i++) mean += t[i];
    mean /= n;
    var z = new Float32Array(n), norm = 0;
    for (var j = 0; j < n; j++) { z[j] = t[j] - mean; norm += z[j] * z[j]; }
    return { z: z, norm: Math.sqrt(norm) };
  }

  // NCC of template (zero-mean tz, tw x th) against the print window at (ox, oy).
  function nccAt(P, PW, tz, tnorm, tw, th, ox, oy) {
    var n = tw * th, sp = 0, sp2 = 0, spt = 0;
    for (var y = 0; y < th; y++) {
      var row = (oy + y) * PW + ox, trow = y * tw;
      for (var x = 0; x < tw; x++) {
        var p = P[row + x];
        sp += p; sp2 += p * p; spt += p * tz[trow + x];
      }
    }
    var pvar = sp2 - sp * sp / n;
    if (pvar <= 1e-6 || tnorm <= 1e-6) return -1;
    return spt / (Math.sqrt(pvar) * tnorm);
  }

  // locate(print, tracked) where each is { gray: Float32Array, w, h } (see toGray) ->
  // { x, y, w, h } as fractions of the print file, plus score (-1..1) and found
  // (score >= MIN_SCORE), or null when the tracked image can't fit inside the print.
  function locate(print, tracked) {
    var aspect = tracked.h / tracked.w;
    var c = fit(print.w, print.h, COARSE_MAX);
    var P = resize(print.gray, print.w, print.h, c.w, c.h);
    var tmid = fit(tracked.w, tracked.h, 128);
    var Tmid = resize(tracked.gray, tracked.w, tracked.h, tmid.w, tmid.h);

    var maxTw = Math.min(c.w, c.h / aspect);
    var minTw = Math.max(8, Math.min(maxTw, c.w * MIN_FRACTION));
    if (maxTw < 4) return null;

    var hits = [];
    var widths = [];
    for (var tw0 = maxTw; tw0 >= minTw; tw0 /= SCALE_STEP) widths.push(tw0);
    for (var k = 0; k < widths.length; k++) {
      var tw = Math.max(1, Math.min(c.w, Math.round(widths[k])));
      var th = Math.max(1, Math.min(c.h, Math.round(tw * aspect)));
      var T = prepTemplate(resize(Tmid, tmid.w, tmid.h, tw, th));
      for (var oy = 0; oy + th <= c.h; oy++) {
        for (var ox = 0; ox + tw <= c.w; ox++) {
          var s = nccAt(P, c.w, T.z, T.norm, tw, th, ox, oy);
          hits.push({ s: s, x: ox, y: oy, w: tw, h: th });
        }
      }
    }
    hits.sort(function (a, b) { return b.s - a.s; });
    // Distinct candidates: skip hits that overlap one already kept.
    var cands = [];
    for (var i = 0; i < hits.length && cands.length < CANDIDATES; i++) {
      var hh = hits[i], dup = false;
      for (var j = 0; j < cands.length; j++) {
        var q = cands[j];
        if (Math.abs(q.x - hh.x) <= 2 && Math.abs(q.y - hh.y) <= 2 && Math.abs(q.w - hh.w) / q.w < 0.15) { dup = true; break; }
      }
      if (!dup) cands.push(hh);
    }
    if (!cands.length) return null;

    // Refine each candidate at a finer resolution.
    var f = fit(print.w, print.h, FINE_MAX);
    var F = resize(print.gray, print.w, print.h, f.w, f.h);
    var k2 = f.w / c.w;
    var tfine = fit(tracked.w, tracked.h, 320);
    var Tfine = resize(tracked.gray, tracked.w, tracked.h, tfine.w, tfine.h);
    var best = null;
    var cache = {};
    for (var ci = 0; ci < cands.length; ci++) {
      var cd = cands[ci];
      for (var sc = 0.9; sc <= 1.101; sc += 0.02) {
        var fw = Math.round(cd.w * k2 * sc);
        var fh = Math.round(fw * aspect);
        if (fw < 4 || fw > f.w || fh > f.h) continue;
        var key = fw + 'x' + fh;
        var FT = cache[key] || (cache[key] = prepTemplate(resize(Tfine, tfine.w, tfine.h, fw, fh)));
        var cx = (cd.x + cd.w / 2) * k2, cy = (cd.y + cd.h / 2) * k2;
        var r = Math.ceil(k2 * 1.5);
        var bx = Math.round(cx - fw / 2), by = Math.round(cy - fh / 2);
        for (var dy = -r; dy <= r; dy++) {
          var y2 = by + dy;
          if (y2 < 0 || y2 + fh > f.h) continue;
          for (var dx = -r; dx <= r; dx++) {
            var x2 = bx + dx;
            if (x2 < 0 || x2 + fw > f.w) continue;
            var s2 = nccAt(F, f.w, FT.z, FT.norm, fw, fh, x2, y2);
            if (!best || s2 > best.s) best = { s: s2, x: x2, y: y2, w: fw, h: fh };
          }
        }
      }
    }
    if (!best) best = { s: cands[0].s, x: cands[0].x * k2, y: cands[0].y * k2, w: cands[0].w * k2, h: cands[0].h * k2 };
    return {
      x: best.x / f.w, y: best.y / f.h, w: best.w / f.w, h: best.h / f.h,
      score: best.s, found: best.s >= MIN_SCORE
    };
  }

  var api = { MIN_SCORE: MIN_SCORE, toGray: toGray, resize: resize, locate: locate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TargetLocate = api;
})(this);
