/* Compiles a marker image into a MindAR .mind target in the browser, for the product
   editor's AR step. Same compiler, version and settings as admin.html's target upload:
   tfjs 4.16.0 (with fallbacks) and mind-ar 1.2.5's Compiler, the image fitted to 1024px.
   Loaded lazily: nothing is fetched until the first compile.
   MarkerCompile.compile(canvasOrImage) -> { buffer, matching, tracking } where matching /
   tracking are the feature-point counts the compiler extracted (MIN_MATCHING is the floor
   below which a print on fabric detects slowly or not at all). */
(function (root) {
  'use strict';

  var MIN_MATCHING = 250;
  var MAX_DIM = 1024;
  var TF_VERSIONS = ['4.16.0', '4.8.0', '4.20.0'];
  var MINDAR_URL = 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js';
  var ready = null;

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Failed to load ' + url)); };
      document.head.appendChild(s);
    });
  }

  async function loadTf() {
    if (typeof tf !== 'undefined' && tf.version && tf.version.tfjs) return;
    var lastErr = null;
    for (var i = 0; i < TF_VERSIONS.length; i++) {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@' + TF_VERSIONS[i] + '/dist/tf.min.js');
        if (typeof tf !== 'undefined' && tf.version && tf.version.tfjs) return;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Could not load TensorFlow.js');
  }

  function ensureReady() {
    if (!ready) {
      ready = (async function () {
        await loadTf();
        var mod = await import(MINDAR_URL);
        if (!mod || !mod.Compiler) throw new Error('mind-ar Compiler not found');
        return mod.Compiler;
      })();
      ready.catch(function () { ready = null; }); // let a later attempt retry
    }
    return ready;
  }

  // The source drawn into an image no larger than MAX_DIM on its long side.
  async function toImage(src) {
    var w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    var s = Math.min(1, MAX_DIM / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    var blob = await new Promise(function (r) { c.toBlob(r, 'image/png'); });
    var img = new Image();
    img.src = URL.createObjectURL(blob);
    await img.decode();
    return img;
  }

  function countPoints(target) {
    var matching = (target.matchingData || []).reduce(function (sum, d) {
      return sum + ((d.maximaPoints || []).length) + ((d.minimaPoints || []).length);
    }, 0);
    var tracking = (target.trackingData || []).reduce(function (sum, d) {
      return sum + ((d.points || []).length);
    }, 0);
    return { matching: matching, tracking: tracking };
  }

  async function compile(src, onProgress) {
    var Compiler = await ensureReady();
    var img = await toImage(src);
    var compiler = new Compiler();
    // compileImageTargets calls its progress callback unconditionally.
    await compiler.compileImageTargets([img], typeof onProgress === 'function' ? onProgress : function () {});
    URL.revokeObjectURL(img.src);
    var counts = countPoints((compiler.data || [])[0] || {});
    var buffer = compiler.exportData();
    if (!buffer) throw new Error('The compiler returned no data');
    return { buffer: buffer, matching: counts.matching, tracking: counts.tracking };
  }

  root.MarkerCompile = { MIN_MATCHING: MIN_MATCHING, ensureReady: ensureReady, compile: compile };
})(this);
