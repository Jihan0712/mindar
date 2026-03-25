# 8th Wall Open Source — Feasibility Report for INRL AR

> **Date:** March 5, 2026  
> **Project:** INRL AR — WebAR-powered ecommerce (MindAR 1.2.5 + A-Frame 1.5.0)  
> **Question:** Should we switch from the current MindAR/Three.js stack to 8th Wall Open Source?

---

## Executive Summary

**Recommendation: Do not switch at this time.**

8th Wall is now fully free and open source (hosted platform retired Feb 28, 2026), which makes it a serious contender for the first time. However, for INRL AR's current use case — image-tracking a single marker and playing a video overlay — MindAR 1.2.5 already does the job adequately. The migration cost is high, the workflow changes significantly (CDN-based → desktop editor + export), and there is no functional gain for the current feature set.

Revisit this decision if the project needs world/SLAM tracking, hand tracking, face effects, or richer 3D AR scenes. MindAR's stagnating maintenance (solo maintainer, last release January 2024) is a medium-term risk worth monitoring.

---

## 1. What Is 8th Wall Open Source?

8th Wall was a premium commercial WebAR platform by Niantic. In late 2025, Niantic announced it would transition 8th Wall to a fully open source, free product. **The hosted `8thwall.com` platform was retired on February 28, 2026.** It now lives at [8thwall.org](https://8thwall.org), operated by Niantic Spatial, Inc.

### What changed

| Before (Hosted SaaS) | Now (Open Source) |
|---|---|
| Subscription-based pricing | Free, no login required |
| Hosted editor in the browser | 8th Wall Desktop app (Mac/Windows) |
| Niantic-hosted deployment | Self-host anywhere |
| API key required for engine | No key required |
| Automatic updates | Community-driven releases |

### What is available today

- **XR Engine** (`xrjs`) — the core AR engine, open source on GitHub
- **Image Targets** — marker-based image tracking
- **Face Effects** — face mesh AR
- **Sky Effects** — sky replacement AR
- **World Effects / Absolute Scale** — via XR engine binary only (not pure JS yet)
- **Lightship VPS** — visual positioning (geospatial AR)
- **Hand Tracking** — open source
- **8th Wall Desktop** — a visual 3D/AR editor that exports to web and native (native export coming soon)
- **Utilities** — Image Target Processor, XR Extras (UI components)
- **Example integrations** — A-Frame, Three.js, Babylon.js, Camera Pipeline

---

## 2. Current INRL AR Stack

The entire AR experience lives in a single page (`index.html`) at the root.

### Libraries in use

| Library | Version | Source |
|---|---|---|
| A-Frame | 1.5.0 | CDN (`aframe.io`) |
| MindAR Image | 1.2.5 | CDN (`cdn.jsdelivr.net`) |
| Three.js | Bundled inside A-Frame | Accessed via global `THREE` (not a standalone import) |

**Three.js is not used as a standalone renderer.** It is only accessed through A-Frame's bundled `THREE` global — specifically for:
- `THREE.Vector3` and `THREE.Euler` in a lerp/slerp smoothing loop that reduces hand-jitter on tracked markers
- No custom Three.js scenes, shaders, or geometry

### AR pattern

1. A `.mind` file (pre-compiled MindAR image target) is fetched from Cloudflare R2 at runtime
2. A-Frame scene is configured dynamically with `mindar-image` attributes
3. When target is found, a video (also from R2) plays on an `<a-plane>` letterboxed to match the marker aspect ratio
4. All infrastructure runs on Cloudflare Workers (API), D1 (metadata), R2 (`.mind` + video assets)

---

## 3. Feature Comparison

| Feature | MindAR 1.2.5 | 8th Wall Open Source |
|---|---|---|
| Image Tracking | ✅ | ✅ |
| Face Tracking | ✅ (MediaPipe) | ✅ |
| World / SLAM Tracking | ❌ | ✅ (binary only) |
| Hand Tracking | ❌ (roadmap) | ✅ |
| Sky Effects | ❌ | ✅ |
| Lightship VPS (geospatial) | ❌ | ✅ |
| A-Frame integration | ✅ (primary) | ✅ (examples provided) |
| Three.js integration | ✅ (supported) | ✅ (examples provided) |
| Babylon.js integration | ❌ | ✅ |
| Pure CDN / no build step | ✅ | ⚠️ (Desktop editor preferred; raw JS possible but no longer primary workflow) |
| Self-hostable | ✅ | ✅ |
| Completely free | ✅ (MIT) | ✅ (open source) |
| No account / no API key | ✅ | ✅ |
| Compatible with `.mind` targets | ✅ | ❌ (different format) |
| Last stable release | Jan 2024 (v1.2.5) | Active (Niantic Spatial) |
| Maintainer | Solo (hiukim) | Niantic Spatial + community |
| GitHub stars | ~2.6k | ~596 (legacy repo) |

---

## 4. The "Three.js" Question — Clarification

The question frames this as *switching from Three.js to 8th Wall*. It is important to clarify what that actually means for this project:

- **This project does not use Three.js as its AR renderer.** Three.js is bundled inside A-Frame and accessed only for vector math in the jitter-smoothing loop.
- **The real question is MindAR vs 8th Wall** as the underlying AR tracking engine.
- **8th Wall open source also supports Three.js and A-Frame.** Switching to 8th Wall does not mean switching away from Three.js — both stacks can use Three.js.
- If the goal is to use a standalone Three.js renderer instead of A-Frame for the video overlay, that is a separate concern unrelated to which AR engine is chosen, and MindAR also supports a direct Three.js integration.

---

## 5. Migration Scope & Cost

Switching from MindAR to 8th Wall open source would require the following changes:

### High-cost changes

| Area | Current | Required change |
|---|---|---|
| **Image target format** | `.mind` files compiled via MindAR, stored in R2 | All targets must be reprocessed using 8th Wall's Image Target Processor into a different binary format |
| **AR viewer (`index.html`)** | `<a-scene mindar-image>` + MindAR A-Frame components | Full rewrite to use 8th Wall's XR engine + A-Frame or Three.js pipeline |
| **Target compilation pipeline** | Server-side MindAR compiler (`POST /upload`) | New pipeline using 8th Wall's Image Target Processor CLI/tool |
| **Cloudflare Worker API** | Returns `mindurl`, `videourl`, `imageurl` | Must return a different target format URL; schema migration required |
| **D1 schema** | Stores `.mind` URL in `targets.mind_url` | Column must be repopulated with new target format URLs |
| **Admin upload flow (`admin.html`, `brand.html`)** | Uploads image, server compiles `.mind` | New compilation step with 8th Wall tooling; UI changes may be needed |

### Medium-cost changes

- **Build / workflow tooling** — MindAR is CDN-only with zero build. 8th Wall's recommended workflow uses the 8th Wall Desktop app. Using the raw JS engine without the editor is possible but the examples and documentation center on the Desktop environment.
- **`targetFound` / `targetLost` events** — MindAR-specific events are used in `index.html` for video play/pause; 8th Wall uses its own event model.
- **Jitter smoothing** — The current Three.js lerp/slerp loop is custom. 8th Wall's tracker has its own built-in smoothing; the custom code may not be needed or may conflict.

### Low-cost changes

- **iOS-specific workarounds** — Some iOS AudioContext unlock and orientation-reset logic may still be needed regardless of AR engine.
- **Cloudflare infra** — No changes. R2, D1, Workers, Pages all remain unaffected.

---

## 6. Tracking Quality

8th Wall was historically the industry gold standard for WebAR tracking, particularly for:
- **SLAM / World Tracking** — far superior to any open source alternative
- **Image Tracking stability** — generally smoother and more robust than MindAR in real-world lighting conditions
- **Low-light performance** — 8th Wall's engine was optimized for difficult conditions

MindAR is adequate for controlled environments (printed markers, reasonable lighting). The current INRL AR product experience — a video playing on a physical product card — is a relatively forgiving use case. The custom jitter-smoothing already compensates for MindAR's natural instability.

**For the current use case**: tracking quality difference is unlikely to be user-perceptible in typical retail conditions. The gap matters more if tracking complex surfaces, small targets, or in poor lighting.

---

## 7. Maintenance Risk Assessment

### MindAR (current)

| Factor | Status |
|---|---|
| Maintainer | Single developer (hiukim) |
| Last release | v1.2.5, January 2024 — **2+ years ago** |
| Open issues | 99 |
| Open PRs | 10 |
| Roadmap items pending | Hand tracking, body tracking, plane tracking |
| Community | Moderate (2.6k stars, Discord, Udemy course) |

**Risk level: Medium.** MindAR works and is stable, but it is not actively developed. If a browser API changes (e.g., camera stream API, WebGL context handling), there is no guarantee of a timely fix. The project is already pinned to v1.2.5 which is two years old.

### 8th Wall Open Source (proposed)

| Factor | Status |
|---|---|
| Maintainer | Niantic Spatial, Inc. + open source community |
| Status | Newly open sourced (Feb 2026) |
| GitHub activity | Active commits, community Discord |
| Ecosystem | Desktop editor, example projects, upcoming native export |
| Stability | New — open source transition is recent; ecosystem is still settling |

**Risk level: Low-Medium.** Backed by a company (Niantic Spatial) rather than an individual. However, the open source transition is very recent (weeks old). The toolchain, documentation, and community ecosystem are still maturing.

---

## 8. Verdict

### Switch now? No.

The migration cost is substantial and the functional benefit for this project's current feature set is zero. INRL AR does one thing: play a video over an image target. MindAR does this reliably today.

### When to reconsider

| Trigger | Action |
|---|---|
| Need world/SLAM tracking (e.g., place product in room) | Evaluate 8th Wall — MindAR cannot do this |
| Need hand tracking or face try-on | Evaluate 8th Wall; MindAR face tracking uses MediaPipe but hand tracking is not available |
| MindAR breaks on a major browser update with no fix | Migrate — 8th Wall would be the safe fallback |
| Tracking quality complaints from users in field | Benchmark 8th Wall image tracking vs MindAR on target images |
| 8th Wall Desktop workflow becomes CDN/script-tag friendly | Reevaluate — the deployment story would be much simpler |

### What to do right now

1. **Pin the MindAR CDN URL** — already done (v1.2.5)
2. **Self-host the MindAR JS bundle** — download and serve from R2 to remove the CDN dependency risk
3. **Monitor** [github.com/hiukim/mind-ar-js](https://github.com/hiukim/mind-ar-js) for any breaking changes or abandonment signals
4. **Monitor** [8thwall.org](https://8thwall.org) and [github.com/8thwall](https://github.com/8thwall) as the open source ecosystem matures

---

## References

- [8thwall.org](https://8thwall.org) — open source home
- [8th Wall Migration Guide](https://www.8thwall.com/docs/migration/)
- [github.com/8thwall/web](https://github.com/8thwall/web) — legacy examples (A-Frame, Three.js, Babylon.js)
- [github.com/hiukim/mind-ar-js](https://github.com/hiukim/mind-ar-js) — MindAR source
- [MindAR Documentation](https://hiukim.github.io/mind-ar-js-doc/)

