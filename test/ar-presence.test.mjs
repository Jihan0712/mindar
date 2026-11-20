// The viewer's video and scanning screen must not flicker on brief tracking misses
// (assets/js/ar-presence.js). Bug 2026-11-20: a 0.2 s miss on a worn shirt paused the video
// and flipped playing → scanning → found → playing. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { createPresence } = createRequire(import.meta.url)('../assets/js/ar-presence.js');

// Fake clock: timers fire only when advance() passes them.
function clock() {
  let now = 0, id = 0; const timers = new Map();
  return {
    setTimeout: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; },
    clearTimeout: (t) => timers.delete(t),
    advance(ms) {
      now += ms;
      for (const [k, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (t.at <= now) { timers.delete(k); t.fn(); }
    },
  };
}
function setup() {
  const c = clock(), calls = [];
  const p = createPresence({ graceMs: 600, onFound: () => calls.push('found'), onLost: () => calls.push('lost'), setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  return { c, calls, p };
}

test('a brief miss (0.2 s) changes nothing: no lost, no second found', () => {
  const { c, calls, p } = setup();
  p.found();
  p.lost(); c.advance(200); p.found(); c.advance(1000);
  assert.deepEqual(calls, ['found']);
  assert.equal(p.present, true);
});

test('many brief misses in a row (a worn shirt) still change nothing', () => {
  const { c, calls, p } = setup();
  p.found();
  for (let i = 0; i < 20; i++) { p.lost(); c.advance(150); p.found(); c.advance(100); }
  assert.deepEqual(calls, ['found']);
});

test('a real loss (longer than 0.6 s) is reported once, then a new find is reported', () => {
  const { c, calls, p } = setup();
  p.found();
  p.lost(); c.advance(599);
  assert.deepEqual(calls, ['found'], 'not yet at 599 ms');
  c.advance(1);
  assert.deepEqual(calls, ['found', 'lost']);
  p.lost(); c.advance(2000);
  assert.deepEqual(calls, ['found', 'lost'], 'no repeated lost');
  p.found();
  assert.deepEqual(calls, ['found', 'lost', 'found']);
});

test('a loss before anything was found is ignored', () => {
  const { c, calls, p } = setup();
  p.lost(); c.advance(1000);
  assert.deepEqual(calls, []);
});

test('the viewer routes MindAR found/lost through the grace window', () => {
  const html = readFileSync(new URL('../viewer.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="assets\/js\/ar-presence\.js"><\/script>/);
  assert.match(html, /addEventListener\('targetLost', \(\) => presence\.lost\(\)\)/);
  assert.match(html, /addEventListener\('targetFound', \(\) => presence\.found\(\)\)/);
  assert.doesNotMatch(html, /addEventListener\('targetLost', \(\) => \{\s*lastTargetVisible = false;\s*clearTimeout\(foundPulseTimer\);\s*aframeVideoAsset\.pause\(\)/);
});
