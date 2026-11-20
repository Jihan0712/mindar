// The viewer must not start MindAR before the scene has set it up (assets/js/ar-ready.js).
// Bug 2026-11-20: tapping "Open camera" within ~3 s of opening the viewer (camera already
// allowed) failed with "Cannot read properties of undefined (reading 'showLoading')".
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { whenArReady } = createRequire(import.meta.url)('../assets/js/ar-ready.js');

// A stand-in for <a-scene>: MindAR's system gets its `ui` only when the scene loads, as on
// the phone; start() throws like MindAR's does without it.
function fakeScene() {
  const scene = new EventTarget();
  const sys = { ui: undefined, start() { this.ui.showLoading(); } };
  scene.hasLoaded = false;
  scene.systems = { 'mindar-image-system': sys };
  scene.load = () => { sys.ui = { showLoading() {} }; scene.hasLoaded = true; scene.dispatchEvent(new Event('loaded')); };
  return { scene, sys };
}

test('starting before the scene loads throws the phone error (the bug)', () => {
  const { sys } = fakeScene();
  assert.throws(() => sys.start(), /reading 'showLoading'/);
});

test('whenArReady waits for the scene to load, then start() works', async () => {
  const { scene, sys } = fakeScene();
  let resolved = false;
  const p = whenArReady(scene, 2000).then(s => { resolved = true; return s; });
  await new Promise(r => setTimeout(r, 50));
  assert.equal(resolved, false, 'not ready before the scene loads');
  scene.load();
  const got = await p;
  assert.equal(got, sys);
  assert.doesNotThrow(() => got.start());
});

test('an already loaded scene is ready at once', async () => {
  const { scene, sys } = fakeScene();
  scene.load();
  assert.equal(await whenArReady(scene, 50), sys);
});

test('a scene that never sets MindAR up gives a clear error instead of hanging', async () => {
  const { scene } = fakeScene();
  scene.hasLoaded = true; // loaded, but no target files, so no mindar-image component
  await assert.rejects(whenArReady(scene, 150), /MindAR was not set up/);
});

test('the viewer waits for whenArReady before calling start()', () => {
  const html = readFileSync(new URL('../viewer.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="assets\/js\/ar-ready\.js"><\/script>/);
  const fn = html.slice(html.indexOf('async function requestCameraAndScan'), html.indexOf("getElementById('openCameraBtn').addEventListener"));
  const wait = fn.indexOf('whenArReady('), start = fn.indexOf('sys.start()');
  assert.ok(wait > 0 && start > wait, 'whenArReady is awaited before sys.start()');
});
