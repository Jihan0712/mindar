# Step 5 plan: the social layer

_Written 2026-10-07. Status lives in [STATUS.md](../STATUS.md); answers to the
open questions go into [decisions.md](decisions.md)._

**Goal:** people find and enjoy each other's scenes. A home feed (For You /
Following) shows posts as pictures (INART) and lets you open them in 3D
(IN3D); you can open anyone's profile, follow them, like and comment, get
notified, and search in Discover. A bottom bar ties it together.

**Design:** Figma REVISED, A1 (feed), B1r2 (own profile), C1 / C12 (post
viewer, comments), G1–G5 + Posts 01 (someone else's post and profile,
Discover, notifications), NAV MENU 2 (bottom bar). Rendered and described in
`.cache/figma/step3-screens.md`; frame IDs in
[screens.md](../design/screens.md). Not in this step: music (the ♫ line
stays hidden), INRL without a marker (A4, step 6), messages (see questions).

**Never break what's live:** InStudio, My scenes, cloud saving, sign-in,
posting, markers, `/m/<code>` scanning and the AR pages. Every piece is
checked with `lint`, `tsc -b`, `npm test`, `build`, `test:studio`,
`test:publish`, `test:ar`, and a new `test:social`, then shipped with the
`ship` skill before the next one starts.

## The pieces, in build order

Each piece is small enough to ship and test on the iPhone on its own.

### 1. App shell: the bottom bar and public post links
- **What:** the floating bar (Home, Search, Scan/Create, Notifications,
  Profile) on the main screens; the current Home buttons move into it. Every
  post gets its own link (`/p/<id>`) that opens the viewer, so posts can be
  shared and opened from anywhere.
- **Needs:** a public "get one post" API (author, caption, scene, counts).
  Screens without the bar: InStudio, camera / AR, sign-in.
- **Test:** `test:social` opens each tab and a post link; the existing tests
  still find InStudio, Scan and Sign in. iPhone: tap through the bar, open a
  shared post link from Messages.

### 2. Home feed (For You / Following) and the post viewer
- **What:** A1: cards with the post picture, author, time, likes and views,
  tap = full-screen viewer (C1 / G1) with the INART / IN3D switch reused
  from the marker page, swipe up / down to the next post. INRL stays where it
  works today (the author's marker).
- **Needs:** feed API with paging (20 at a time); "views" counted when a
  post is opened. Following tab shows "follow people" until piece 3.
- **Test:** unit tests for the feed order and paging; `test:social` makes two
  accounts, publishes, checks both see the post, opens IN3D. iPhone: scroll
  speed, swipe between posts, IN3D gestures still right.

### 3. Profiles and follows
- **What:** someone else's profile (G2 / G21: name, @handle, followers /
  following / views, bio, Follow ↔ Unfollow, Objects grid with the big first
  card, Marker tab), reached by tapping a name or avatar anywhere. The "+"
  badge on a post's avatar follows from the viewer (G1). Own profile (B1r2)
  gets the same layout, plus Edit Profile (name, bio, picture if agreed) and
  Share Profile (`/u/<username>`, iOS share sheet). Following tab of the feed
  starts working.
- **Needs:** `follows` table, counts, profile API by username, bio (and
  picture) on accounts.
- **Test:** unit tests (follow twice = once, can't follow yourself, counts);
  `test:social`: B follows A, A's post appears in B's Following. iPhone:
  follow someone (Nico + a second account on the Mac or a test account).

### 4. Likes
- **What:** heart in the viewer (double-tap on the picture too), counts on
  cards, profile grid and viewer.
- **Needs:** `likes` table; counts kept on the post so the feed stays fast.
- **Test:** unit tests (like / unlike, one per person); `test:social`.
  iPhone: like, unlike, counts update.

### 5. Comments
- **What:** C12 sheet: list, add a comment, like a comment, delete your own;
  the post's author can hide comments ("Hide"). Signed-out people can read
  but are sent to sign-in to write.
- **Needs:** `comments` table, 300-character limit, simple rate limit.
- **Test:** unit tests (length, delete rights, hide rights); `test:social`
  (B comments, A hides it). iPhone: keyboard doesn't cover the input field.

### 6. Notifications
- **What:** G5: Today / Yesterday / Earlier; likes grouped per post ("a, b
  and others liked your scene"), new followers with Follow Back / Followed,
  comments; a dot on the bell when something is new. In-app only.
- **Needs:** built from the likes, follows and comments tables (no separate
  sending service); "last seen" time per account for the dot.
- **Test:** unit tests for grouping; `test:social` checks A sees B's like,
  follow and comment. iPhone: the dot appears and clears.

### 7. Discover
- **What:** G3: search people (name, @username) and posts (caption); below
  the search, a grid of posts that are popular lately (big card first, then
  two columns), tap = viewer (G4).
- **Needs:** search API (simple text matching is enough for the beta size).
- **Test:** unit tests for search and ranking; `test:social` finds account
  A by name. iPhone: search speed, results look right.

### 8. Safety basics (before anyone outside the team joins)
- Report a post, comment or person ("•••"), block a person (they disappear
  for you and can't follow or comment on you). Reports collected for Nico.
- **Test:** unit tests (blocked people are hidden everywhere); `test:social`.

## How testing works across the step
- **Unit tests** (`npm test`) for every new API rule, using the in-memory
  database already used for cloud saving and publishing.
- **`npm run test:social`** (new, headless Chrome with virtual passkeys like
  `test:publish`): two accounts, publish, feed, follow, like, comment,
  notifications, Discover, block. Grows with each piece.
- **Test accounts are flagged** so they never show in the real feed or
  Discover (the throwaway `@tmuxbfper` from step 3 gets flagged too).
- **The existing tests** (`test:studio`, `test:publish`, `test:ar`) run
  before every ship.
- **Nico on the iPhone 13** after each piece, with a short checklist of what
  to try and what to report (Copy report / screen recording via AirDrop).

## Rough size
3–4 weeks as on the roadmap: pieces 1–2 about a week, 3–4 about a week,
5–8 about 1–2 weeks, depending on test rounds.
