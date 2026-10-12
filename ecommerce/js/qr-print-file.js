/* Builds and downloads a shirt's print file in the browser: the print area at 300 DPI with
   the art in its box and the shirt's own QR at its position, saved as a PNG tagged 300 DPI.
   Used by the dashboard's shirt proof and the Wardrobe shirt page. Needs qr-print.js. */
(function (root) {
  'use strict';

  function loadCorsImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Could not load ' + url)); };
      // A separate URL so a copy cached without CORS headers (from a plain <img>) is not reused.
      img.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'print=1';
    });
  }

  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  // Inserts a pHYs chunk (300 DPI) after IHDR so printers place it at its real size.
  async function pngAt300Dpi(blob) {
    var png = new Uint8Array(await blob.arrayBuffer());
    var ppm = Math.round(300 / 0.0254); // pixels per metre
    var chunk = new Uint8Array(21);
    var dv = new DataView(chunk.buffer);
    dv.setUint32(0, 9);
    chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
    dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
    dv.setUint32(17, crc32(chunk.subarray(4, 17)));
    var at = 33; // after the signature (8) and IHDR (25)
    var out = new Uint8Array(png.length + chunk.length);
    out.set(png.subarray(0, at), 0); out.set(chunk, at); out.set(png.subarray(at), at + chunk.length);
    return new Blob([out], { type: 'image/png' });
  }

  function canvasBlob(canvas) {
    return new Promise(function (resolve, reject) {
      try { canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('Could not build the PNG')); }, 'image/png'); }
      catch (e) { reject(new Error('The browser blocked reading the art file. Upload it again through QR placement → Upload print file.')); }
    });
  }

  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
  }

  async function savePng(canvas, name) {
    saveBlob(await pngAt300Dpi(await canvasBlob(canvas)), name);
  }

  // compose({ qr, art_url }, qrUrl) -> { canvas, W, H, qrImg, qr: { x, y, size } }
  // spec is the server's print spec: the QR settings (with the art box) and the art file.
  async function compose(spec, qrUrl) {
    var q = spec.qr;
    if (!spec.art_url) throw new Error('This shirt has no print file for its placement: save QR placement with a print file first.');
    var W = Math.round(q.area_width_in * 300), H = Math.round(q.area_height_in * 300);
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var art = await loadCorsImage(spec.art_url);
    var box = q.art && q.art.url === spec.art_url ? q.art
      : root.QrPrint.fitArtBox({ w: q.area_width_in, h: q.area_height_in }, { w: art.naturalWidth, h: art.naturalHeight });
    ctx.drawImage(art, Math.round(box.left_in * 300), Math.round(box.top_in * 300), Math.round(box.width_in * 300), Math.round(box.height_in * 300));
    var qrImg = await loadCorsImage(qrUrl);
    // The QR PNG is already exactly its print size at 300 DPI — draw it 1:1.
    var qx = Math.round(q.left_in * 300), qy = Math.round(q.top_in * 300);
    ctx.drawImage(qrImg, qx, qy);
    return { canvas: canvas, W: W, H: H, qrImg: qrImg, qr: { x: qx, y: qy, size: qrImg.naturalWidth } };
  }

  // Downloads the stored QR PNG as is (already 300 DPI-sized) under a readable name.
  async function saveQr(qrUrl, name) {
    var res = await fetch(qrUrl + (qrUrl.indexOf('?') === -1 ? '?' : '&') + 'print=1');
    if (!res.ok) throw new Error('Could not download the QR (' + res.status + ')');
    saveBlob(await pngAt300Dpi(await res.blob()), name);
  }

  root.QrPrintFile = { loadCorsImage: loadCorsImage, pngAt300Dpi: pngAt300Dpi, canvasBlob: canvasBlob, savePng: savePng, saveQr: saveQr, compose: compose };
})(this);
