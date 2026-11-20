// Whether the print is "there", for the viewer's UI and video.
//
// MindAR reports a loss the moment it misses the print for a few frames, which on a worn
// shirt (folds, motion blur) happens many times a second. The stabiliser already keeps the
// video plane on screen through a short miss (gyroscope coast, COAST_MS in ar-stabilizer.js),
// but the viewer paused the video and flipped to the "scanning" screen on every miss, then
// back to "found" and "playing": the video and the scan brackets flickered over the shirt.
//
// createPresence({ graceMs, onFound, onLost }) calls onLost only after the print has been
// missing for graceMs, and a find inside that time changes nothing (no onFound again).
(function (root) {
  'use strict';

  function createPresence(opts) {
    var graceMs = opts.graceMs == null ? 600 : opts.graceMs;
    var setT = opts.setTimeout || setTimeout, clearT = opts.clearTimeout || clearTimeout;
    var present = false, timer = null;
    return {
      get present() { return present; },
      found: function () {
        if (timer) { clearT(timer); timer = null; }
        if (present) return; // back within the grace time: nothing changed on screen
        present = true;
        opts.onFound && opts.onFound();
      },
      lost: function () {
        if (!present || timer) return;
        timer = setT(function () {
          timer = null;
          present = false;
          opts.onLost && opts.onLost();
        }, graceMs);
      },
      reset: function () { if (timer) { clearT(timer); timer = null; } present = false; },
    };
  }

  var api = { createPresence: createPresence };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.INRLArPresence = api;
})(this);
