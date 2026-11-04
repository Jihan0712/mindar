# Testing

## Automated (Claude runs these)

| Command | Checks |
|---|---|
| `npm run lint` | Code style and React rules (oxlint) |
| `npx tsc -b` | Types |
| `npm test` | Unit tests (vitest), e.g. the scene format |
| `npm run build` | Production build |
| `npm run test:look` | **Look test in AR**: opens `/look` with the fake camera, switches to INRL, waits for the marker, builds every world and variant, fails on page errors or an empty scene. Screenshots `.cache/look-ar-*.png` (look at them). Frame rates here are software rendering: meaningless. |
| `npm run test:studio` | **InStudio** (`/studio`) driven by touch like a phone: tools, library, adding objects, 3D text and a sticker, the 6-object alert, tap to select, drag, two-finger pinch and twist, background colour, scene kept after reload; My scenes (New scene, the card with its picture and count, reopen, delete with Undo then for good, also in the cloud); cloud saving (scene in D1, photos/videos served from R2 with byte ranges, the phone's copies freed, the scene reopening from cloud media); then photos and videos (import from a file, the three placements, a Retro TV screen, dragging on the marker, the 2-video limit), and the marker preview with the fake camera (videos playing, flat and upright). Screenshots `.cache/studio-*.png` (look at them). |
| `npm run test:publish` | **Step 3 end to end** (`scripts/publish-test.mjs`), with Chrome's virtual passkey standing in for Face ID: a scene → → → New Post → sign up (name, user name, passkey) → publish with a caption → Published Successfully → the marker drawn and compiled on the "phone" → Edit your Marker → the post in the profile; sign out (scenes leave the phone) and back in (they return); then a fake camera made from **that personal marker**: `/m/<code>` tracks it and the post's video plays, INART / IN3D, a post's INRL opens that marker on the post, and the feed's Scan reads the QR code in the artwork and tracks it. Its accounts are test accounts (hidden from real people). Screenshots `.cache/publish-*.png`. ~2 minutes. |
| `npm run test:social` | **Step 5, the social layer** (`scripts/social-test.mjs`), grows with each piece: two test phones sign up with virtual passkeys, A publishes three posts; B's feed lists them newest first; a card opens `/p/<id>` (counts a view), swipes go through the list, IN3D draws the scene, INRL outside the test app shows "See it on your table"; Following empty; the bottom bar's tabs; a real signed-out phone opens a post link but doesn't see test accounts. Deletes its posts at the end. Screenshots `.cache/social-*.png`. ~30 s. |
| `npm run test:inrl` | **Step 6, INRL on a surface** (`scripts/inrl-test.mjs`): a fake iPhone test app (bridge version 2) sends ARKit-like frames; a post's INRL asks for the camera, hints "Move your phone slowly…" then "Tap to place", a tap places (anchor + haptic), the scene draws; the strip drops the next post in the same spot at the same size; menu (Place again, Copy test report); IN3D goes back and stops the camera; `?list=` rebuilds the strip; iPhone Safari gets the "Open in the InRL test app" link; markers in the same view (fake QR + image anchor: follows the artwork, scene on the marker flat then upright, table scene gone, taps ignored, "Place on a surface instead", same QR ignored while in sight); a shared link's strip = the author's posts; the feed's Scan in the app. Screenshots `.cache/inrl-*.png`. ~30 s. |
| `npm run marker-check` | Draws and compiles sample personal markers (matching points, compile time) and checks their QR codes straight and at an angle. |
| `npm run thumbs` | Not a test: redraws the library thumbnails into `public/studio/thumbs/` (run after adding or changing library items, with the dev server up). |
| `npm run test:ar` | **The AR flow end to end** in headless Chrome with a fake camera: camera starts, marker recognised, scene shown (screenshot in `.cache/ar-smoke.png`), video and music play, flat/upright placement switches both ways (`.cache/ar-smoke-vertical.png`). |

`test:ar` needs the dev server (`npm run dev`) or a `URL=` pointing at the
live site, plus a fake camera file, generated once:

```bash
python scripts/make-fake-camera.py public/test/marker.png .cache/fakecam.y4m
# needs: pip install pillow numpy imageio-ffmpeg (ffmpeg comes with imageio-ffmpeg)
URL=https://inrl2.marine-469.workers.dev/ar npm run test:ar   # against the live site
```

Note: the built-in browser pane can't use a camera and pauses rendering when
hidden; use the headless test for anything that moves.

## On the iPhone (Nico runs these)

Nico has an **iPhone 13, iOS 18.7, Safari**. No Android phone yet.

How to set up a test:
1. Open the live site in Safari (Claude can produce a QR code that opens it).
2. Marker: show `public/test/marker.png` large on the Mac screen, or print it at about 15 cm on matte paper.
3. Allow the camera and the motion sensor when asked; volume up, silent switch off.
4. Report: what was seen and felt (sticking, smoothness, sound, looks), plus ☰ → **Copy report** pasted into the chat (Universal Clipboard: copy on the iPhone, ⌘V on the Mac). Screen recordings via AirDrop.

The test report shows: state, frame rate, camera start time, time to first
recognition, times lost, video/music state, marker placement and tilt,
motion-sensor permission, screen and device.

## On-phone AR report
The preview's **Copy report** button measures steadiness on the phone itself (`src/ar/report.ts`): readings per second, losses, marker size in camera pixels, gravity lock, tilt wobble raw → shown split into up/down and left/right, position wobble. Hold still ~10 s facing the marker, tap it, paste (Universal Clipboard). The fake camera does not reproduce a real iPhone camera, so use this for anything about steadiness. Reference (2026-10-06, wall poster, iPhone 13): shown tilt 0.53° from a step away, 0.27° closer.

## Results so far

- **2026-10-05, step 1, iPhone 13:** camera start 0.7 s, recognised in 0.9 s, 60 fps, stable, video smooth, sound OK, 3D correct. Upright placement confirmed on the Mac screen.

- **2026-10-05, look test round 1, iPhone 13 (iOS 18.7):** 60 fps in AR in every world (Designers "JULOAXEL": 75k triangles, 60 draw calls, camera reflection refresh 2 ms, build 57 ms); never under 50 fps; phone not hot. Looks: chrome styles good (not premium yet), balloon letters convincing, Designers stickers cheap; letters and shadows glitchy (sticker interpenetration, fixed in round 2).

- **2026-10-05, look test round 2, iPhone 13:** Bubblegum IN3D 60 fps (72k triangles, 60 draw calls). Still "glitchy" (unspecified); donut-O disliked; Designers otherwise approved; Bubblegum needs more character (done in round 3).

- **2026-10-05, look test round 3, iPhone 13 (screen recording):** IN3D glitch gone. AR: scene flipped from upright to flat on the Mac screen after close/steep views and stayed flat; fixed in round 4 (placement robustness).

- **2026-10-05, look test round 4, iPhone 13:** AR still jittery on the Mac screen, worse closer (Nico suspects the screen's refresh). Toy photo appeared mirrored (upside down), fixed in round 5. Printed-marker and Steady-tracking comparison pending.

- **2026-10-05, look test round 5, iPhone 13 (printed marker, video):** still jittery: the scene jumps a few mm and swims against the print frame to frame (pose noise), AR 40–51 fps in Designers. Steady tracking rejected (lag). Adaptive anti-jitter added in round 6.

- **2026-10-05, look test round 6, iPhone 13:** anti-jitter on: "almost no glitch, a tiny bit of delay, much better". Look test passed.

Screen recordings: Nico AirDrops them to `~/Downloads`; extract frames with the ffmpeg bundled in `imageio-ffmpeg` (`python3 -m venv .cache/venv && .cache/venv/bin/pip install imageio-ffmpeg`).

Details of the step-1 protocol: [step-1-test.md](../step-1-test.md).
