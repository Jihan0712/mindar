// Getting a customer's video ready for the T-shirt (ecommerce/js/video-prep.js): which files are
// uploaded as they are, which are converted, and the size/length maths. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const VideoPrep = createRequire(import.meta.url)('../ecommerce/js/video-prep.js');
const { LIMITS, plan, outputSize, videoBitrate, frameRate, trimWindow, outName, clock } = VideoPrep;

const MB = 1024 * 1024;
const fits = { name: 'clip.mp4', type: 'video/mp4', size: 6 * MB, duration: 14, videoCodec: 'avc', audioCodec: 'aac', width: 1080, height: 1920 };

test('an MP4 (H.264) under 10 MB and 30 s is uploaded as it is', () => {
  assert.deepEqual(plan(fits), { action: 'keep', reasons: [], trim: false });
  assert.equal(plan({ ...fits, audioCodec: null }).action, 'keep', 'no sound is fine');
});

test('a typical iPhone video (.MOV, HEVC, 32 MB, 15 s) is converted, not refused', () => {
  const p = plan({ name: 'IMG_4127.MOV', type: 'video/quicktime', size: 32 * MB, duration: 15.2, videoCodec: 'hevc', audioCodec: 'aac', width: 1080, height: 1920 });
  assert.equal(p.action, 'convert');
  assert.deepEqual(p.reasons, ['format', 'codec', 'size']);
  assert.equal(p.trim, false);
});

test('a long or large MP4 is converted; over 30 s it is trimmed', () => {
  assert.deepEqual(plan({ ...fits, size: 40 * MB }).reasons, ['size']);
  const long = plan({ ...fits, duration: 72 });
  assert.equal(long.action, 'convert');
  assert.equal(long.trim, true);
  assert.equal(plan({ ...fits, duration: 30.02 }).trim, false, 'a hair over 30 s (rounding) is not trimmed');
  assert.deepEqual(plan({ ...fits, videoCodec: 'hevc' }).reasons, ['codec'], 'HEVC in an .mp4 does not play on most Android phones');
  assert.deepEqual(plan({ ...fits, audioCodec: 'opus' }).reasons, ['audio']);
});

test('the output keeps the shape, long side 1280 at most, in even pixels', () => {
  assert.deepEqual(outputSize(1080, 1920), { width: 720, height: 1280 });
  assert.deepEqual(outputSize(3840, 2160), { width: 1280, height: 720 });
  assert.deepEqual(outputSize(720, 1280), { width: 720, height: 1280 });
  assert.deepEqual(outputSize(641, 359), { width: 642, height: 360 }, 'small videos are not enlarged, only made even');
  assert.equal(outputSize(0, 0), null);
});

test('the bitrate keeps 30 s (and any shorter clip) under 10 MB, lower on each retry', () => {
  for (const s of [3, 10, 15, 30]) {
    const bytes = (videoBitrate(s, 0) + LIMITS.audioBps) * s / 8;
    assert.ok(bytes <= LIMITS.maxBytes * LIMITS.fill + 1, s + ' s → ' + (bytes / MB).toFixed(1) + ' MB');
  }
  assert.equal(videoBitrate(10, 0), LIMITS.maxVideoBps, 'short clips get the full quality cap');
  assert.ok(videoBitrate(30, 1) < videoBitrate(30, 0) && videoBitrate(30, 2) < videoBitrate(30, 1));
  assert.ok(videoBitrate(30, 9) >= LIMITS.minVideoBps);
});

test('60 fps phone video drops to 30 fps; slower video keeps its rate', () => {
  assert.equal(frameRate(59.94), 30);
  assert.equal(frameRate(30), undefined);
  assert.equal(frameRate(24), undefined);
  assert.equal(frameRate(null), undefined);
});

test('the trim window is 30 s that fits inside the video', () => {
  assert.deepEqual(trimWindow(72, 0), { start: 0, end: 30 });
  assert.deepEqual(trimWindow(72, 20), { start: 20, end: 50 });
  assert.deepEqual(trimWindow(72, 60), { start: 42, end: 72 }, 'a start too late is pulled back');
  assert.deepEqual(trimWindow(72, -5), { start: 0, end: 30 });
  assert.deepEqual(trimWindow(12, 5), { start: 0, end: 12 }, 'a short video is used whole');
});

test('names and times', () => {
  assert.equal(outName('IMG_4127.MOV'), 'IMG_4127.mp4');
  assert.equal(outName('my.holiday.clip.mov'), 'my.holiday.clip.mp4');
  assert.equal(outName(''), 'video.mp4');
  assert.equal(clock(72.4), '1:12');
  assert.equal(clock(9), '0:09');
});
