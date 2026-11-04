# Decisions

Newest first. Each entry: what was decided, and why. Don't reopen a decision
unless Nico raises it; if new facts change one, add a new entry rather than
editing the old one.

### 2026-10-09: One AR view in the app (surfaces + markers)
Nico: "we need one single AR view where we can see posts on flat surfaces but also scan QR codes"; all recommendations accepted:
- **A marker wins over the table**: seen in the camera, its post appears on the marker, the table scene goes (one scene at a time), the strip switches to the marker owner's posts; ☰ "Place on a surface instead" goes back.
- **The feed's Scan button** (in the app) opens this same view, the feed's posts in the strip for surfaces.
- **INRL from a post** opens it with that post ready for a surface; a marker still takes over.
- Built natively: Vision reads QR codes, ARKit image tracking follows the marker's artwork (no second camera, steadier than the web tracker). Safari keeps the web scanner.

### 2026-10-09: INRL in the test app, after Nico's first test
- **Surface picking: nearest surface wins**, the aim sits at 60 % of the screen height (Figma A4), the mark glides; after 6 s without a surface the hint gives tips (tilt down, step back, light). **Why:** Nico found the table hard to pick; the floor plane under the table was taken first.
- **One product feeling: from Safari, ← goes back to Safari** on the same post (IN3D), the app rests on that post. **Why:** Nico felt stuck in "the clip app", like two products. Note: each Safari → app hop shows iOS's "Open in InRL Floor?" prompt; universal links (with the paid Apple membership) remove it, and in the future App Store app the whole experience lives in one app anyway.

