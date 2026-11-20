// Waits until MindAR can be started.
//
// MindAR's start() calls this.ui.showLoading(), and `ui` only exists once the scene's
// `mindar-image` component has run setup(). A-Frame runs that when the scene loads, which
// waits for <a-assets> (its video, or A-Frame's 3 s timeout). The "Open camera" button shows
// well before that, so a quick tap (camera already allowed) started MindAR too early and
// failed with "Cannot read properties of undefined (reading 'showLoading')".
//
// whenArReady(scene, timeoutMs) resolves with the mindar-image-system once it has its ui,
// or rejects after timeoutMs (e.g. the target has no .mind or video, so the component was
// never added).
(function (root) {
  'use strict';

  function arSystem(scene) {
    var sys = scene && scene.systems && scene.systems['mindar-image-system'];
    return sys && sys.ui ? sys : null;
  }

  function whenArReady(scene, timeoutMs) {
    var ready = arSystem(scene);
    if (ready) return Promise.resolve(ready);
    return new Promise(function (resolve, reject) {
      var done = false, iv = null, to = null;
      function finish(err, sys) {
        if (done) return;
        done = true;
        clearInterval(iv); clearTimeout(to);
        try { scene.removeEventListener('loaded', check); } catch (e) {}
        if (err) reject(err); else resolve(sys);
      }
      function check() { var sys = arSystem(scene); if (sys) finish(null, sys); }
      try { scene.addEventListener('loaded', check); } catch (e) {}
      iv = setInterval(check, 100);
      to = setTimeout(function () {
        finish(new Error(scene && scene.hasLoaded
          ? 'the AR scene loaded but MindAR was not set up (no print or video for this target?)'
          : 'the AR scene did not finish loading'));
      }, timeoutMs || 20000);
    });
  }

  var api = { whenArReady: whenArReady, arSystem: arSystem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.INRLArReady = api;
})(this);
