---
name: figma
description: Read InRL's designs from Figma (screens, design system, components) despite the Starter-plan API limit. Use whenever building or checking UI against the design, or when Nico refers to a screen or the design system.
---

# Reading the InRL Figma file

- **File:** `YcOC5vnKCndvcnoRbQFN8N` (*INRL - FINAL (Copy)*, Nico's copy).
  REVISED page `750:3403` (all screens); DESIGN SYSTEM frame `1544:934`.
  Screen index with frame names: `docs/design/screens.md`. Tokens already
  extracted: `docs/design/brand.md` and `src/styles/tokens.css`. **Check
  those first**; often no Figma call is needed.
- The file is on a **Starter plan**: the Figma MCP tools (`get_screenshot`,
  `get_design_context`, `get_metadata`…) stop after a handful of calls. Spend
  them on the specific frames you need (screenshot a single frame, not a
  whole page; `get_metadata` on a whole page overflows anyway).

## Fallback 1 (best): headless Chrome screenshots
The file is viewable without signing in, so headless Chrome can render any
frame by its node ID (IDs in `docs/design/screens.md`; find new ones in the
built-in browser's layer panel: each row's `data-testid` is `<id>-layers-panel-row`).
Set a normal desktop user agent (CloudFront blocks "HeadlessChrome"), open
`…?node-id=<id with ->`, wait ~12 s, hide the cookie banner, and clip the
frame (at 900×1100 a 375×812 frame sits at about x 255–645, y 150–1020).
Works even when the built-in browser pane is hidden. ~15 s per frame.

## Fallback 2: the browser
1. Open `https://www.figma.com/design/YcOC5vnKCndvcnoRbQFN8N/INRL---FINAL--Copy-?node-id=<id>` in the built-in browser (`preview_start` with the URL; the pane must be visible or the canvas won't render).
2. Keyboard shortcuts don't reach the canvas in view mode. Zoom and pan by dispatching wheel events on the `<canvas>`:
   ```js
   const c = document.querySelector('canvas')
   const Z = (x, y, d) => c.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaY: d, ctrlKey: true, bubbles: true }))  // d<0 zooms in
   const P = (dx, dy) => c.dispatchEvent(new WheelEvent('wheel', { clientX: 400, clientY: 300, deltaX: dx, deltaY: dy, bubbles: true }))
   ```
   Send events in small steps with ~40 ms gaps; rendering lags, so take a second screenshot if the first looks unchanged.
3. Around 50–120% zoom, labels and hex values are readable.
4. Decline non-essential cookies if the banner appears.

## When designs are missing
Some editor features have no screens yet (media placement choice, screen
types, type × style library tabs). Propose them in the REVISED style using
the tokens, show Nico, and note the decision.
