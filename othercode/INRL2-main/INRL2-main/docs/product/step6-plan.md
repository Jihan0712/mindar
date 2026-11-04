# Step 6 plan: INRL without a marker

_Written 2026-10-08. Status lives in [STATUS.md](../STATUS.md); answers to the
open questions go into [decisions.md](decisions.md)._

**Goal:** from any post, INRL opens the camera, finds a real surface (table,
floor), drops the scene on it, and the strip of round thumbnails at the
bottom swaps to the next post **in the same spot**, without leaving the
camera. Like Figma A4 (white ring on the table, "Roy Andersson", strip) and
A41 (the scene standing on the table), and like the iPhone floor test app
that Nico signed off ("100% what I want").

**Never break what's live:** feed, profiles, likes, comments, notifications,
Discover, InStudio, posting, markers, `/m/<code>` scanning, the AR pages.
Every piece passes `lint`, `tsc -b`, `npm test`, `build`, `test:studio`,
`test:publish`, `test:social`, `test:ar` (+ a new `test:inrl`) and is shipped
with the `ship` skill before the next starts.

## What each phone can do

| | Surface AR possible? | How |
|---|---|---|
| **Android, Chrome** | **Yes, on the web.** | WebXR (Chrome's built-in AR, uses Google's ARCore): finds surfaces, keeps the scene locked, our page draws on top. Works on most Android phones sold since ~2019. No install. |
| **iPhone, Safari** | **No.** | Safari still has no web AR for surfaces (Apple only offers it on Vision Pro). Web-only tricks (motion sensor + camera) can make the scene float in front of you, but it slides when you walk: not "on the table". |
| **iPhone, Quick Look** | Partly. | Apple's own AR viewer: real surface placement, but it leaves InRL, plays no video / GIF, has no strip, no swiping. Not the experience. |
| **iPhone, App Clip** | **Yes, the real one.** | A tiny piece of a native app that opens from a link with Apple's "Open" card, nothing to install. Inside: the floor test app's recipe (ARKit finds the surface and tracks, our web page draws the scene and the strip). Web updates go live without Apple review. |
| **iPhone, InRL app** | Yes, same as the App Clip. | Apple requires a full app in the App Store to host an App Clip. It will be the same shell showing the whole InRL web app, with INRL working natively. |

**What the App Clip needs from Apple** (all from Nico's **paid Apple
Developer Program** membership, $99/year): a team ID to sign with,
App Store Connect to create the app record, **TestFlight** to install test
builds on Nico's iPhone without the 7-day expiry, and App Review for the
public release (a few days; Apple may push back on an app that is "just a
website", which the native AR helps us answer). **Until the membership is
active**, everything except the App Clip itself can be built and tested with
the free test install (it expires every 7 days, next on 2026-10-13; I rebuild
it by cable).

**Android testing:** Nico has no Android phone. I can test the logic on the
Mac (desktop Chrome with an AR emulator, and the automated fake-camera
test), but the real feel (surface found, stable, size) needs a real Android
phone. See question 5.

## The pieces, in build order

**Order after Nico's answers (2026-10-08):** iPhone first, in the free test
app: piece 1, then 3, then 5. Android (piece 2) once Nico buys an Android
phone. The App Clip (piece 4) only once Nico decides to launch the beta and
buys the Apple Developer Program.

### 1. The INRL screen, shared by every phone
- **What:** A4 / A41 as one screen: camera picture, **IN3D | INRL** switch,
  ←, white ring that sits on the surface ("Point at a table or the floor",
  then "Tap to place"), the scene drops in with a small pop, author + caption
  line, **the same strip as the post viewer** (swipe or tap = the next scene
  appears in the same spot, same size, neighbours preloaded, the old one
  freed). After placing: one finger turns, pinch resizes, drag moves, "Move"
  lifts it back onto the ring. Video sound button as in the viewer.
- **How:** the floor test's `FloorStage` becomes a general stage that takes
  its camera from a "pose source" (iPhone app, Android WebXR, or a fake one
  for tests). The scene builder is the one every viewer uses.
- **Test:** new `npm run test:inrl` (headless Chrome with a fake pose source
  over a table photo: ring appears, tap places, strip swaps the scene in the
  same spot, video plays, memory freed after many swaps). iPhone: the free
  test app opens it (piece 3).

### 1b. One AR view: surfaces and markers (Nico, 2026-10-09)
- **What:** in the test app, the INRL camera also recognises InRL QR codes /
  markers. Seeing one shows that marker's post on the marker itself (flat on
  a table or upright on a wall / T-shirt) and the strip switches to the
  marker owner's posts; a surface still works when there's no marker. The
  feed's Scan button opens the same view.
- **How:** native. Apple's Vision reads QR codes in the ARKit camera picture
  (a few times a second); the page looks the code up (`/api/m/<code>`) and
  sends the marker's artwork back to the app, which adds it to ARKit's image
  tracking (size estimated automatically). ARKit then follows the marker
  with the same world tracking as the table: steadier than the web tracker,
  and no second camera. Safari keeps today's web scanner.
- **Test:** `test:inrl` with a fake app that reports a QR and an image
  anchor (the scene lands on the marker, the strip switches); on the iPhone:
  the printed test marker, Nico's personal marker on screen and printed,
  flat and upright, plus table → marker → table.

### 2. Android: INRL on the web
- **What:** on Android Chrome, INRL in a post opens WebXR AR straight into
  piece 1's screen (Chrome shows its own "allow camera" prompt the first
  time).
- **Test:** automated as above + desktop Chrome AR emulator; real feel on an
  Android phone when we have one.

### 3. iPhone: the native shell grows up
- **What:** `ios/FloorTest` becomes the **InRL shell**: opens any post
  (`/p/<id>`) in INRL, carries the sign-in over (the floor test's link
  hand-over), same bridge. Still the free test install.
- **Test:** Nico on the iPhone 13: from Safari, a post → INRL → "Open in the
  test app" → the same post on the table, swipe the strip. Report with Copy
  report (fps, tracking, bridge delay).

### 4. iPhone: App Clip + InRL app (needs the paid membership)
- **What:** App Clip target + parent app, signed with the paid team. In
  Safari, INRL in a post shows Apple's App Clip card ("InRL · Open"), which
  opens the App Clip on that post on the table. Sign-in carried over. The
  parent app shows the whole InRL web app with native INRL.
- **Test:** installed via **TestFlight** on Nico's iPhone; then test the
  card from Safari, from a link in Messages, and from a post shared to a
  friend who has nothing installed. Then App Review.

### 5. Fallbacks, everywhere else
- **What:** iPhone Safari before the App Clip exists, desktop, old phones:
  INRL keeps today's behaviour (the author's marker page), with a line
  saying where the table mode works. Scanning a marker is unchanged on every
  phone.
- **Test:** `test:social` / `test:publish` keep passing; a check that a
  desktop browser never shows a broken camera screen.

## Questions for Nico

Answered 2026-10-08: see decisions "Step 6 (INRL without a marker) product
answers".
