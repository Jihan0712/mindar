---
name: 3d-assets
description: Create, source, optimise and add 3D content for InRL (objects, 3D text, characters, materials, 3D screens) in InRL's styles (three starter worlds, open to more), within phone performance budgets. Use when adding anything to the 3D library, building materials or text styles, or judging whether an asset is fit for AR.
---

# 3D assets for InRL

Read `docs/design/art-direction.md` first. Every asset has a **type**
(object, typography, character) and one or more **styles**. The three worlds
(streetwear-chrome, bubblegum, designers) are starter styles, **not limits**:
never hard-code three; styles are an open list, mixable, and grow over time.

## Budgets (iPhone 13 baseline, scene max 6 objects)
- Per object: ≤ 30k triangles (hero character ≤ 60k), ≤ 2 textures at 1024² (2048² only for a hero), file ≤ 2 MB after compression.
- Whole scene: ≤ 150k triangles, ≤ 6 draw-heavy materials, ≤ 2 playing videos (to be confirmed on device).
- Format: **glTF binary (.glb)**, Y-up, metres not important (the builder normalises height), origin at the base centre, real-world proportions.
- Compression: meshes with Draco or Meshopt, textures as KTX2 (Basis) when the loaders are wired; until then, JPEG/PNG at 1024² max.
- Animations: named clips (e.g. `Idle`, `Walk`); loop-friendly.

## Materials by world
- **Chrome / glass:** `MeshPhysicalMaterial`, metalness 1, roughness 0.05–0.2, environment map required (studio HDRI in IN3D; in AR, an environment built from the camera image so it reflects the room). Iridescence for the oil-slick rim. Glass: environment-mapped fake refraction plus transparency, not `transmission` (too costly on phones).
- **Bubblegum / clay:** satin (roughness 0.4–0.6) with clearcoat for "inflated" gloss; subtle noise normal map for clay; candy gradient textures; rounded geometry (big bevels, inflated meshes).
- **Designers:** clean UV unwraps so users can apply their own image/texture; flat soft lighting; 2D-in-3D = textured cut-out plane with a thin extruded edge.

## 3D text
Built in code from a font (three.js `TextGeometry` / extruded shapes, or
`troika-three-text` for flat text). Fonts must be licensed for commercial
use (SIL OFL from Google Fonts is safe); record them in `CREDITS.md`. Styles:
chrome (bevelled, physical metal), inflated (heavy rounded bevel, clearcoat),
2D-in-3D (cut-out letters and emoji stickers with thickness).

## Tools
- **Live, in the browser (three.js):** anything that depends on what the user types or picks (3D text, their photo as a texture, material swaps) and procedural shapes. This is how the editor works, so build styles here first.
- **Blender, headless** (`/Applications/Blender.app/Contents/MacOS/Blender -b --python script.py`): anything made in advance: cleaning AI models, re-materialing CC0 packs, baking maps, decimating, thumbnails, GLB export. Scripts, not hand edits, so every step is repeatable. Blender can't run on Cloudflare: the step-4 automation will need its own worker machine (decide then).
- **glTF-Transform** (`npx @gltf-transform/cli`): final optimisation (Meshopt/Draco, KTX2, dedupe, resize textures).

## Asset metadata (every library item)
`type` (object/typography/character), `styles` (open list; a world is one possible style), `name`, `materials` (chrome, glass, clay, satin, custom-texture…), `triangles`, `textureSize`, `fileSize`, `animated`/clip names, `customizable` (takes the user's image), `source` + licence, `approved` (by Nico). Free-form tags too. This is what lets people search "chrome heart" in plain words later, and what AI style presets read.

## Principles (from Nico's 3D-pipeline brief, 2026-10-05)
- **Materials and lighting first.** A simple mesh with excellent chrome or clay beats a complex mesh with average shading. Materials are a first-class, reusable system, not per-asset settings.
- Hybrid library: our code + CC0 + AI generation, all checked by Nico. Few, very good bases transformed into many on-brand variations (procedural variants, material swaps, user textures).
- Pipeline for AI/stock models: generate → clean topology/normals/UVs → apply our materials → style match → optimise → tag → Nico approves.
- **Not** an ad-production pipeline: no 4K textures or heavy meshes (we are a phone browser drawing up to 6 objects live). No Fab / Unity Asset Store content: their licences usually forbid handing assets to users inside a creation app.
- Honest limit: Claude does procedural modelling, materials, lighting, optimisation and QA well; it can't hand-sculpt characterful characters. Characters come from AI generation plus Nico's eye.

## Adding an asset
1. Check licence (original, CC0, or commercial licence). No brand logos or copyrighted characters.
2. Optimise to budget; test-load in IN3D (`/3d`) and check size in the test panel / devtools.
3. Place it in the library with world, type, name, thumbnail, credit.
4. Add to `CREDITS.md` if third-party.
5. Run `ar-testing` if it changes how scenes render.

## AI-generated assets (step 4)
Generate through our own API wrapper (provider can change), with the world as
a style preset; always run the result through optimisation (decimate,
compress, normalise) and moderation before it reaches a scene.