### 2026-10-08: Step 6 (INRL without a marker) product answers
Nico, on the [step 6 plan](step6-plan.md):
- **Apple Developer Program: not bought yet.** **Keep using the free test app** (`ios/FloorTest`, reinstalled by cable every 7 days) until Nico is 100 % sure to launch the beta; the App Clip and the App Store "InRL" app (same full web app with native INRL, Nico's logo as icon, the App Clip card says "InRL") wait for that.
- **iPhone first, Android after**: finish INRL on iOS (in the test app), then buy an Android phone and do Android (WebXR).
- **The strip in INRL** goes through the same posts as the post you came from (feed, profile, Discover); swiping drops the next scene in the same spot, at the size you set.
- **INRL screen = Figma A4 / A41 strictly**: ←, IN3D | INRL, author, caption, strip, sound button when there is a video. No likes / comments in the camera view; a shutter later.
- **INRL from a post always means a surface** (a table, the floor or any horizontal surface), also for marker posts. Scanning a marker (QR or Scan) is unchanged.

### 2026-10-08: Creator uploads (.glb), a scene budget instead of 6 objects, Claude as scene director
Nico, after discussing other ways to make 3D posts (Claude + Blender, image-blaster, Google Labs Playground):
- **Anyone can upload their own 3D object** (`.glb`, made in Blender or anywhere), **before the private beta**. InRL checks and compresses it (file size, triangles, texture memory), shows why a file is too heavy, asks "I made this or have the rights", and Report covers abuse. **Why:** it brings 3D creators in, with richer effects and animations than our library; the scene format already takes any `.glb`. Blender-only effects (particles, simulations, node setups) must be baked into animation by the creator (short guide for creators). Likely flow: upload from a computer browser into "My objects", place it on the phone.
- **A scene budget replaces the 6-object limit, for everyone**: one bar that fills as you add things, combining download size, triangles and texture memory (starting guess ~15 MB and ~150k triangles per scene, tuned on Nico's iPhone 13), with a high hidden cap (~20 objects) so finger selection stays easy. Supersedes the "6 objects" rule and the 0/6 counter / "Object Limit Reached" (Figma) once built.
- **Claude as scene director** (later, with step 4): type a description, Claude writes the scene recipe (picks library objects, places them, picks text styles), you land in the studio to adjust. Cost estimate: ~$0.002 per scene with Haiku 5.5, ~$0.02 with Sonnet 5.5 (2026-10 prices); start with Haiku, per-person monthly limit anyway.
- **Whole-scene import parked until after the MVP** (Nico, same day): creators building a full scene in Blender and importing it as one file is the right main path for creators later (with an InRL Blender starter file holding the marker square, InRL things like video, photos, text and music added on top in InStudio, and an option to split it into parts). For the MVP, uploads are single objects only.
- **Layout proposed for uploads and the space bar**: design canvas https://claude.ai/artifact/SGzDX77vZLX1nmRBio2brH (editor bar, "Scene space" sheet, "Not enough space", + › 3D Object › My uploads, checking, ready, too heavy, computer upload page). Waiting for Nico's review.
- **Future: a 3D object marketplace** (Nico's idea): creators' uploads usable by others, maybe sold. Not planned yet.
- Further out (realistic, not planned): photo → objects + sounds (image-blaster style, via fal.ai Hunyuan 3D, as step 4 plans), photo-real mini-worlds (Gaussian splats) once phones handle them, interactive posts (mini-games on a marker, Playground-like; big safety/performance change).

### 2026-10-08: Step 6 next (before step 4)
Nico: after the social layer, step 6 (viewing modes: INRL without a marker) comes next, in a new chat; AI creation (step 4) stays before the beta.

### 2026-10-08: Report and block (piece 8), choices made overnight
- **Block is two-way and silent**: neither sees the other's posts, comments, likes, follows or search results; existing follows end both ways; the blocked person isn't told and gets "not found" on the blocker's profile and posts; the blocker sees only the name, to unblock. Scanning someone's printed marker still works (the physical world isn't filtered).
- **Report**: post, comment or person; six reasons (spam, nudity, hate/bullying/harassment, violence/danger, "uses my work, brand or likeness", other) + an optional note; 30 a day per person. Reporters stay anonymous.
- **Reports go to Nico** in the app (`/admin`, profile ☰ → "Reports (InRL team)"): admins are user names in the worker variable `ADMINS` (wrangler.jsonc, currently `nico`; not a secret). Actions: remove the post / comment, hide the person from everyone else (like a test account), or dismiss. No e-mail alerts yet (needs an e-mail service, as for password resets).

### 2026-10-08: Discover (piece 7), choices made overnight
Following G3: popular lately = Featured first, then (likes × 3 + comments × 4 + views), halved after a week, quartered after three; the first card big. Search: people (user name starts with, or name contains; most followed first) and scenes (caption contains); hashtags and tags later. No "recent searches" yet.

### 2026-10-08: Comments (piece 5), choices made overnight
Following C12 and decision 3: oldest first (a conversation reads down to the input); 300 characters, line breaks kept; Enter sends (Shift-Enter: new line); at most 8 comments per person per minute. "Hide" (post's author) keeps the comment for its writer and the author (dimmed, "Hidden" tag, Unhide), removes it for everyone else and from the post's count. The post's author can also Delete any comment. Comment likes have no notifications (yet). Mentions (@name) don't notify (yet).

### 2026-10-08: Likes and notifications together; double tap = like
Nico agreed (two real people now: his girlfriend joined): likes and notifications ship as one piece, before comments.
- **Double tap on a post's scene likes it** (a heart pops where you tapped; it never unlikes, like Instagram). The heart on the right likes / unlikes. Signed out: sign in first. **"Reset view"** (top, under the switch) appears once the scene has been turned / zoomed / moved, replacing double tap = reset.
- **Ranking**: each like moves a post up For You by 2 hours of age, up to 24 likes (2 days); Featured still first.
- **Notifications**: likes on your posts (yours not counted) grouped per post and day, showing up to 3 names then "and N others"; new followers with Follow Back / Followed (Figma's label); last 60 days, newest 100. Test accounts only show to test accounts. The bell's dot = anything newer than your last visit to Notifications. No phone alerts (decision 4).

### 2026-10-08: Profiles and follows (piece 3), choices made overnight
Built after Nico's go (he slept), following G2 / G21 / B1r2 / Posts 01 and the step 5 answers; easy to change:
- **One profile page for everyone**: `/u/<username>` (shareable), `/me` = yours. Others: **Follow / Unfollow** + a share-profile icon button (Figma's outline add-person button; **no Message**, decision 6). You: **Edit Profile, Share Profile**, ☰.
- **Stats**: followers, following, views (all your posts' views added up). Tapping the counts does nothing yet (follower lists later if wanted).
- **Objects grid**: the post on your marker is the big pinned card (pin icon), the others two by two, all 4:5. **Your posts' "•••"**: "Show it on my marker" and "Delete post" (second tap "Delete it for good"); the old trash button is gone.
- **Others' Marker tab**: their marker artwork, avatar, name, "Scan … with your camera", "See it in real life" (their marker page).
- **Following someone from a post**: the small teal "+" on the author's picture (G1); it disappears once you follow.
- **Profile picture**: chosen from the phone, placed in a circle (drag, pinch or slider), saved as a 400 × 400 JPEG (≤ 400 KB) in R2 (`avatars/`), replaced files deleted; "Remove" goes back to the letter. **Bio**: 150 characters, line breaks kept (at most one empty line).

### 2026-10-07: One picture shape (4:5), no marker in IN3D, a thumbnail strip in posts
After Nico's test of the new flow (his framing changed on New Post and again in the feed; a marker under the scene in IN3D; swiping felt worse than the old strip):
- **Post pictures are 4:5 portrait everywhere** (Frame your shot, New Post, feed cards, profile grid), shown whole, never cropped. Claude's recommendation over Figma A1's near-square cards: most scenes are upright, 4:5 is Instagram's post shape. Posts made before keep their 3:4 picture (slightly cropped in cards).
- **No marker in IN3D, anywhere** (posts and the marker page): the scene on its own soft gradient with a shadow, framed on its objects, like its picture. The marker only belongs in INRL.
- **The post keeps its framed camera** (`scene.view`): IN3D opens on exactly the view you framed, so the picture → 3D fade is seamless. Switching posts keeps the old scene until the new one (videos included) is ready, then cross-fades: no black flash. The strip is a snapping carousel (scrolls with momentum, the middle thumbnail is the post). Landing after posting shows your posts in the strip (Nico's recording, 2026-10-07).
- **Inside a post: a strip of round thumbnails at the bottom** (Figma C3 / A2 / A4) for the posts around it (from the feed or profile); swipe the strip or tap one. **The 3D gets every gesture back** (one finger turns in any direction, pinch zooms, two fingers move, double-tap resets). Author, counts and caption above the strip; **no bottom bar inside a post** (← goes back). Supersedes the swipe up/down + two-finger tilt of earlier today. The same strip will serve INRL without a marker (step 6, A4).

### 2026-10-07: Publishing flow redone; posts open in IN3D (no INART page)
After Nico tried posting ("the flow feels really weird"):
- **→ opens "Frame your shot"**: the scene without grid or workspace, auto-framed by InRL; Nico's people can turn / zoom to adjust, Reset, Next. The post picture is exactly that view (3:4).
- **New Post**: picture, caption, one switch **"Show on my marker"** with a line of explanation, one **Post** button. The switch starts **on for the first post** (the marker has nothing yet) and **off after that** (printed markers don't change by accident).
- **"Published" stays ~2.5 s** (or until tapped), then **lands on the new post full screen in IN3D** (with Share).
- **No full-screen INART page.** The feed and profile grids are INART; opening a post goes **straight to IN3D**, the switch offers **IN3D | INRL** only (also on the marker page). The post's picture shows at once and the 3D fades in over it.
- **Gestures in a post**: swipe up / down = next / previous post; one finger left / right = turn around; pinch = zoom; **two fingers up / down = tilt** (rarely needed, but there); double-tap = reset. Only the post on screen is 3D; its neighbours are prepared.
- **"Edit your Marker" renamed "Choose the post it shows"** (the artwork itself isn't editable; ☰ → New marker design redraws it), with a line explaining the marker.
- Figma C1 / G1 / G4's info layout (author, counts, caption bottom-left; actions right) is kept, over the 3D.

### 2026-10-07: Nico's first feed test: Create, My scenes, clean post pictures
Nico's iPhone test of pieces 1–2: feed, viewer, swipes, IN3D, INRL, Share and the bar all work.
- **Create (centre of the bar) opens a new scene straight in the editor**, not My scenes; its × returns to where Create was tapped, and an untouched new scene is not kept. **My scenes lives in the profile** (Objects tab, "My scenes" row; also ☰); opening a scene there edits it in InStudio.
- **Post pictures have no grid room or cyan workspace** (those are for the editor only): the scene on a soft gradient of its colour, framed on its objects. Posts made before this keep their old picture (post again for a clean one).
- **INRL from a post should later work without the marker**: drop the scene on a surface and swipe between posts, as in the iPhone test app (App Clip). That is step 6 (viewing modes); until then INRL opens the author's marker.
- Views: one per person per day is working as designed (Nico saw his own repeat visits not counted).
- **The InRL wordmark** is Nico's SVG export (`public/brand/inrl-wordmark.svg`, drawn by `components/Logo.tsx`), on the feed and the sign-in screens.

### 2026-10-07: Step 5 (social) product answers
Nico took every recommendation in [step5-plan.md](step5-plan.md):
1. **For You** = every post from everyone, newest first, posts with recent likes nudged up; the team can mark posts **Featured** to keep them near the top.
2. **Everything public**: posts and profiles can be seen without an account (like Instagram); liking, commenting and following need one. Private accounts later.
3. **Comments in v1** (C12): add, like, delete your own; the post's author can hide comments; "Reply" starts the comment with @name (no threads).
4. **Notifications in v1, in-app only** (G5 list + a dot on the bell). No phone alerts yet (iPhone web push needs the app on the Home Screen).
5. **Bottom bar centre = Create** (opens InStudio); Scan stays at the top right of the feed (A1).
6. **No "Message" button** for now (private messages are a feature of their own).
7. **Profile pictures and bios now**, in Edit Profile (photo cropped to a circle, short bio). Supersedes "profile pictures: not yet".
8. **Views** = opening a post or scanning the marker, once per person per day, shown publicly (eye number).
9. **Pinned post** = the post attached to your marker, shown as the big first card on the profile.
10. **Report and block** are built in this step (last piece), before outside testers; reports go to Nico.
11. **Test accounts are hidden** from the feed and Discover (including @tmuxbfper and every account the automated tests create).

### 2026-10-07: Step 5 before step 4
Nico: the social layer (feed, profiles, follows, likes, comments) comes
next; AI 3D creation waits until just before the private beta. **Why:**
AI creation only adds a new kind of object (nothing to undo later), and
it needs a paid provider. Also: no Ready Player Me clone (only its game
plug-ins were open source; the creator and parts library were closed and
shut down); characters come from AI and the blank toy.

### 2026-10-07: Nico's step 3 test and answers
Nico tested on the iPhone: everything works, AR is stable, the QR code opens
the app from the normal camera, Face ID sign-in "was easy". IN3D gestures
don't feel right yet (to fix).
- **QR codes always point to the web app**: every marker's QR is a link into InRL (`/m/<code>`); once in the app, the marker code decides which content shows. Keep it that way for all future markers (merch, posters…).
- **Sign-in, target set** (with InRL's own domain, chosen before the beta): **email + password, Face ID (passkeys), Google, Apple**. Passkeys only for now; the others need the domain and keys (Google client ID, Apple Services ID after enrolment, an email-sending service for password resets).
- **Marker artwork: people never make their own.** Keep the generated artwork for now (if it keeps tracking well); a better-looking design comes later.

### 2026-10-07: Step 3 built overnight: provisional choices (to confirm with Nico)
Made by Claude while Nico slept (he asked for recommended options, easy to
change, listed in STATUS.md "Decisions to confirm"):
- **Sign-in = passkeys** (Face ID, iCloud Keychain): no password, no email, no outside service or key. Figma F1's Google / Apple / email + code + password screens are replaced by "Create my account" / "I already have an account"; F25 (Set up Your Profile: full name, user name) and F26 (Hello) kept. Profile pictures later. **Why:** works tonight with no accounts or keys, more secure than passwords, one tap on iPhone. Google / Apple / email can be added beside it (each needs a key Nico sets up). Passkeys belong to the web address: **choose the final domain before the beta**.
- **The phone joins the account**: signing in links the phone's existing private key to the account and moves the phone's scenes into it; cloud saving is unchanged and the floor test app (which has the phone key) sees the account. Signing out forgets the phone's scenes (they're in the account) and makes a new key.
- **One marker per account, artwork generated by InRL** from a seed: a sticker-bomb collage in the design-system palette with the QR code (link `/m/<code>`, 7-character code) on a white card with "@username" and an "InRL" tag. The tracking file is computed on the phone (~a few seconds) and must have ≥ 250 matching points (a bad design is redrawn automatically). "New marker design" (☰ menu) keeps the link but changes the art, so printed copies stop tracking (warned).
- **A post is a copy of the scene** when published (later edits don't change it; publishing again makes a new post). The marker shows the post attached to it (New Post's "Attach to Your Marker", on by default, or Edit your Marker), else the newest post. Media used by any post are never cleaned up.
- **The editor's → opens New Post** (as Figma's tutorial says "press the arrow to submit"); the test-marker preview moved to a "Try it on the test marker first" link there.
- **Scanning**: the QR link opens `/m/<code>` (INRL first with an "Open camera" sheet; INART and IN3D in the top switch); the in-app **Scan a marker** button (Home) reads the QR inside the artwork and then tracks that marker in the same camera session. Swipe the round thumbnails at the bottom through the owner's posts.
- **Home** gets Scan / InStudio / Sign in (or @you) at the top; the test pages stay below. The bottom bar (feed, search, notifications) waits for step 5.

### 2026-10-06: Saving plan (piece 5): R2 for media, D1 for scenes, no API token
Photos/videos go to an R2 bucket and scene descriptions (a few KB each)
to a D1 database, both in the INRL2 account, through our worker. Nico
created them himself in the dashboard (R2 `inrl2-media`, D1 `inrl2-media`,
ID d1a438da-765e-4d7e-b209-562299bc8a28) instead of handing over an API
token; the worker creates its tables on first use. Until accounts
(step 3), cloud scenes belong to the phone (a private random key) and move
into the account later. **Why:** cheapest sound base for a video-heavy
app (R2 has no download fees; D1 holds over a million scenes), and no key
leaves Nico's account. Before the beta: compress videos on upload.

### 2026-10-06: Piece 4: tutorial, undo/redo, gentle snapping
- **Tutorial** (Figma tutorial-0001…0008), automatic the first time InStudio opens, again from a **?** button next to Background. Four cards (Welcome with library art; two "Navigating InStudio" cards with drawn gestures; a new "Moving Objects" card for Nico's gestures), Continue / Skip, "Let's Go!" / "Start Over"; then six tips on a dark veil with a black bubble and a glowing ring on the control: workspace (6 objects, the square is your marker), the + button, Background, undo/redo, the → arrow, the ? button. Tap anywhere to continue, "Skip tips". The music tip is left out (no music in step 2).
- **Undo / redo** for every change (gestures, adds, deletes, edits, motions, background), up to 50 steps, buttons bottom right; "Deleted · Undo" now uses it.
- **Gentle snapping**: objects click onto the marker's centre line (x = 0, z = 0) and the floor within 2.5 % of a marker width, prints onto the marker's centre, turns onto 15° steps within 4°; faint cyan guide lines show while snapped.
**Why:** roadmap step 2 (tutorial) and the polish agreed for piece 4; tutorial automatic + "?" was Nico's choice.

### 2026-10-06: Poster stability confirmed on the iPhone
Nico: "so much better!!!" On-phone reports at the wall poster, shown tilt
wobble: from a step away (marker ~241 px) **0.53°** (it was 14° before the
gravity lock, 2.8° before the direction hold); one step closer 0.27°.
Up/down 0.00° in both. The AR stack stays as is: frame lock + gyroscope
fusion + gravity lock + wall direction hold, all on by default. The
preview's switches and Copy report stay until the beta (then hidden).

### 2026-10-06: Wall direction hold
Nico's next reports: up/down solved (0.00° shown); left/right still
3.5° raw → 2.8° shown from a step away (0.9° close). A poster doesn't turn
on its wall, so when locked to a wall its left/right direction is
averaged over ~2 s (0.08 Hz); a change of more than 10° that lasts over
0.5 s is real (a T-shirt wearer turning) and is followed quickly.
Simulated: ±3.5° wobble → ~1°; a real 30° turn followed.

### 2026-10-06: Gravity lock: posters face the room, table prints face up
Nico's reports from the wall poster: from a step away (marker ~284 px in
the camera) the tracker's tilt swung by **14°**; one step closer (~563 px)
1.5°. Seen small and head-on, a flat print looks almost the same tilted a
bit either way: its outline still lands right (prints on it look fine)
but objects standing out swing. With the gyroscope we know where "down"
is, so once the marker is clearly on a wall or a table (its slowly
averaged facing direction within 25° of it; free again beyond 35°), its
facing direction is locked level (wall) or straight up (table); the
tracker still gives where it is and how it is turned on the wall/table.
Simulated: a ±14° up/down swing on a wall → under 0.5°. Markers on a
slope (e.g. 45°) are left alone; a poster leaning on an easel by less
than 25° is shown as if it hung straight. The report now splits tilt into
up/down and left/right and shows the lock.

### 2026-10-06: HD camera back off; the phone measures its own steadiness
Nico's HD recording: the iPhone gave 720×1280, but tracking fell to
29 fps, and 12–13 fps up close, and the 3D still wandered ~6 % of the
marker width (measured the same way): no gain on the real camera, a big
cost. HD is now off by default (`hd: true` to try again). The fake camera
can't reproduce the real one, so the preview gets **Copy report**: ten
seconds of on-phone numbers (raw tracker wobble in the room frame, wobble
after smoothing, readings/s, losses, marker size in camera pixels,
placement switches) to find which part causes the poster glitch.

### 2026-10-06: HD camera for tracking
Nico's poster recording, measured frame by frame (OpenCV): the 3D wanders
around the poster by ~6 % of the marker's width (std), slowly and
unrelated to how the phone moves: not lag, the tracker's own imprecision
(head-on view, marker filling part of the picture). The camera was opened
at Safari's default size (640 × 480). Now we ask for HD (1280 × 720).
Measured with a fake camera, the tracker's fast wobble halves (tilt 0.65°
→ 0.29°, sideways ÷3, depth ÷2). The preview readout shows the size the
iPhone actually gives; `?sd` in the address uses the old default (tests).
Watch the "camera N" rate on the phone (more pixels to process).

### 2026-10-06: Object motions (piece 3b)
A **Motion** button on the selected object opens a sheet with seven
motions, the same for every style: None, Spin, Float, Bounce, Pulse,
Sway, Orbit (one per object, a calm speed each, tiny animated previews).
Saved with the scene (`motion`), so it plays the same in the editor, in
AR and later in the feed. Library items' built-in movements became their
default motion (chrome blob/crystal/ring spin, hearts and star sway,
cloud buddy floats), which people can change or turn off; faces still
blink. Prints on the marker spin flat and hop off the print. Each object
starts at its own point of the loop. **Why:** Nico: let people animate
objects a bit; same motions for every style (feel per style later).

### 2026-10-06: Steadier upright posters: smooth the marker's own tilt hard
Nico: small glitches on a printed poster on the wall. Likely cause: seen
head-on, the tracker is worst at telling the print's tilt, and objects
standing out from the wall swing with it. With gyroscope fusion the
smoothed pose is the marker's place in the room, which only turns if the
marker itself turns, so its turning is now smoothed with a 0.3 Hz cut-off
(0.9 before) without lag when the phone moves; a turning T-shirt is still
followed (the filter speeds up with real movement). Simulated: ±2° tilt
wobble → under 0.4°. To be confirmed on the wall poster.

### 2026-10-06: Selected object takes every gesture; the view only moves when nothing is selected
While an object is selected, every finger gesture anywhere on the screen
moves, sizes or turns that object, and the view stays still (its leftover
glide is stopped too). With nothing selected, fingers move the view. Taps
still select another object (repeat taps cycle through overlaps) or let go
on empty space; double tap resets the view only with nothing selected.
**Why:** Nico: environment control must be off while an object is
selected. Bonus: small objects are easy to pinch and twist.

### 2026-10-06: Moving objects like Nico's prototype
Supersedes the "one finger = floor, two fingers = lift" gestures. On the
selected object: **one finger moves it left/right and up/down** (in the
upright plane through it, facing you); **two fingers slide up to push it
back, down to bring it forward**; pinch = size, twist = turn (unchanged).
Media on the marker: one finger moves on the square, two fingers pinch and
twist (no depth). **Why:** Nico remembered his earlier prototype worked
this way and it felt right.

Also: new objects now get the scene format's defaults when created (GIFs
and videos did not loop until the scene was reloaded), and the tool bar's
six buttons share its width (Stickers fell outside).

### 2026-10-06: GIFs from GIPHY (piece 3)
- A **GIF** button in the tools (YouTube's slot; YouTube is later) opens **Add a GIF**: trending first, search box, masonry of animated previews, "Powered by GIPHY". Picking one opens the same Place sheet as photos/videos (screens by shape, floating, on the marker).
- In 3D a GIF is GIPHY's **MP4** (decision 2026-10-05), stored as a video with `gif: true`: loops, silent (no sound switch), **up to 4 per post**, counted apart from the 2 phone videos.
- The **GIPHY key stays on Cloudflare** (secret `GIPHY_KEY`); the worker's `/api/giphy` asks GIPHY and returns only what the editor needs. Content rating **pg**. Without a key the sheet says GIF search isn't set up.
- GIPHY's new keys are rate-limited (beta) until GIPHY approves a production key: apply before the beta.
**Why:** roadmap step 2; the key must never reach phones or the repo (CLAUDE.md rule).

### 2026-10-06: AR stability accepted: gyro + frame lock both on
Nico's iPhone test: "best with both on by far", the glitch is gone; fast
moves still shift the scene a little ("otherwise acceptable"). On fast
moves the camera picture blurs while the 3D stays sharp: normal for phone
AR (Safari can't shorten the camera's exposure); matching motion blur on
the 3D is possible later but costs frame rate. Both stay on by default;
the comparison switches stay in the preview until the beta. Option C (a
commercial tracker) is not needed for now.

### 2026-10-06: Gyroscope fusion for AR (option A)
Nico's screen recording (frame lock on, 48–58 camera fps) showed two
remaining problems: motion blur on fast moves (the tracker loses the
marker; no filter can help) and small slips while moving. Options were A
gyroscope fusion, B leave it, C a commercial tracker; Nico chose A.
How it works (`src/ar/fusion.ts`): each tracker reading is turned into
"where the marker is in the room" with the phone's orientation at the
moment the frame was read (motion sensor, `deviceorientation`, kept as a
1-second history); that room pose is smoothed (the One Euro filter, now
with nothing to lag behind when the phone turns); each drawn frame turns
it back with the phone's orientation for the picture on screen. When the
tracker loses the marker, the scene holds on the gyroscope alone for
0.6 s. MindAR's stale repeated poses after a loss are ignored. On by
default in the preview and the look test, with a "Gyro on/off" switch
next to "Frame lock". Simulated: a brisk 60°/s turn with ±1° wobbling
readings stays within 0.3° with no lag. If it is not enough: option C
(a commercial tracker) before step 3.

### 2026-10-06: Frame lock: show the camera frame the pose was measured on
MindAR reads a camera frame, takes a moment to find the marker in it, then
reports the pose; meanwhile the page had already shown newer frames, so
when the phone moved the scene slid against the print by a frame or two.
Now each frame MindAR reads is copied and shown only once its pose is
applied, so picture and scene always match (the standard fix in pro AR).
Trade-off: the camera picture refreshes at the tracking pace (shown in
the preview as "camera N"). A "Frame lock on/off" switch in the preview
lets Nico compare; on by default everywhere (AR test, look test, preview).
Also: a little more smoothing when the phone is still (0.9 Hz instead of
1.2). **Why:** Nico: better, but still some glitch and movement.

### 2026-10-06: Anti-jitter becomes a One Euro filter (speed-based)
Replaces the size-based filter. Still phone: strong smoothing (cut-off
1.2 Hz, later 0.9); moving phone: the cut-off rises with the measured speed (+7 Hz per
marker width/s, +10 Hz per rad/s), so the scene keeps up. Measured on a
calm 30°/s turn: lag 1.2° (size-based filters: 2.5° at first, 4° after
the previous round), with the same stillness (±1° wobble → ~0.1°).
**Why:** Nico: still glitchy, and objects drift when the phone moves. The
previous change (more smoothing of turns) caused the drift; a size-based
filter can't tell slow real movement from wobble, a speed-based one can.
Next options if needed: fuse the gyroscope; tune the two speeds.

### 2026-10-06: Media fixes after Nico's piece-2 test
- **Media opens the iPhone picker directly** (it already offers library, camera and files); the Camera / Photos tiles were a double choice.
- **Screens match the picture's shape.** Media are sorted into portrait (< 0.85), landscape (> 1.18) and square; each gets the screens made for it, first: portrait = Phone (9:16), Tablet (3:4); landscape = Flat TV (16:9), Laptop (16:10), Retro TV (4:3); square = Polaroid, Retro TV. Gallery frame and Chrome take any shape and are always offered. Device screens crop the picture to fill them (like a wallpaper). **Why:** phone media are mostly 9:16, often 16:9, rarely 1:1 (Nico).
- **Edit** (not "Place") and **Duplicate** (not "Copy") in the selection bar.
- **One video's sound at a time**: the first video gets it, later ones and duplicates start silent; a Sound switch in a video's Edit sheet moves it. **Why:** two sounds at once sounded bad.
- **Shadow floor writes no depth** (a first guess; it did not fix the vanishing video). The real cause: the media's white paper border was pulled towards the camera in depth to avoid flicker, and with AR's huge depth range that pull covered the picture at every angle. Now the picture is the one pulled forward; an automated render check proves it visible from 60° to 12°.
- **Anti-jitter: turning wobble is eased more** (200 ms instead of 110 ms). Superseded the same day by the One Euro filter (it caused drift).

### 2026-10-06: Photos and videos in InStudio (piece 2)
- **Media** in the tools opens **Import Media** with two tiles, *Camera* and *Photos & videos*; each opens the iPhone's own picker (a web page can't show the camera roll as a grid like E7r2).
- Then **Place Photo / Place Video**: *On a screen* (Phone, Gallery frame, Retro TV, Chrome), *Floating* (a thin card, starts a little in the air), or *On the marker* (a print lying on the marker). Selected media get a **Place** button to change this later. No Figma screens exist for this; designed in the REVISED style for Nico to judge.
- Media on the marker are moved on the 1 × 1 square only (drag), turned flat (twist), resized (pinch); never lifted.
- Stored on the phone in IndexedDB; photos resized to 1600 px; videos kept as they are, up to 150 MB; unused files are removed. **At most 2 videos per post** for now (frame rate; to be confirmed on the iPhone).
- Videos play silently in the editor and the preview; a round sound button unmutes them.
**Why:** roadmap step 2 (photos and videos on a screen, floating or flat on the marker); phone storage is the only option until cloud saving.

### 2026-10-06: Upright markers show exactly the editor's layout
The editor's wall square is the marker, so on an upright marker (wall,
screen, T-shirt) the scene now appears exactly as in the editor: the square
on the print, the floor sticking out from its bottom edge. Before, the scene
was centred on the print automatically. On a flat marker nothing changes
(the floor lies on the print), except media "on the marker", which are laid
onto the print. **Why:** what you build is what you get; follows Nico's
"the square is the marker". Supersedes the centring part of the
2026-10-05 upright-marker decision.

### 2026-10-06: Selected objects get a teal outline and a small pop
The selected object gets an outline that hugs its shape (thin white line +
soft teal-500 glow, drawn on top so it shows through objects in front), a
~5 % "pop" when picked, and the solid cyan ring on the floor. Editor only.
**Why:** Nico found the ring alone too subtle. Teal, not red: red means
danger in our design system (delete, errors, the full counter). Nico can
still compare red on the phone (one-line change).

### 2026-10-06: Bigger area, undo instead of "are you sure?", tilt after launch
- **Area:** objects may go 1 marker width from the centre to the sides and front (2 × 2 floor, 4× the marker), never behind the marker on the back wall, and up to 1.5 marker widths high. Shown as a faint cyan zone around the square; past an edge an object stretches a little and springs back. **Why:** Nico wanted more room, but not unlimited: the marker must stay in the camera's view while looking at the objects in AR (an iPhone ~40 cm away sees ~2.5 marker widths across). Distances are in marker widths, so scenes grow with bigger markers.
- **Delete** happens at once with a "Deleted · Undo" message for 5 seconds; no confirmation dialog. Full undo/redo stays in piece 4. **Why:** dialogs slow every deletion and people learn to tap through them; undo is the standard in creative apps.
- **Tilt (turning on the two other axes): later, after launch.** Launch keeps three ideas: one finger moves, two fingers resize, turn and lift. **Why:** most content reads upright; a hidden "hold then drag" gesture is hard to discover and causes accidental tilts; the scene format already stores all three axes, so adding it later is free. Laying media flat on the marker is a placement option in piece 2.
- AR frame rate on Nico's iPhone 13 with a full scene: 56–60 fps.

### 2026-10-06: Lift with two fingers; the marker square stands on the back wall
After Nico's first iPhone test (piece 1 otherwise "works"):
- **Height by gesture**, not a button: with two fingers on the selected object, slide both up or down to lift it (pinch and twist still resize and turn; a 14 px dead zone stops pinches from lifting by accident). One finger still slides it across the floor. **Why:** Nico found the Height handle weird and wants every direction with fingers only, like the old prototype; Adobe Aero and Reality Composer use the same two-finger lift.
- **The cyan 1 × 1 square is the marker** and stands against the room's back wall; objects stay in front of it. **Why:** Nico: it represents the marker's location (as in Figma E1r2).
- **Library: keep everything** and keep growing it, as long as the quality is there (unless a good licensed library is found online). **Why:** a big object library is needed.

### 2026-10-06: Step 2 is built and tested in five pieces
1. objects, 3D text, stickers, gestures, background, preview on the marker;
2. photos and videos (on a screen / floating / flat); 3. GIPHY GIFs; 4. the
tutorial and polish; 5. saving (several drafts on the phone, then cloud).
**Why:** the gestures are the riskiest part and everything else is placed
with them, so they come first and get tested on the iPhone early; media needs
phone storage work; GIFs need Nico's key; cloud saving needs his token.

### 2026-10-06: Selecting and moving objects in InStudio
Tap an object to select it (cyan ring under it + a bar: Edit for text,
Copy, Delete); tap empty space to let go; only the selected object can
change. On it: one finger drags it across the floor, two fingers pinch
(size 0.3–3×) and twist (turn); height: see the two-finger lift entry above. Every other
touch moves the camera as in the tutorial (one finger turns, pinch zooms,
two fingers pan, double tap resets). Tapping the same spot again cycles
through overlapping objects. Objects stay inside the workspace. **Why:**
Nico's rule (selected / unselected); Figma shows no selection state or
object gestures, only the camera ones.

### 2026-10-06: InStudio piece 1 layout choices
- Library sheet keeps Figma's "Place 3D Object" look; the Sketchfab / INRL tabs become **Objects / Characters**, the world chips become style chips (**All** + the open style list). Avatar opens Characters; Stickers opens the emoji cut-outs; Text opens a text sheet (type, pick one of 5 styles).
- **Music, Media and YouTube are hidden** in piece 1 (music and YouTube are not in step 2; Media is piece 2). The → arrow opens the marker preview until publishing exists (step 3).
- The scene slides up above an open sheet, as in E3r2.
- Background colours are read off E16r2 (approximate hex values).
- New library objects start at 1.5× their made size so they read in the workspace.
**Why:** follow the REVISED screens where they exist; fill the gaps the simplest way and let Nico judge on the phone.

### 2026-10-06: The three worlds are examples, not limits
Streetwear, Bubblegum and Designers are what we like and our first
exploration, not the only styles. The editor, library, data format and AI
presets treat styles as an open, growing, mixable list (text style,
material, colours chosen independently; new styles added over time).
Supersedes the "library is organised by the three worlds" part of the
2026-10-05 art-direction decision. **Why:** Nico: the app should not be
limited to these 3 styles.

### 2026-10-05: Adaptive anti-jitter on the marker pose
Our own filter between MindAR and the scene: small wobble smoothed, real
movement followed at once. MindAR filter stays at its defaults. **Why:**
Nico saw the scene swim on a printed marker and rejected MindAR's heavy
smoothing as laggy. Confirmed on the iPhone: "much better", tiny delay
acceptable.

### 2026-10-05: Flat/upright detection ignores unreliable poses
Nico's screen recording: a marker on the Mac screen showed the scene upright,
then flipped it to lying flat after a close or steep look, and it stayed
stuck (the "AR glitch"). The tracker's pose is unreliable at steep angles
and just after it finds the marker. Now: those readings are ignored, the rest
averaged, changes must hold 0.7 s, and tilts above 50° count as vertical.
**Why:** a placement flip is the most visible AR error; one steady decision
beats a fast twitchy one.

### 2026-10-05: Bubblegum has characters with faces and bouncy letters
Each balloon letter is its own candy colour and hops/squishes gently;
sparkles twinkle around the word; clay characters (heart, cloud) have
googly eyes that wobble and blink and a smile. Designers is approved as is
(O stays a letter, no object swap). **Why:** Nico found Bubblegum lacked
character; deck slides 12–13.

### 2026-10-05: Designers typography is an illustrated collage, not stickers
Each letter is its own little illustration (pattern fill, ink keyline,
coloured thick edge); some letters become objects (O → donut); emoji sit
around the word. White-bordered "fridge magnet" stickers were rejected by
Nico as cheap. **Why:** matches deck slide 17 (2D assets in 3D space).

### 2026-10-05: 3D text and materials are made live in the browser
3D text styles (sharp chrome, liquid chrome, balloon, stickers), materials
and user textures are generated in three.js at runtime (`src/look/`), not
pre-made. Blender (run by script, headless) is for pre-made assets only:
cleaning AI models, restyling CC0 packs, thumbnails, optimisation.
**Why:** the text and photos are the user's, so they only exist on the phone;
the editor needs the same code.

### 2026-10-05: Chrome reflects the camera in AR
In AR, the camera picture (mirrored, with a brighter top and darker floor)
is turned into the reflection map a few times a second. It gives the room's
real colours and light, not a true mirror image (the camera can't see behind
the phone). IN3D uses a studio per world. **Why:** chrome is only as good as
what it reflects; this is the standard web-AR approach and cheap on phones.

### 2026-10-05: Look-test fonts and emoji
UnifrakturCook (Streetwear sharp chrome), Titan One (balloon and liquid
chrome), Bungee (stickers), all SIL OFL from Google Fonts; Noto Emoji images
(Apache 2.0). Fonts are subset and pre-converted (`npm run look-fonts`).
**Why:** free for commercial use and embedding; Nico can veto after seeing
them.

### 2026-10-05: 3D pipeline principles
From Nico's brief: materials and lighting first; hybrid library (code + CC0
+ AI, checked by Nico); every asset tagged with metadata; phone budgets, not
ad-production budgets; no Fab / Unity Asset Store content (licences forbid
handing assets to users). Details in the `3d-assets` skill.

### 2026-10-05: No 3D artist: starter content without one
Starter library comes from (1) code: 3D text styles, materials, 3D screens,
procedural shapes (inflated forms, chrome primitives, cut-out stickers);
(2) CC0 model packs (e.g. Kenney, Quaternius, Poly Pizza CC0), re-materialed
in the three worlds so they look like InRL rather than stock; (3) AI
generation with world presets (step 4), curated by Nico. **Why:** no artist
available; Nico art-directs and approves what enters the library.

### 2026-10-05: Project memory lives in the repo
`CLAUDE.md`, `docs/STATUS.md`, these docs and `.claude/skills/`, updated at
the end of every session. **Why:** the conversation will outgrow one chat;
each new feature starts a fresh chat from these files.

### 2026-10-05: Art direction: three worlds × three types
Streetwear/Techwear (chrome + glass), Bubblegum Pop (clay, inflated),
Designers (soft tech, custom textures, 2D-in-3D, blank toy) × Objects /
Typography / Characters, from the deck "INRL JULY 31 VNico". The editor's
library is organised this way, and the worlds become AI style presets.
**Why:** a distinct, ownable look; Nico's team loved these references.
(Refined 2026-10-06: the worlds are examples, not limits; see above.)

### 2026-10-05: Look test before the editor
Prove chrome, inflated and 2D-in-3D text and materials on the iPhone first.
**Why:** the editor is built around this content; quality must be checked first.

### 2026-10-05: Upright markers: scene stands upright, centred in front (option B)
Flat markers: scene stands on the print. Vertical (wall, screen, T-shirt):
scene's up is the print's up, centred on it, in front of it; floor shadows
off. Detected automatically from the phone's motion sensor (iOS asks for
"motion & orientation" access from the same tap as the camera).
**Why:** T-shirts and posters are vertical; the Figma A31 screen shows the
character popping out of the shirt.

### 2026-10-05: Editor scope details
- **Media** (photos, videos, GIFs) can go on a 3D screen, float in the air, or lie flat on the marker. A set of screen types to choose from.
- **GIFs** via GIPHY, using GIPHY's MP4 versions in 3D (smoother than GIFs).
- **YouTube: later.** Only people's own videos for now. YouTube can't be drawn onto 3D (its player hides its pixels; extracting the stream breaks YouTube's terms); later option: the real player as an overlay aligned with a 3D screen (no occlusion; one per scene).
- **Music: later** (licensing). Royalty-free placeholders only.
- **Avatars:** Ready Player Me was acquired and its developer services wound down; avatars move to AI creation (step 4) plus a customizable blank toy.
- **Saving:** on the phone first, then cloud saving at the end of step 2 (Nico's phone storage is short).

### 2026-10-05: Sketchfab replaced by AI 3D creation
Text-to-3D and photo-to-3D (step 4). **Why:** people make their own objects
instead of browsing someone else's library; more on-brand with style presets.

### 2026-10-05: Hosting on a separate Cloudflare account
INRL2 runs on its own Cloudflare account (Workers with static assets),
auto-deploying from GitHub `main`; the GitHub app only has access to the
INRL2 repo. **Why:** complete separation from the account Nico's developers
use for the current InRL product.

### 2026-10-05: Media served with byte ranges
`worker/index.ts` answers `Range` requests for media with 206 responses.
**Why:** Cloudflare's static assets return whole files; iPhone Safari needs
partial responses to play video (the old prototype hit the same problem on R2).

### 2026-10-05: `.npmrc` skips install scripts; markers compiled in Chrome
**Why:** MindAR depends on node-canvas (for its Node-only compiler), which
fails to build on Cloudflare's machines. Nothing uses it: the marker script
draws and compiles in headless Chrome with MindAR's browser compiler.

### 2026-10-05: MindAR core driven directly
`src/ar/MarkerTracker.ts` uses MindAR's Controller with our own three.js
renderer. **Why:** MindAR's three.js wrapper (1.2.5) imports APIs removed from
current three.js. MindAR itself is little maintained upstream: treat it as a
dependency we may have to maintain.

### 2026-10-05: Design system resolutions applied
From the Figma DESIGN SYSTEM page's "Drift & decisions": one accent teal
(#12A2B8), filled buttons darkened to #0A7383 for readable white text,
secondary buttons in ink-900, radii 20 / 8 / 100, Roboto only.

### 2026-10-05: Order of work: AR test → editor → publish/markers → AI → social
**Why:** prove the riskiest assumption (3D + video on a marker in iPhone
Safari) in a week before investing weeks in the editor; the editor's output
defines everything else.

### 2026-10-05: Fresh repo, port only proven pieces
New repo `Wearenico/INRL2` rather than extending `Jihan0712/mindar`. Ported
ideas: iOS video range fix, MindAR tuning, marker quality gate, print guide,
two-step marker model. The merch shop is set aside. **Why:** the old repo
became a shop with a 5,000-line single-file API and no framework.

### 2026-10-05: WebAR instead of Unity
**Why:** no install (a QR code is already a web link, so anyone can scan a
marker), one codebase, instant updates. Known gap: marker-free AR on iPhone
browsers (Safari has no WebXR AR); markers are the core product, and those
work on both platforms.

### 2026-10-06: Cloud saving belongs to "this phone" until accounts
Scenes and media are saved under a private random key kept on the phone
(only its hash is stored in D1). When accounts arrive (step 3) the phone's
scenes move into the signed-in account. **Why:** cloud saving now, without
building sign-in first; the key never leaves the phone except as a header.
Clearing Safari's website data loses the key (and access to those cloud
copies) until accounts exist.

### 2026-10-06: Photos and videos leave the phone once uploaded
After a photo or video reaches R2, the phone's copy (IndexedDB) is deleted;
the editor and AR then load it from `/api/media/<id>`. **Why:** Nico's phone
storage is short, and the feed and AR viewers need the media online anyway.
Cost: editing a scene with videos needs a connection.

### 2026-10-06: Media are public by unguessable id; scenes are private
`/api/media/<id>` needs no key (anyone viewing a scene must load its
media; ids are 12 random characters), while scene reads and writes need the
phone key. Unused media are cleaned up a day later (so Undo during an
editing session stays safe); deleting a scene removes its media at once.

### 2026-10-06: My scenes design (no Figma screen)
Two-column grid like the profile's object grid: a dashed "New scene" card,
then one card per scene (picture of the starting view, "Scene · date, time",
object count, time since the last change, cloud state: Saved / Saving… / On
this phone) with a delete button (5 s Undo, as for objects). The editor's ×
goes back to My scenes. Naming scenes waits for the publish flow (New Post's
caption, step 3).
Nico confirmed (2026-10-06): no renaming before then.

### 2026-10-06: Swiping between scenes in the camera view
In INRL, swiping left/right along the bottom of the camera view shows the
next/previous scene without leaving the camera. Placed on a surface: the
next feed scene drops in the same spot. **On a marker: the marker owner's
other scenes** (Nico). **Why:** browsing in AR without re-scanning; a
marker is a doorway into its owner's work.

### 2026-10-06: iPhone floor placement = native ARKit under our web page
The floor test app is a thin native shell: ARKit finds surfaces and tracks
the phone, and sends the camera pose and lens to a transparent web view each
frame (`window.__inrlNative.frame`); the web page draws the scene with the
same scene builder as every other viewer. Taps, gestures and the swipe strip
are web. **Why:** this is the shape of the App Clip Nico wants (no install,
web updates without Apple review); on the iPhone 13 the bridge costs 0–2 ms
and keeps 60 fps, and Nico found it stable. One unit (marker width) = 0.5 m
on the floor by default, pinch to resize.

### 2026-10-06: Test builds signed with a separate free Apple ID
nico@wearenot.co (free "Personal Team"), because tessier.n@gmail.com's free
team reached Apple's device limit. The iPhone keeps its own Apple ID. Free
installs last 7 days; the paid program (when we go for the App Clip) lifts
that.

### 2026-10-07: Worker requests share no promises
After Nico's videos froze in the floor test app: the worker's table setup was
one promise shared by all requests, and a cancelled video request left every
other request waiting forever. Rule: only plain flags are shared between
requests; media are served without touching the database.

### 2026-10-07: Floor test signed off; App Clip after step 3 starts
Nico: the iPhone floor experience (ARKit under our web page) is "100% what I
want". He enrolls in the paid Apple Developer Program now; step 3 goes ahead
in parallel, the App Clip is built once the account is active.
