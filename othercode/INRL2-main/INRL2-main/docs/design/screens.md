# Screen index: Figma REVISED page

File `YcOC5vnKCndvcnoRbQFN8N` (Nico's copy), page REVISED (node `750:3403`).
Frames are named by row letter and number; `…r2` frames are the revised
versions and win over the originals. Phone frames are about 390×844.

| Row | Frames | What it shows | Roadmap step |
|---|---|---|---|
| **F**: onboarding | F1, F21–F25, F26, F3–F5 | Splash with Google / Apple / other sign-in; email or phone → verification code → password → profile (photo, full name, username) → "Hello, Roy Andersson". Intro cards: "Welcome to InRL", "Be a 3D Creator", "Online to Offline" ("Start Your First Post"). | 3 |
| **E / E…r2**: InStudio editor | E1–E72; E1r2–E19r3 | 3D stage with highlighted placement area; "+" opens the toolbar (3D Object, Text, Audio, Picture, YouTube, Stickers); "Place 3D Object" sheet (Sketchfab / INRL tabs, category chips); Import Media (camera roll); Add Music (For You / Browse / Saved); Change Background (colour grid); "Object Limit Reached"; New Post (caption, song, "Attach to a Marker", "Publish Post"); "Attach to a Marker" (Marker 1–4); "Published Successfully". | 2 (publish parts: 3) |
| **tutorial** | tutorial-0001 to 0008, tutorialmarker-0001, tutorialprofile-01 | "Welcome to Your InStudio", "Navigating InStudio" (rotate, zoom, pan, double-tap reset); coach marks: workspace = 6 objects in the highlighted area, add music, change background, "choose up to 6 items… press the arrow to submit"; "Bring Your Post to Life and Share!" | 2 |
| **B…r2**: profile and markers | B1r2, B12r2–B17r2, B12, B13 | Own profile (Objects / Marker tabs, Edit Profile, Share Profile); Marker page ("Edit your Marker", "Share/Save"); "Edit your Marker" sheet (select a post to attach, Publish Marker); Published Successfully; iOS share sheet (Save Image, Print). | 3 |
| **C**: post viewer | C1, C12, C2, C21, C3, C31 | INART / IN3D / INRL switch; INART post with likes, comments, share, song; Comments sheet; IN3D first-time tip ("Use two fingers to move, rotate, or navigate the 3D space"); INRL camera with placement reticle and post carousel. | 3, 5, 6 |
| **A**: feed and scanning | A1, A2, A3, A31, A4, A41 | Home feed (For You / Following, scan icon); camera scanning; marker on a T-shirt → character pops out (A31, the reference for upright markers); INRL placement on a table. | 3, 5, 6 |
| **G**: social | G1, G2, G21, G3, G4, G5, Posts 01 | Post detail; another user's profile (Follow, Message, Objects / Marker); Discover search grid; Notifications (likes, follows, Follow back). | 5 |

Components also on the page: "Upper Buttons", "NAV MENU 2" (bottom bar:
Home, Search, Scan, Notifications, Profile).

## Changes since the screens were drawn
- **Sketchfab tab → AI creation** (step 4); the library tabs become Objects / Characters with style chips (All + an open list of styles; see decisions 2026-10-06).
- **YouTube tool:** own videos only for now (see decisions).
- **Marker picker (Marker 1–4):** markers become personal (QR inside artwork) in step 3.
- **Media placement** adds "on a 3D screen / floating / flat on the marker" and a choice of screen types: needs new screens (Claude can propose them).

## Frame IDs (for the `figma` skill)

Editor: E1r2 `1130:4668`, E2r2 `1130:4770`, E21r2 `1130:4955`, E3r2 `1130:5138`, E4r2 `1130:5250`, E5r2 `1130:5361`, E6r2 `1130:5521`, E7r2 `1130:5631`, E8r2 `1130:5869`, E9r2 `1130:5953`, E91r2 `1149:7503`, E10r2 `1140:6795`, E11r2 `1140:6905`, E12r2 `1140:7020`, E13r2 `1140:7130`, E14r2 `1149:7359`, E15r2 `1130:6042`, E16r2 `1138:6209`, E17r2 `1138:6399`, E18r2 `1138:6466` (New Post), E18r3 `1178:8159`, E19r2 `1178:7964`, E19r3 `1178:8055` (Published Successfully).
Tutorial: 0001 `1149:7722`, 0002 `1149:7799`, 0003 `1149:7837`, 0004 `1159:7903`, 0005 `1159:7909`, 0006 `1159:7926`, 0007 `1149:7873`, 0008 `1159:7942`, marker `1178:8927`, profile `1178:8285`.
Step 3 (found 2026-10-07): F21 `975:5387`, F22 `1005:7617`, F23 `1005:7648`, F24 `986:7493`, F25 `999:7568`, F26 `1005:7751`, F3 `971:18565`, F4 `971:18585`, F5 `971:18606`, B1r2 `750:4220`, B12 (single marker) `1178:8770`, B13r2 `1197:1027`, B14r2 `1197:999`, B15r2 `1197:1042`, B16r2 `1204:1102`, B17r2 `1221:1561`, A2 `921:14523`, A3 `975:5500`, C1 `750:4907`, C12 `975:4833`, C21 `1005:8376`, C3 `812:8811`, C31 `1040:5141`. Frames are 375×812 pt.
Step 5 (found 2026-10-07): G1 `975:6090` (post viewer, someone else's), G2 `975:5579` (profile, Follow), G21 `1012:8858` (profile, Unfollow), G3 `959:15357` (Discover), G4 `975:6717` (post from Discover), G5 `959:16896` (Notifications), Posts 01 `975:5581` (profile grid), A4 `921:14498`, A41 `986:7390` (INRL on a table, step 6). Described in `.cache/figma/step3-screens.md` ("Social (row G)").
Others: A1 `900:13706`, A31 `986:7351`, B12r2 `897:12808`, C2 `812:8532`, F1 `971:18626`, NAV MENU 2 `845:9622`.

## What the editor screens show (read 2026-10-06)
- **E1r2** empty stage: × (close), Music and Background pills, → (submit), "0/6" counter; grey grid room, cyan glowing workspace; white "+" button.
- **E2r2** "+" opens a white tool bar: 3D Object, Text, Avatar, Media, Youtube, Stickers; the button becomes a grey ×.
- **E21r2–E4r2, E10r2–E12r2** "Place 3D Object" sheet (Sketchfab / INRL tabs, world chips, 3-column grid); tapping a card drops it in the scene with the sheet still open; counter counts up (1/6, 3/6, 6/6 in red).
- **E7r2–E9r2** Import Media sheet: camera tile + camera-roll grid; the picture lands as a flat panel in the scene.
- **E13r2** "Object Limit Reached" with Ok, over a blurred screen.
- **E15r2** Add Music (Search, Saved, For You / Browse); **E16r2–E17r2** Change Background (21 swatches); the music pill then shows the song ("You… ×").
- **E18r2–E19r3** New Post (caption 0/150, song, Attach to Your Marker, Publish Post) → Published Successfully (step 3).
- **Tutorial 0001–0003** cards: "Welcome to Your InStudio" (Continue / Skip), "Navigating InStudio" (swipe to rotate, pinch to zoom; two fingers to pan, double tap for the default view; Let's Go! / Start Over). **0004–0008** coach-mark bubbles: workspace = 6 objects in the highlighted area; add music; change background; tap the action button for the tools; choose up to 6 items, press the arrow to submit.
