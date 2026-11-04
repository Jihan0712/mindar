# Brand and design system

## Sources

- **Figma file:** *INRL - FINAL (Copy)*, key `YcOC5vnKCndvcnoRbQFN8N`, owned by Nico (Starter plan, so the Figma API allows only a few calls; see the `figma` skill).
  - **REVISED** page (node `750:3403`): all app screens. Index: [screens.md](screens.md).
  - **DESIGN SYSTEM** page (frame `1544:934`): colours, type, radius, components, drift decisions.
  - Other pages (Page 1 explorations, WEB STYLE GUIDE, WEB — UI, MVP WEBSITE) are not the app spec.
- **Original file** (read-only for us): `RES5XfG4fvECtsvIPV8pZl`, used by Nico's developers.
- **Code:** `src/styles/tokens.css` holds every token below; components use the CSS variables.

## Colour

| Token | Hex | Use |
|---|---|---|
| teal-500 | `#12A2B8` | Primary accent: active nav, tab underline |
| teal-fill | `#0A7383` | Filled buttons (darkened so white text passes WCAG AA) |
| teal-600 | `#5697A0` | Muted teal |
| teal-700 | `#3F7880` | Display type (profile names) |
| teal-900 | `#063137` | Deepest teal |
| ink-900 | `#384143` | Primary body and headings |
| ink-700 | `#455356` | Icons, inactive nav |
| ink-500 | `#737373` | Muted labels |
| ink-400 | `#879596` | Borders, muted icons |
| ink-300 | `#A6A6A6` | Low emphasis |
| ink-200 | `#BCBCBC` | Dividers |
| surface-white | `#FFFFFF` | Sheets, floating nav, modals |
| surface-page | `#EEEEEE` | App page ground |
| surface-cool | `#E1E8E9` | Cool tinted surface |
| surface-sand | `#E2D4CA` | Warm sand, the only warm surface |
| surface-chip | `#CED6D8` | Chips, secondary buttons |
| surface-subtle | `#F2F2F2` | Search field |
| surface-placeholder | `#D9D9D9` | Image placeholder |
| signal-like | `#FF3B3C` | Liked state |
| signal-alert | `#DC191A` | Destructive |
| signal-highlight | `#F0DD2B` | Highlight accent |
| signal-ar-cyan | `#00F6FF` | AR reticle stroke only, camera surface only, never a button |

## Type

Roboto carries the interface. Text styles (CSS classes `t-*` in `tokens.css`):

| Style | Font | Example |
|---|---|---|
| INRL/Display/32 | Demo Archimoto V01, Medium, 32/120% | Profile names ("Roy Andersson") |
| INRL/Heading/22 | Roboto SemiBold 22/120% | "Welcome to Your InStudio" |
| INRL/Heading/18 | Roboto Medium 18/120% | "Discover" |
| INRL/Heading/16 | Roboto Bold 16/130% | "New Post" |
| INRL/Body/14 Bold | Roboto Bold 14/140% | Names in lists |
| INRL/Body/14 Medium | Roboto Medium 14/140% | Buttons |
| INRL/Body/14 | Roboto Regular 14/140% | Body |
| INRL/Label/12 Medium | Roboto Medium 12/140% | INART / IN3D / INRL (the workhorse) |
| INRL/Label/12 | Roboto Regular 12/140% | "212 likes · 30 views" |
| INRL/Caption/10 | Roboto Medium 10/140% | "150 Characters left" |

⚠️ **Demo Archimoto V01** is a demo font; a commercial web/app licence is needed before launch. Not used in code yet.

## Radius

`radius-xl` **20 px** is the system (pills, cards, sheets, primary buttons).
Also kept: `radius-md` 8 px, `radius-pill` 100 px.

## Components (from the design system page)

- **Primary button, full width:** 322×43, radius 20, teal-fill, Roboto Medium 14 white.
- **Primary button, modal:** 171×43, same style.
- **Secondary, compact:** 108×34, radius 20, surface-chip, Roboto Medium 12, ink-900 text.
- **Secondary, full width:** 322×43, surface-chip, ink-900 text.
- **Chip, selected:** auto×32, radius 20, teal; unselected: surface-chip.
- **Bottom sheets / modals:** white, radius 20 on top corners, 16 px side gutters.

## Decisions applied (from "Drift & decisions")

1. One accent teal (#12A2B8); teal-400 #43ADBB retired.
2. Near-duplicate inks collapsed into ink-700.
3. Radii reduced to 20, 8 and 100.
4. Nunito Sans and Inter replaced by Roboto.
5. Filled teal buttons darkened to #0A7383 (5.5:1 contrast).
6. Secondary buttons use ink-900 text (7.1:1); the old ink-500 made "Attach to a Marker" look disabled.

## Logo

The InRL wordmark (rounded line letters) appears on the splash and in
headers. We don't have it as a vector file yet; the code shows a text
placeholder. **Needed from Nico:** the logo as SVG.
