# Status

_Last updated: 2026-10-08 (step 6 started: INRL on a surface, iPhone test app)_

## Where we are

**Step 6 (INRL without a marker) started 2026-10-08.** Plan: [step6-plan.md](product/step6-plan.md); Nico's answers: decisions "Step 6 (INRL without a marker) product answers" (no paid Apple membership yet, keep the free test app; iPhone first, Android later; strip = the posts you came from; A4/A41 strictly; INRL from a post = a surface, always).
- **Piece 1 + iPhone shell built and live (web), waiting for Nico's iPhone test.** A post's INRL now opens `/p/<id>/inrl`. **In the test app** ("InRL Floor", which now shows the whole InRL web app: feed, profile…; camera only on INRL): Figma A4's white aim mark on the table / floor ("Move your phone slowly…", "Tap to place"), tap = the scene pops onto it, one finger slides, pinch resizes, twist turns; author + caption above the strip; swiping the strip drops the next post in the same spot at the same size; ☰ = Place again / Copy test report; ← or IN3D = back to the post. **In Safari**: "See it on your table" sheet: "Open in the InRL test app" (iPhone; carries the post, its strip and the phone key, so the app is signed in as you), "See it on X's marker", Back to IN3D.
- **Nico's first test (2026-10-09): "looks great and good quality"**. Two problems, fixed the same morning: (1) **hard to get the table picked** → the app now takes the *nearest* surface (a floor plane reaching under the table used to win, so the aim landed on the floor "through" the table), aims at 60 % of the screen height (as in A4) instead of the middle, the aim mark glides instead of jittering, and after 6 s without a surface the hint says to tilt down, step back, add light; (2) **← from INRL stayed in the test app** (felt like two products) → when you came from Safari, ← / IN3D sends you back to Safari on the same post, and the app rests on that post. Waiting for Nico's re-test.
- **Nico's re-test (2026-10-09):** 60 fps, bridge 1 ms. The strip had gone ("1 of 1"): opened from a link (or after ←), a post had no list. Fixed: with no list, the strip holds **the author's posts** (IN3D and INRL), and the list is kept going back and forth. Nico also wants **one AR view that both places posts on surfaces and scans QR codes / markers** (plan: step6-plan piece 1b).
- **One AR view (piece 1b) built 2026-10-09, Nico: "all recommended".** In the test app the INRL camera also reads QR codes (Apple Vision, 4×/s). An InRL marker's QR → "Marker found: hold your phone steady on it" → the app follows the marker's artwork with ARKit image tracking (size estimated by ARKit, first guess 20 cm) → the marker's post appears on it, flat on a table or upright on a wall (same layout as web AR), the table scene goes (one scene at a time), the strip becomes the owner's posts. ☰ "Place on a surface instead" goes back (that marker is ignored until out of sight 3 s). The feed's Scan button in the app opens this view with the feed in the strip (← back to the feed). Safari's scanner is unchanged. The printed test marker works too (QR …/m/test). Waiting for Nico's iPhone test (needs the new app build, installed).
- **Nico's marker test (2026-10-09/10):** his personal marker (de2zpcs, on the Mac screen) read, tracked, 14.9 cm, upright: works and stable ("the printed test marker shows the test scene" was expected). Fixed: on a marker the video never started (no tap to place; Low Power Mode blocks autoplay) and the sound button was hidden → sound button on markers too, any tap on the scene starts the videos; the app now tells the page when Low Power Mode is on (a note on screen + in Copy report: drawing is capped at 30 fps). Nico mentioned "quite a few bugs": list asked for.
- **Test app version 2 installed on Nico's iPhone 2026-10-08 22:55** (over Wi-Fi, the phone was paired; free install, expires ~2026-10-15, rebuild to renew).
- Automated: new `npm run test:inrl`; `test:social` and `test:publish` updated for the new INRL.
- **Next:** Nico's iPhone test of piece 1, then polish from it, then piece 5 (fallbacks); Android (WebXR) once Nico buys an Android phone; App Clip only when Nico decides to launch the beta.

