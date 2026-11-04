# Roadmap

Rough durations assume Nico tests and decides most days. Status lives in
[STATUS.md](../STATUS.md).

## Step 1: AR test ✅ (2026-10-05)
Hand-made scene (video screen, models, photo, music) on a printed marker, on
iPhone Safari. Passed: < 1 s to appear, stable, 60 fps, video and sound OK.
Added flat vs upright marker placement.

## Look test (2–3 days), next
Three 3D text styles (chrome, inflated, 2D-in-3D) and chrome/clay material
samples, in IN3D and AR on the iPhone, including chrome reflecting the real
room from the camera image. Confirms the art direction is achievable.

## Step 2: InStudio editor (3–4 weeks)
Built from the REVISED E…r2 screens and the tutorial (see
[screens](../design/screens.md)):
- Library browsable by type (Objects / Typography / Characters) and by style; the three worlds are the first style collections, not the only ones (styles are an open list, mixable). Starter placeholders until AI assets exist.
- 3D text in the three styles.
- 3D screens to choose from; photos and videos from the phone **on a screen, floating, or flat on the marker**.
- GIFs via GIPHY (Nico creates a free key).
- Touch controls: place, move, rotate, scale; 6-object limit with the "Object Limit Reached" alert; background colour; the coach-mark tutorial.
- Preview on the marker.
- Saving: on the phone first, then **cloud saving** (Cloudflare R2 + D1) at the end of the step, because phone storage is short.
- Not in this step: music, YouTube, AI creation.

Order changed 2026-10-07 (Nico): step 5 (social) comes next; step 4 (AI
creation) moves to just before the private beta. AI creation only adds a new
kind of object, so doing it later costs nothing extra.

## Step 3: publish → marker → scan ✅ (2026-10-07)
Accounts; every account gets a personal marker (QR inside artwork; the
two-step "QR identifies, artwork tracks" model); publish with caption; attach
a post to the marker; in-app scanning; scanning with the phone's normal
camera opens the web app.

## Step 4: AI 3D creation (1–2 weeks), after step 6, before the beta
Text-to-3D and photo-to-3D through a hosted provider (Meshy, Tripo, or open
models via fal.ai), behind our own API so the provider can change. World
presets keep results on-brand. Generating state in the editor, per-user
monthly limits (cost), moderation (brands, copyrighted characters), automatic
optimisation for phones. Characters/avatars researched here (Ready Player Me
replacement), including the customizable blank toy. Ready Player Me can't be
copied: only its game plug-ins were open source; the creator, its parts
library and servers were closed and shut down (31 Jan 2026, Netflix). An
open-source builder (e.g. CharacterStudio, VRM) would need a 3D artist to
make InRL-style parts; AI characters from a selfie or description are the
plan. Also here: **Claude as scene director** (describe a scene, Claude
writes the recipe from our library, you adjust it in the studio; ~$0.002 per
scene with Haiku), and possibly photo → objects + sounds (image-blaster style).

## Creator uploads + scene budget (about 1 week), before the beta
Decided 2026-10-08 (Nico). Anyone uploads a `.glb` (checks, automatic
compression, preview, rights checkbox, Report); a **scene budget bar**
(download size + triangles + texture memory) replaces the 6-object limit for
everyone. Needs: a Figma screen or two (upload sheet, budget bar, "too
heavy" message), budget numbers measured on the iPhone 13, a short guide for
creators (baking Blender effects into animation).

## Step 5: social layer ✅ built (2026-10-07 → 08), in testing
Feed (For You / Following) with INART and IN3D, profiles, follows, likes,
comments, notifications, Discover.

## Step 6: viewing modes (2 weeks), next
INRL without a marker: WebXR surface placement on Android; iPhone fallback
to be chosen (marker only, Quick Look without video, or an App Clip later).
Nico (2026-10-07): a post's INRL should drop the scene on a surface and let
you swipe between posts, as in the iPhone test app.

## Step 7: polish and private beta (2–3 weeks)
Performance, security review by an experienced developer, invite-only beta.

## Later
**Scenes pinned to a place** (InRL's founding idea; Nico, 2026-10-06): drop
a scene at a spot (e.g. a backyard) and it can be seen there, only in AR.
Attached to **GPS coordinates** (not to a camera scan of the place).
**Private** posts: only the people tagged can see them. **Public** posts:
anyone, but only for a limited time (duration to set). GPS is ±5–15 m and
the compass is approximate, so the scene lands near the spot, not on an
exact centimetre; arriving visitors get "a scene is here", open the camera,
and it drops at the coordinate relative to them (surface placement on
Android web and the iPhone App Clip). A printed marker at the place stays
the exact option. Long after step 6.
**Whole-scene import** (parked by Nico, 2026-10-08): a full Blender scene
uploaded as one file, built on an InRL starter file with the marker square,
then completed in InStudio (video, photos, text, music). The main creator
path after the MVP. **Don't build it until everything above is done; then
remind Nico** (his request, 2026-10-08).
**3D object marketplace** (Nico, 2026-10-08): creators' uploaded objects
usable by others, maybe sold. Also further out: photo-real mini-worlds
(Gaussian splats) when phones handle them; interactive posts (mini-games on
a marker).
Music licensing; YouTube as an overlaid player on a 3D screen; brand/merch
features; the display font licence.
