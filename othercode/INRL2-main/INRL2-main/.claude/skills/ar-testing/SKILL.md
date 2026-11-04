---
name: ar-testing
description: Test INRL2's AR (marker tracking, scene placement, video/music playback, flat vs upright markers) automatically in headless Chrome with a fake camera, and prepare iPhone test instructions for Nico. Use after any change to src/ar, src/scene, media handling, markers, or the AR/IN3D pages, and before shipping such changes.
---

# Testing AR

The built-in browser pane can't use a camera and stops rendering when hidden,
so AR is tested in **headless Chrome** (`/Applications/Google Chrome.app`)
with a fake camera video showing the marker.

## 1. Fake camera (once per marker)
```bash
python scripts/make-fake-camera.py public/test/marker.png .cache/fakecam.y4m
```
Needs Python with `pillow numpy imageio-ffmpeg` (a venv is fine). Regenerate
whenever the marker changes. The video shows the marker lying on a table seen
at ~45° in true perspective; a flat squash is NOT enough (MindAR reads it as
a steep tilt and the 3D looks wrong).

## 2. Run
```bash
npm run dev &                                    # or test the live site:
npm run test:ar                                  # URL=https://inrl2.marine-469.workers.dev/ar npm run test:ar
```
For the look test (`/look`): `npm run test:look` (same fake camera; `URL=…/look` for live).

Passes when: the marker is recognised, video and music play, placement
switches flat → vertical → flat when fake `deviceorientation` events say the
phone is upright vs pitched down. Screenshots: `.cache/ar-smoke.png`
(flat) and `.cache/ar-smoke-vertical.png`. **Look at them**: correct = objects
standing on the marker, video showing on the 3D screen.

To probe state yourself, the AR root exposes `data-phase`
(intro/starting/scanning/tracking/error) and `data-placement` (flat/vertical);
the ☰ panel (`.ar-debug`) lists timings and media state.

## 3. iPhone test for Nico
Write short numbered steps: open the live site in Safari (offer a QR code made
with the `qrcode` package), marker on the Mac screen or printed at 15 cm,
allow camera and motion, volume up / silent switch off, what to look for,
then ☰ → Copy report → paste via Universal Clipboard. Record results in
`docs/tech/testing.md`.

## Gotchas learned
- First `play()` of media must happen synchronously in the tap (iOS).
- Media must be served with byte ranges (206), see `worker/index.ts`.
- iOS motion permission (`DeviceOrientationEvent.requestPermission`) must also be requested inside the tap.
- Shadow cameras don't inherit the anchor's scale: size them by `tracker.markerWidth`.