**Step 5 (social layer) started 2026-10-07.** Plan: [step5-plan.md](product/step5-plan.md); Nico's answers: decisions "Step 5 (social) product answers". **Pieces 1–2 live and tested by Nico on the iPhone (all working).** After his test: Create opens a new scene straight in the editor, My scenes moved into the profile, post pictures are clean (no grid, framed on the objects). Then (Nico, after trying to post): **publishing redone**. → opens **Frame your shot** (InRL frames the post picture, you can turn / pinch / move, Reset, Next); **New Post** has one "Show on my marker" switch (on for a first post, off after) and a **Post** button; **Published** stays ~2.5 s, then you land on **your new post in IN3D**. **Posts open straight in IN3D** (no INART page; switch = IN3D | INRL, the picture shows first and the 3D fades in): swipe up/down = next post, one finger sideways = turn, pinch = zoom, two fingers up/down = tilt, double-tap = reset. Marker tab: "Choose the post it shows" + a line explaining the marker. Then (Nico's test of that): **one 4:5 picture shape everywhere** (what you frame is what everyone sees), **no marker in IN3D**, and inside a post a **strip of round thumbnails** at the bottom (swipe / tap) with the 3D getting every gesture back and **no bottom bar**. Then (Nico's screen recording): the strip is a snapping carousel, switching cross-fades with no black video flash, IN3D opens on the exact framed view (saved with the post as `scene.view`), and landing after posting shows your posts in the strip. **Nico's recording (23:39): "everything looks very good".** Small polish noted for piece 3: the first open of a post shows a black "Loading…" screen for a moment (show the feed card's picture instead); posts made before `scene.view` open framed a little far.
- **Home is the feed** (Figma A1): InRL logo, Scan (top right), For You / Following, cards with the post picture, author · time, likes and views. For You = every post (Featured first, then newest); Following stays empty until follows (piece 3). Test accounts (made by the automated tests, and @tmuxbfper) never show to real people.
- **Bottom bar** (NAV MENU 2) on Home, the post viewer and Profile: Home, Search, **Create** (a new scene in the editor; × comes back), Notifications, Profile. **My scenes** is reached from the profile (Objects tab). Search and Notifications show "coming in a few days" pages.
- **Post viewer** `/p/<id>` (C1 / G1 layout over the 3D): IN3D straight away, author, likes, views, time, caption, sound, Share (post link). Strip of round thumbnails at the bottom for the posts around it (feed or profile). INRL = the author's marker page on that post. Opening a post, or scanning a marker, counts a view (once per person per day).
- The old test pages moved to `/tests` (Profile ☰ → Test pages).
- Automated: `npm run test:social` (two test accounts, feed, viewer, swipes, IN3D, views, bottom bar, a signed-out phone); `test:publish` updated (Scan moved to the feed, INRL from a post).
- **All 8 pieces of step 5 are live (2026-10-08 morning), waiting for Nico's review.** Not done yet (small, later if wanted): tapping follower counts (lists), notifications for comment likes and @mentions, recent searches, e-mail alerts for reports. **Next: step 6 (Nico, 2026-10-08), in a new chat.** INRL without a marker: drop a post on a surface and swipe the strip (Figma A4 / A41), as Nico asked. Start by reading the roadmap's step 6, decisions "2026-10-07: Nico's first feed test" (the INRL wish) and the iPhone floor test notes above (`ios/FloorTest`, ARKit under the web page, App Clip once the paid Apple Developer Program is active).
- **Overnight 2026-10-08 (Nico: "build comments, Discover, report and block, I'll review in the morning"):**
  - **Report and block (piece 8) live.** "•••" at the top right of someone else's post, and on someone else's profile: **Report** (why, in one tap: spam / nudity / hate or harassment / violence / my work, brand or likeness / something else, plus an optional word) or **Block** (explained; you stop seeing each other's posts, comments, likes, notifications and search results, follows end both ways, they aren't told). Others' comments have **Report**. Unblock: profile ☰ → Blocked people. **Reports go to Nico**: profile ☰ → "Reports (InRL team)" (`/admin`, only for user names in `ADMINS`, wrangler.jsonc: `nico`): each report with what it points at, Remove (post / comment) or Hide this person, Dismiss.
  - **Discover (piece 7, G3) live.** Search tab: a search field, then scenes popular lately (Featured first, then likes ×3 + comments ×4 + views, fading with age; the first card big, the others two by two, more as you scroll). Typing searches people (user name starting with it, or name containing it; most followed first) and scenes (caption). Results open profiles and posts.
  - **Comments (piece 5, C12) live.** The speech-bubble button with its count in every post opens the sheet: add (Enter or the arrow sends), like a comment (teal heart), Reply (starts with @name), Delete your own; the post's author can Hide / Unhide or Delete any comment (hidden: dimmed for the writer and the author, gone for others). At most 8 comments a minute per person. "x commented: …" in Notifications (opens the post with its comments). The sheet rises above the iPhone keyboard.
- **Pieces 4 + 6 (likes and notifications) built 2026-10-08, waiting for Nico's test.** A heart (with count) in every post, red when liked; **double tap on the scene likes** (a heart pops; never unlikes), and a "Reset view" button appears once the scene was turned (double tap no longer resets). Likes nudge posts up For You (2 h each, up to 2 days). **Notifications** (G5): Today / Yesterday / Earlier, "a, b and N others liked your scene" (one line per post and day, with its picture), "x started following you" with Follow Back / Followed; a teal dot on the bell when something is new (checked every minute and when the app comes back), cleared by opening Notifications. Nico's girlfriend has an account: two real people now.
- **Piece 3 (profiles and follows) built overnight 2026-10-08; Nico: "everything works fine"** (his photo was stretched in the feed cards: fixed). `/u/<username>` for anyone (G2 / G21), `/me` for you (B1r2): picture, NAME, @handle, followers / following / views, bio; Follow ↔ Unfollow (others), Edit Profile + Share Profile (you). Objects tab: the post on the marker big with a pin, the others two by two; your own posts have ••• (Show it on my marker, Delete post with a second tap). Marker tab for others: their marker + "See it in real life". Names and pictures in the feed and in posts open profiles; the "+" on a post's author picture follows them; the Following tab works. **Edit Profile**: a photo placed in a circle (drag, pinch or slider to zoom), name, bio (150). Also: a post opens on the feed card's picture straight away (no black "Loading…").

**Step 3 (publish → marker → scan) live and tested by Nico on the iPhone (2026-10-07): "everything looks good and works, AR is stable", QR from the normal camera works, Face ID sign-in easy. IN3D gestures felt jumpy: his screen recording showed fingers landing on the hint text over the 3D, so Safari took the gestures (page shrinking to tabs, view jumping). Fixed: hints let touches through, the 3D/camera screens block Safari's own pinch and scrolling, the hint moved to the bottom and fades, double-tap resets the view on iPhone, and IN3D shows fps + slow frames with Copy report. Nico re-tested: IN3D "works perfect now".** Plan: [step3-plan.md](product/step3-plan.md). What exists now:
- **Accounts with passkeys** (`/welcome`): Create my account (full name, user name, Face ID makes the passkey) or I already have an account (Face ID). Signing in links the phone and moves its scenes into the account; sign out from the profile's ☰.
- **New Post** (`/studio/post/:id`, the editor's →): picture, caption 0/150, Attach to Your Marker, Publish Post → Published Successfully → the Marker tab. Not signed in → sign-in first, then back. The old preview is the "Try it on the test marker first" link.
- **Profile** (`/me`): Objects (posts, delete with a second tap) and Marker (artwork made on the phone the first time, Edit your Marker → Publish Marker, Share/Save = the iPhone share sheet with Save Image / Print; ☰: new marker design, sign out).
- **Personal markers**: generated sticker-bomb artwork in the brand palette with the QR code and @username; QR = `…/m/<code>`.
- **Scanning**: the iPhone camera app opens `/m/<code>` (Open camera → the post on the marker; INART / IN3D / INRL switch; round thumbnails to swipe through the owner's posts); **Home → Scan a marker** reads the QR in the artwork, then tracks it. The test marker's QR also works in Scan (test scene).
- **Home** now starts with Scan / InStudio / Sign in.
- The scan screen has **Copy report** (marker code, points, tracking numbers) for test feedback.
- Live checks: `test:publish` passed **against the live site** (real passkey on the real address); it left a throwaway account `@tmuxbfper` (and earlier dev-only ones) in the live database; harmless, can be deleted later.
- Automated: `npm run test:publish` (virtual passkey: sign up, publish, marker made, sign out/in, fake camera of that personal marker → /m/code tracks + video plays, in-app Scan reads the QR and tracks); unit tests for passkeys, accounts, posts, markers; `test:studio`, `test:ar`, `test:look` unchanged and passing.

**Known risk: personal markers seen at a steep angle.** In the harsh automated test (640×480 fake camera, marker small and at 45°) generated designs vary: after reworking the artwork onto the test marker's recipe (patchwork of angular shapes, pen strokes, dots; stickers as accents), 6 of 8 designs are found in under 2 s and followed every frame, 2 are not; the same variation shows with the test marker's own recipe on other seeds, and nothing measurable on the phone predicts it. The iPhone uses an HD camera and real optics (the printed test marker works well there), so the real test decides. If a marker is hard to catch, ☰ → New marker design.

### Decisions to confirm (made provisionally overnight; each easy to change)
1. ~~Sign-in~~ **Answered:** target is email + password, Face ID, Google, Apple, on InRL's own domain (passkeys only until then).
2. ~~Marker artwork~~ **Answered:** generated artwork for now, never people's own; a better design later.
3. **Publish screens**: Figma E18r3 / E19r3 followed; music row hidden; "Attach to Your Marker" is a toggle (on by default, shows ✓); the → arrow goes to New Post (preview moved to a link there). Alternative: keep → for the preview and add a separate Post button.
4. **A post is a frozen copy** of the scene; editing the scene later doesn't change it (publish again for a new post). Alternative: posts update when the scene is edited.
5. **What a marker shows**: the attached post, else the newest. One marker per account. Alternative: several markers (Figma's old Marker 1–4).
6. **Profile pictures: not yet** (a letter in a circle). Needs: photo upload + crop (small piece of work).
7. **Scanning UI**: INRL opens first with an "Open camera" sheet (iOS needs a tap for the camera and motion sensor); the in-app Scan button opens the camera straight away. No shutter/photo button yet (A2 shows one).

**iPhone floor-placement test: done and signed off (2026-10-07).** Nico: "the experience is 100% what I want and need. The AR experience is fantastic and stable." Next: **step 3** (new chat), while Nico enrolls in the paid Apple Developer Program; the App Clip follows once enrolled. A test app (`ios/FloorTest`, "InRL Floor", installed on Nico's iPhone 13, signed with a free Apple ID nico@wearenot.co) runs ARKit under our web page `/floor`. Nico: the scene stands on the floor/bed, "looks stable", "AR experience is very good", size right (1 marker width = 0.5 m). Report: 60 fps drawing, 60 ARKit poses/s reach the page, bridge delay 0–2 ms (ARKit drops to 30/s in the dark). Nico's own scenes (photos, videos, GIFs, 3D text) play in the app ("all been fixed !!!!"); his videos had frozen on a second launch because of a server bug (below). Nico's own scenes now reach the app: from Safari, My scenes → "See them on the floor (iPhone test app) →" → "Linked to your phone: 2 scenes found" ("Working !!!!"). Links tapped in the Claude app open Claude's own browser, whose storage (and phone key) is separate from Safari's.

**Step 2 complete (2026-10-06). Piece 5 (saving) confirmed on the iPhone: Nico "everything works totally fine". Next: step 3 (publish → marker → scan).** InStudio now opens on **My scenes** (`/studio`): a "New scene" card and one card per scene (picture, name with date and time, object count, last change, cloud state Saved / Saving… / On this phone, delete with a 5 s Undo). The editor's × goes back to the list. **Cloud saving**: 2.5 s after editing pauses (and when leaving the editor) the scene's photos and videos upload to R2 (big videos in 20 MB parts), the phone's copies are then freed, and the scene + picture go to D1. Offline: kept on the phone and retried. Scenes belong to "this phone" (private key on the phone) until accounts. Nico's previous single draft becomes his first scene. Automated: `test:studio` covers the list, reopen, delete/Undo, cloud copies, media served from the cloud and the phone's copies freed; unit tests for the API. Piece 4 (tutorial, undo/redo, snapping) done: Nico "it works perfectly".

Piece 3 (GIFs) live with Nico's GIPHY key** (Cloudflare secret `GIPHY_KEY`, checked: trending and search answer, `test:studio` passes live with real GIFs). Nico: GIFs work. Fixed after his test: GIFs (and videos) now loop, gestures now as in his prototype (one finger = left/right/up/down, two fingers = back/forward + pinch + twist), Stickers back inside the tool bar. Then: with an object selected, every gesture moves it and the view stays still (view only moves with nothing selected); the sheets' × is centred (iOS button padding). Waiting for his re-test: GIF button → Add a GIF (trending, search, Powered by GIPHY) → Place sheet; GIFs loop silently, up to 4 per post.

Piece 2 (photos and videos) live; fixes from Nico's first test live, waiting for his re-test.** Media → the iPhone picker → Place Photo/Video: on a screen (offered by the picture's shape: Phone, Tablet / Flat TV, Laptop, Retro TV / Polaroid, plus Gallery frame and Chrome for any shape), floating, or on the marker. One video's sound at a time. Nico: picker, screens by shape and one sound work. Then fixed: AR glitch and drift (new speed-based One Euro anti-jitter), video on a flat marker vanishing (its paper border covered it; proven fixed by a render check from 60° to 12°). Nico: angle fine now; AR "a bit better, still some glitch and moves". Added frame lock (camera picture = the frame the pose came from), then, after Nico's screen recording, **gyroscope fusion** (option A, his choice): steadier, no lag on turns, holds through short blur losses. Preview has "Gyro on/off" and "Frame lock on/off" switches and a readout (fps · camera N · gyro). Nico: "best with both on by far", glitch gone, fast moves shift a little but acceptable. AR stability accepted for now. Max 2 videos, sound button, stored on the phone (IndexedDB). Upright markers now show exactly the editor's layout (no more auto-centring). Automated: `test:studio` covers import, the three placements, dragging on the marker, the 2-video limit, video playback and upright/flat in the preview.

Piece 1 (done, Nico: "everything is working"): (library sheet, selection, background, saving, adding, tap to select/deselect, overlaps, camera and AR all "work"). Fixed after it: two-finger lift instead of the Height button, Stickers sheet was empty (it kept the 3D Object style filter), the marker square now stands on the back wall. Then (Nico's choices): a bigger area (1 marker width around the centre, 1.5 high, faint cyan zone, springs back at the edge), "Deleted · Undo" instead of a confirmation, tilt left for after launch. AR measured on the iPhone: 56–60 fps with 6 objects. Nico: everything works. Then: selected objects get a teal outline around their shape + a small pop (the ring alone was too subtle). Waiting for Nico's look at the outline.
`/studio` (card on the home screen): grey grid room with the cyan workspace
(Figma E1r2), "+" → tools (3D Object, Text, Avatar, Stickers), "Place 3D
Object" sheet with Objects / Characters tabs and style chips (All +
Streetwear / Bubblegum Pop / Designers, an open list), 3D text in 5 styles
(≤ 12 characters), 6 emoji stickers, 0/6 counter and "Object Limit Reached",
Change Background (21 colours from E16r2), preview on the test marker (→).
Selection (Nico's rule): tap to select (teal outline + bar: Edit,
Duplicate, Delete), tap outside to let go, only the selected object moves
(one finger = left/right/up/down; two fingers = slide to push back or bring
forward, pinch size, twist), all other
touches move the camera (tutorial gestures, double-tap resets), repeat taps
cycle through overlapping objects. Scene saved on the phone on every change.
Library: 12 items + 6 stickers made in code from the look test, none
approved by Nico yet. Automated: `npm run test:studio` passes.

Step 2 pieces (agreed order, see decisions): 1. objects, text, stickers,
gestures, background, preview ← now; 2. photos and videos from the phone
(on a 3D screen / floating / flat on the marker, screen types); 3. GIPHY
GIFs; 4. the tutorial (3 welcome cards + coach marks) and polish (full undo/redo,
gentle snapping, object strip for small objects, premium chrome); 5. saving:
several drafts on the phone, then cloud saving (Cloudflare R2 + D1).

**Step 1 (AR test): done and confirmed on Nico's iPhone 13.**
The hand-made test scene (video on a 3D screen, fox, duck, photo, music)
appears on the printed marker in under a second, stays put, runs at 60 fps,
and video and sound play. Flat markers show the scene standing on them;
upright markers (screen, wall, T-shirt) show it standing upright in front
(option B, via the phone's motion sensor). Live at
https://inrl2.marine-469.workers.dev.

Project memory and direction set up in the repo (this file, `CLAUDE.md`,
`docs/`, `.claude/skills/`).

**Look test: passed (2026-10-05).** Art direction works on the iPhone 13 at
60 fps in IN3D and 40–60 fps in AR. Anti-jitter confirmed by Nico: "almost
no glitch, a tiny bit of delay, much better". Signed off: Designers
collage; Bubblegum character pass; chrome "good, not yet premium" (polish
during step 2). History of the rounds below.

Round 2 history:
Result: 60 fps in every world (75k triangles, 60 draw calls), phone stays
cool; chrome styles "good, not yet premium"; balloon letters feel inflated;
UX natural. Designers stickers looked cheap and letters/shadows glitched.
Round 2 (live): Designers redone as an illustrated **collage** after deck
slide 17 (each letter its own pattern: stripes, marquee bulbs, dots, mural
line, checker, halftone, windows; ink keyline; coloured thick edges; "O"
becomes a donut; bird perched on the first letter; dark background).
Glitch fixed: overlapping stickers were closer together than their
thickness and cut through each other; now on alternating layers. Shadows
steadier (2048 map, soft edge, normal offset).

Round 3 (live, after Nico: "still glitchy", "the O isn't good, leave
Designers as is", "Bubblegum lacks character"): Bubblegum gets per-letter
candy balloons that hop and squish, twinkling sparkles, a clay heart and a
clay cloud with googly eyes, blinking and a smile (deck slide 12), and a
pastel gradient backdrop in IN3D. Designers: the O is a normal letter again.
Possible glitch source fixed: in IN3D the shadow plane and the marker
picture were at the same height and flickered (z-fighting); the shadow
plane is now depth-offset (also helps `/3d`). If it still glitches, we need
a screen recording to see it.

Round 4 (live): Nico's screen recording showed the AR "glitch": on the Mac
screen, the scene flipped from upright to lying flat after a close/steep
look and stayed stuck. Fixed in `src/ar/placement.ts` (affects `/ar` too):
unreliable poses ignored, readings averaged, steadier switching, screens
leaning back count as vertical. IN3D glitch confirmed gone.

Round 5 (live): photo on the toy no longer upside down/mirrored (iOS gives
ImageBitmaps, which three.js can't flip; now copied to a canvas). AR still
jitters on the Mac screen, worse up close: likely the screen itself (refresh
flicker, pixel grid, glare; marker overflowing the view). Added a
**Steady tracking** switch in AR (MindAR's low-jitter filter settings) so
Nico can compare; printed-marker test pending.

Round 6 (live): Nico disliked Steady tracking (laggy) and the printed
marker still jittered (video: the scene jumps a few mm and swims against
the print each frame). Replaced Steady with an adaptive **anti-jitter**
filter on the marker pose (`src/ar/smoothing.ts`, on by default for `/ar`
and `/look`): small frame-to-frame wobble is eased out, real movement
followed within ~80 ms. "Anti-jitter on/off" chip in AR to compare.
Nico: "overall the experience is quite good".

Page `/look` Page `/look`
(card on the home screen): a word you type in the three worlds' 3D text
styles plus material samples, IN3D and AR on the test marker, frame-rate
readout and "Copy report".
- Streetwear: *Sharp chrome* (blackletter, bevelled) and *Liquid chrome* (inflated); chrome blob + glass crystal. Chrome has oil-slick rims; in AR it reflects the camera picture.
- Bubblegum: per-letter bouncing balloon letters, *Candy* or *Foil*; sparkles; clay heart and cloud characters with faces.
- Designers: collage letters (see above) + emoji cut-outs; blank toy that takes a photo from the camera roll.
- Automated: `npm run test:look` passes (marker tracked, every world drawn in AR). Desktop look checked; real frame rate only on the iPhone.

## Next

1. **Step 5: social layer (start here in the next chat):** feed (For You / Following) with INART and IN3D, other people's profiles, follows, likes, comments, notifications, Discover, the bottom bar. Plan it first (pieces, order, Figma A1, B1r2, C1–C31, G row). Step 4 (AI creation) moved to just before the beta (Nico, 2026-10-07).
1b. **App Clip** (after Nico's Apple Developer Program enrolment, which he is buying now): minimal App Store parent app + App Clip built from `ios/FloorTest` (ARKit under the web page), opened from Safari; carry the sign-in over (the floor test's link hand-over works). The free test install expires 2026-10-13 (reinstall: `ios/README.md`).
2. **Step 3 follow-ups**: personal markers at steep angles (see "Known risk" below), profile pictures, a shutter/photo button in INRL (Figma A2), the tutorial's "attach your post to a marker" tip, music row in New Post (with music).
   - Before the beta: compress videos on upload (Cloudflare Stream is an option); check current R2/D1 pricing; rate limits on sign-up/challenges (security review).
3. Still to re-check during step 2: AR placement on the Mac screen and printed flat; chrome "premium" ideas (richer studio, sharper bevel, dripping chrome); keep fps ≥ 50.
4. Later polish, not blocking: premium chrome (richer studio, dripping variant); matching motion blur on the 3D during fast moves; hide the Gyro / Frame lock switches before the beta.

1c. **Creator uploads + scene budget** (decided 2026-10-08, before the beta): anyone uploads a `.glb`; a budget bar replaces the 6-object limit for everyone. See decisions and roadmap. Layout proposed on a design canvas (https://claude.ai/artifact/SGzDX77vZLX1nmRBio2brH), waiting for Nico's review; single objects only (whole-scene import parked until after the MVP).

## Open questions for Nico

- **Dropping a scene in the world on iPhone** (2026-10-06): Nico wants the same experience as Android (feed → IN3D → like → **INRL** → scan a floor/table → drop), **with no iPhone app to install**, and is happy with a wrapper or App Clip. InRL stays a web app. Recommended: an **App Clip** that shows our web app (loaded from the site, so web updates need no Apple review) with ARKit doing surface detection and tracking; from Safari it opens through Apple's "Open" card, nothing installed. To check in the test: how it's triggered from a Safari page (banner vs. card), that the 3D stays locked to the floor, and that sign-in carries over (App Clip storage is separate from Safari's). Apple needs: a paid developer account ($99/year), a minimal parent app in the App Store (Apple may reject a plain website wrapper; the native AR helps), review for native changes. **Next: Nico installs Xcode and plugs in his iPhone; Claude builds a test version installed by cable (free account).** Gyroscope / Quick Look stay as fallbacks.
- **Swiping between scenes in the camera view** (confirmed wanted, 2026-10-06; vision's INRL carousel): swipe left/right at the bottom to drop the next/previous feed scene in the same spot without leaving the camera. Works on web (Android, marker AR) and in the App Clip (its screens are web); not in Quick Look. Plan: keep the anchor, preload neighbours, free the previous scene. On a marker, swiping goes through **the marker owner's other scenes** (Nico, 2026-10-06; see decisions).
- **Logo:** Nico will provide the InRL wordmark as SVG soon (app shows a text placeholder until then).
- **Reminder, only once the rest is done** (after the beta work): remind Nico about **whole-scene import** (creators upload a full Blender scene as one file; see the roadmap's "Later"). Don't raise it before then.
- **Display font licence** ("Demo Archimoto V01", profile names): Nico asked to be **reminded before the private beta (step 7)**. Not used in code yet.
- **GIPHY:** key in Cloudflare (2026-10-06). Before the beta: apply for a GIPHY production key (new keys are rate-limited).
- **Music button:** hidden in the editor for now (music is not in step 2); Figma shows it next to Background.
- **Cloud saving:** live with Nico's R2 bucket and D1 database (`inrl2-media`, bound in `wrangler.jsonc`); no token needed.


## Answered

- **3D artist: none available** (2026-10-05). Starter content comes from code (3D text, materials, screens, simple shapes), carefully restyled CC0 packs, and AI generation (step 4). See decisions.
- **Figma seat upgrade: not now.** Keep using the browser method (`figma` skill).
- **3D tooling** (2026-10-05): Nico shared a 3D-pipeline brief; agreed principles saved in the `3d-assets` skill (materials first, hybrid library, asset metadata, Blender headless for pre-made assets, no Fab/Unity store content).

## Session log

- **2026-10-08 (29)**: Step 6 planned ([step6-plan.md](product/step6-plan.md)), Nico answered. Built INRL on a surface: `pages/PostInrl.tsx` (+ css), `floor/gestures.ts`, FloorStage aim mark + pop, `components/PostStrip.tsx` and `social/posts.ts` shared with PostView, `scene/videoReady.ts`; native shell v2 (`ios/FloorTest`: whole web app, AR on demand, `open` links, back/forward swipe); `scripts/inrl-test.mjs`.

- **2026-10-08 (28)**: Discussion only (no code): other ways to make 3D posts. Decided: creator `.glb` uploads for everyone before the beta, a scene budget instead of 6 objects, Claude as scene director with step 4, a 3D marketplace later (decisions 2026-10-08).

- **2026-10-07 (27, overnight, Nico asleep)**: Step 3 built and shipped: passkey accounts (`worker/accounts.ts`, `passkey.ts`, `src/account/`), phones linked to accounts (`worker/db.ts` `whoIs`), posts and personal markers (`worker/publish.ts`), marker artwork / compile / QR (`src/marker/`, built by a helper agent, then reworked: patchwork base after a 45° fake-camera benchmark), pages Welcome, NewPost, Profile, MarkerView (/m/:code, /scan), Home entry points; `MarkerTracker.openCamera()` + `track()`; tests `test:publish` + unit tests. Figma step-3 frames rendered to `.cache/figma/` (description `.cache/figma/step3-screens.md`; new frame IDs added to `docs/design/screens.md`).

- **2026-10-06 (26)**: iPhone floor test. Fixes after Nico's tries: every ARKit frame now reaches the page (was 31/s), camera pose for portrait (`viewMatrix(for: .portrait)`; the landscape transform made the scene slide and lean), link kept during app start-up + clipboard fallback ("Use my scenes"), hand-over link on My scenes, shared `sceneName()`, video state in Copy report + a video watchdog (reloads one of our videos stuck for 3 s; never needed after the server fix). **Server fix** (`worker/cloud.ts`): every request awaited one shared table-setup promise, and in Workers a request awaiting I/O started by a cancelled request hangs forever (video players cancel range requests constantly): videos stuck at "nothing loaded", even 404s hung. Media are now served before and without the database; only "setup done" is shared. The tessier.n@gmail.com free team hit Apple's device limit; new free Apple ID nico@wearenot.co (team RA4U4TWPVZ). Xcode used via `DEVELOPER_DIR` (xcode-select still points at the Command Line Tools); iOS platform downloaded. Started: Native test app `ios/FloorTest` (ARKit floor finding + tracking, transparent web view; XcodeGen project, free team) and web page `/floor` (`src/floor/`: bridge + FloorStage; aim ring, tap to drop, drag/pinch/twist, swipe strip through saved scenes, readout with bridge delay, Copy report). Safari `/floor` hands the phone key to the app. Remote Control on.

- **2026-10-06 (25)**: With Nico: full INRL vision clarified (feed → IN3D → INRL → drop on a surface, same on iPhone without an app → App Clip plan; swipe between scenes in the camera, on a marker = owner's other scenes; founding idea of GPS-pinned scenes, private/tagged vs public/time-limited, recorded for later). Freed Mac space for Xcode (Android SDK/emulators, installers, Chrome cache): 39 GB free. Next chat: the iPhone floor-placement test.

- **2026-10-06 (24)**: Nico tested piece 5 on the iPhone: everything works. No renaming of scenes for now. Step 2 closed.

- **2026-10-06 (23)**: Piece 5: My scenes (`src/studio/scenes.ts`, `pages/MyScenes.tsx`, routes `/studio`, `/studio/edit/:id`, `/studio/preview/:id`), `EditorStage.snapshot()`, cloud saving (`worker/cloud.ts` + `src/studio/cloud.ts`, R2 + D1 bound in `wrangler.jsonc`, dev stand-ins `worker/devCloud.ts` with sql.js), media freed from the phone after upload. Remote Control on.

- **2026-10-06 (22)**: Piece 5 planned (My scenes + cloud saving). Nico created R2 `inrl2-media` and D1 `inrl2-media` (ID d1a438da-765e-4d7e-b209-562299bc8a28). Chat closed here because of length; the next chat starts piece 5.

- **2026-10-06 (21)**: Nico: piece 4 works perfectly. Fixed the tips' skip line overlapping the workspace bubble on short screens.

- **2026-10-06 (20)**: Piece 4: `StudioTutorial` (cards + tips, `src/studio/tutorial.ts` flag), undo/redo history in `Studio.tsx`, snapping (`snapTo`/`snapAngle`/`snapPosition` in gestures.ts) with guide lines.

- **2026-10-06 (19)**: Reports after gravity lock: up/down 0, left/right 2.8° far. Wall direction hold in `PoseFusion` (2 s average, follows lasting >10° turns).

- **2026-10-06 (18)**: Nico's two reports → head-on tilt ambiguity (14° far, 1.5° near). Gravity lock in `PoseFusion` (wall/table with hysteresis), report shows lock + up/down vs left/right tilt.

- **2026-10-06 (17)**: HD recording measured: no gain, big fps cost → HD off by default. `src/ar/report.ts` (PoseStats) + preview Copy report.

- **2026-10-06 (16)**: Poster recording measured (slip uncorrelated with motion, ~6 % std). HD camera request (`hd` option), resolution in the readout, `__poseLog` test hook, `?sd`. Fake-camera wobble: SD tilt 0.65° vs HD 0.29°.

- **2026-10-06 (15)**: Piece 3b: motions (`src/studio/motions.ts`, `motion` in the scene format, motion group in every object, Motion sheet); library idle movements → default motions; rebuilds keep the selection. Poster steadiness: room-frame turn cut-off 0.3 Hz.

- **2026-10-06 (14)**: Nico: GIF loop OK, gestures OK. Selected object now takes every gesture (view locked), view momentum stopped, × centred.

- **2026-10-06 (13)**: GIF loop fix (schema defaults on new objects), prototype-style gestures, tool bar fit.

- **2026-10-06 (12)**: Piece 3: GIF search via the worker (`worker/giphy.ts`, `/api/giphy`, dev stand-in in `vite.config.ts`), GIF sheet, `gif` + `aspect` in the scene format, tests.

- **2026-10-06 (11)**: Nico accepted AR stability with gyro + frame lock. Next: piece 3 (GIFs).

- **2026-10-06 (10)**: Analysed Nico's screen recording (frames, ffmpeg + OpenCV in `.cache/venv`): camera 48–58 fps, blur losses on fast moves, small slips. Built gyroscope fusion (`src/ar/fusion.ts`, `GravitySensor` keeps orientation history) with tests; Gyro switch in the preview; stacked prints on the marker no longer flicker.

- **2026-10-06 (9)**: Frame lock in MarkerTracker (copies each frame MindAR reads, shows it when its pose lands), camera fps readout, still-phone smoothing 0.9 Hz.

- **2026-10-06 (8)**: Nico: AR still glitchy + drift; video on flat marker still vanishes. Measured the filters offline (drift came from the last tweak), replaced anti-jitter with a One Euro filter; found the real vanishing cause (paper border depth offset) with a render probe, now in `test:studio`.

- **2026-10-06 (7)**: Nico's piece-2 test: picker double choice, screen shapes, naming, two sounds, AR shaking, video vanishing on flat marker at 45°. All addressed (see decisions).

- **2026-10-06 (6)**: Nico approved the teal outline. Built piece 2: photos and videos (`src/studio/media.ts`, `screens.ts`, `placeMedia.ts`), scene format `display` + `screen`, upright placement = editor layout, media on the marker laid onto flat prints, preview plays videos with a sound button.

- **2026-10-06 (5)**: Bigger area and Undo confirmed by Nico. Added the selection outline (`src/studio/outline.ts`) and pop.

- **2026-10-06 (4)**: Discussed rotation on 3 axes (tilt: after launch), delete confirmation (undo instead) and the area size with Nico; built the bigger area (rubber-band edges, wider shadows in editor and AR) and "Deleted · Undo".

- **2026-10-06 (3)**: Nico's iPhone test of piece 1: all working. Changed: two-finger lift (Height button removed), Stickers filter bug fixed, marker square on the back wall. Library: keep all, grow it.

- **2026-10-06 (2)**: Step 2 started. Read the Figma editor and tutorial screens (Figma API limit hit; rendered the frames in headless Chrome instead, see `figma` skill). Built InStudio piece 1 (`src/studio/`, `/studio`, `/studio/preview`), library from `src/look/`, scene format `text` + `item`, thumbnails (`npm run thumbs`), `test:studio`. Applied Nico's selected/unselected rule (relayed by the look-test session). Remote Control on.

- **2026-10-06**: Avatars (Ready Player Me alternative) parked by Nico; recommendation on record: blank designer toy now, AI selfie-to-toy in step 4, open-source VRM builder only if realistic avatars prove essential. Clarified: the three worlds are examples, not limits.
- **2026-10-05 (8)**: Nico confirmed anti-jitter ("much better"); look test closed; next is step 2.
- **2026-10-05 (7)**: Printed-marker video analysed frame by frame (pose jitter, not screen). Adaptive anti-jitter filter added to MarkerTracker; Steady option removed.
- **2026-10-05 (6)**: Fixed upside-down user photos; added Steady tracking switch (MarkerTracker `smoothing: 'steady'`).
- **2026-10-05 (5)**: Analysed Nico's screen recording (frames via ffmpeg in `.cache/venv`); fixed placement flipping; unit tests for placement; corrected the AR smoke test's simulated phone angle (it claimed "upright phone" while showing a table from 45° above).
- **2026-10-05 (4)**: Bubblegum character pass (bouncy letters, sparkles, faces, gradient backdrop); O back to a letter in Designers; shadow-plane z-fighting fix.
- **2026-10-05 (3)**: Nico's iPhone report on the look test (60 fps, chrome good, balloon good, Designers cheap, glitches). Redid Designers as a collage, fixed sticker interpenetration, sealed/filled sticker outlines, steadier shadows.
- **2026-10-05 (2)**: Remote Control on. Reviewed Nico's 3D-pipeline brief (notes in `3d-assets` skill). Built the look test (`/look`, `src/look/`): chrome / liquid chrome / balloon / sticker 3D text, chrome, glass, clay and blank-toy samples, studio and camera reflections, fps readout, `test:look`. Fonts: UnifrakturCook, Titan One, Bungee (OFL); Noto emoji (Apache 2.0).
- **2026-10-05**: Reviewed Figma (REVISED) and the old MindAR repo; chose WebAR, a fresh repo, editor-first after an AR test. Built step 1 (foundations, scene format, marker tracking, AR/IN3D/marker pages, automated AR test). Set up Cloudflare (new account, Workers + static assets, media range fix). iPhone test passed. Added flat vs upright placement. Reviewed the art-direction deck. Wrote project memory docs and skills.
