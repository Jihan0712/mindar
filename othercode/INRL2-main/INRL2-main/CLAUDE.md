# InRL: notes for Claude

InRL ("In Real Life") is a mobile **web** app: people build small 3D scenes
(max 6 objects; 3D objects, 3D text, photos/videos/GIFs on 3D screens) and
attach them to their personal **marker**, a QR code inside a piece of
artwork. Scanning the marker shows the scene in AR on top of it. A social feed
shows the same scenes in three modes: INART (flat), IN3D (orbit) and INRL (AR).
Full picture: [docs/product/vision.md](docs/product/vision.md).

**Start every session by reading [docs/STATUS.md](docs/STATUS.md).** It says
where the project is and what comes next.

## Who you are working with

Nico (nico@wearenot.co) leads the product and design. **Nico is not a
developer and does not read or write code.** So:

- Explain in plain language: what changed, what to look at, what to decide. No jargon without a one-line explanation.
- Make the technical choices yourself, with a short recommendation; ask Nico only for product and design decisions, accounts and keys, and testing on real phones.
- Nico tests on an **iPhone 13 in Safari** (no Android phone yet). Give clear step-by-step test instructions and what to report back.
- Nico can't paste from the phone easily: suggest Universal Clipboard (copy on iPhone, ⌘V on the Mac) or AirDrop for recordings.

## How we work

1. **Before building**, check [docs/product/decisions.md](docs/product/decisions.md); don't reopen settled questions unless Nico does.
2. **UI follows the Figma REVISED screens** and the design system ([docs/design/brand.md](docs/design/brand.md), tokens in `src/styles/tokens.css`). 3D content follows [docs/design/art-direction.md](docs/design/art-direction.md).
3. **Verify before saying done**: `npm run lint`, `npx tsc -b`, `npm test`, `npm run build`; for anything touching AR, `npm run test:ar` (see the `ar-testing` skill).
4. **Ship** with the `ship` skill: commit, push to `main`, wait for the Cloudflare build, check the live site.
5. **At the end of every session**, update [docs/STATUS.md](docs/STATUS.md), add new decisions to [docs/product/decisions.md](docs/product/decisions.md), and keep the other docs true to the code. This is how the next chat picks up the work.

## Commands

```bash
npm install          # .npmrc skips install scripts on purpose (see decisions)
npm run dev          # http://localhost:5173
npm run lint && npx tsc -b && npm test && npm run build
npm run test:ar      # headless Chrome + fake camera; needs the dev server and .cache/fakecam.y4m
npm run marker       # regenerate the test marker (.png + .mind) in headless Chrome
```

Live site: https://inrl2.marine-469.workers.dev (auto-deploys from `main`).

## Where things are

| | |
|---|---|
| Product | [vision](docs/product/vision.md) · [roadmap](docs/product/roadmap.md) · [decisions](docs/product/decisions.md) |
| Design | [brand / design system](docs/design/brand.md) · [art direction](docs/design/art-direction.md) · [screen index](docs/design/screens.md) · [marker guide](docs/marker-guide.md) |
| Tech | [architecture](docs/tech/architecture.md) · [testing](docs/tech/testing.md) |
| Skills | `.claude/skills/`: `ship`, `ar-testing`, `figma`, `3d-assets` |

## Rules

- **Never touch the other Cloudflare account** (the one Nico's developers use for the current InRL product). INRL2 lives only in its own account.
- **No secrets in the repo.** API keys go into Cloudflare secrets; Nico enters them in Cloudflare.
- **Assets must be licensed for commercial use**; record every third-party asset in `CREDITS.md`. The deck references (Louis Vuitton, Nike, KAWS-like toys…) are mood only, never to be copied.
- Commit messages explain *why*; end them with the Co-Authored-By line the session provides.
