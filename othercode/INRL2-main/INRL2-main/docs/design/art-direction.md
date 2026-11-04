# Art direction: InRL 3D content

Source: deck "INRL JULY 31 VNico" (Google Slides
`1xiD5SenIXWRFBV1L2Z4oTf0ysYBVygkJVnOECTvDFKQ`). Key slides are exported in
[references/](references/). They are **mood references only**: several show
third-party brands and artists (Louis Vuitton, Nike, NewJeans, KAWS-like
toys) and must never be copied or shipped.

**Goal (slide 2):** "INRL's own 3D assets with a look and feel distinct to the
brand." Street culture, fashion and toys.

**The three worlds are examples, not limits** (Nico, 2026-10-06). They are
what we like and our first exploration: starter collections and proof that
strong looks work on phones. The app must not restrict people to them.
Styles, materials and text looks are open-ended: mixable across worlds and
extendable with new styles over time (ours, AI-made, and eventually the
creators' own). Code and data treat a style as one entry in an open list,
never as a fixed set of three.

## Structure (slide 5)

Three **worlds** × three **types**:

| | Objects | Typography | Characters |
|---|---|---|---|
| **Streetwear / Techwear** | chrome + glass | liquid chrome lettering | dark designer toys |
| **Bubblegum Pop** | clay, plasticine | inflated balloon letters | cute blobs with faces |
| **Designers** | soft tech, custom textures | 2D assets in 3D space | blank toy to customize |

The editor library is organised the same way, and the worlds become **style
presets** for AI creation.

## Streetwear / Techwear: chrome + glass
References: [06](references/06-streetwear-techwear-mood.jpg), [07](references/07-streetwear-objects-chrome-glass.jpg), [08](references/08-streetwear-typography-chrome.jpg), [09](references/09-streetwear-characters.jpg).

- **Feel:** night city, techwear, luxury. Black, silver, iridescent highlights.
- **Objects:** liquid chrome, polished metal, chains, crystals and prisms, glass shapes with refraction. Mirror-smooth.
- **Typography:** molten / dripping chrome, sharp gothic chrome, chrome graffiti tags; iridescent rims and sparkles.
- **Characters:** designer vinyl toys in black techwear, matte black plus chrome details.
- **How we render it:** physically based metal (`metalness 1`, low roughness) with an environment map; in AR, build the environment from the **camera image** so chrome reflects the real room. Iridescence via the material's iridescence layer or a thin-film tint. Glass: faked refraction (environment-mapped), not real transmission (too heavy for phones).

## Bubblegum Pop: clay and inflated
References: [10](references/10-bubblegum-mood.jpg), [11](references/11-bubblegum-objects-clay.jpg), [12](references/12-bubblegum-characters.jpg), [13](references/13-bubblegum-typography-inflated.jpg).

- **Feel:** K-pop, candy, playful, soft daylight. Pinks, lilac, mint, yellow.
- **Objects:** plasticine and clay: soft rounded forms, slight fingerprint texture, matte-to-satin.
- **Typography:** inflated, puffy balloon letters with soft highlights; glossy pink/purple gradients.
- **Characters:** blobs and everyday things with googly eyes and simple smiles (cloud, heart, pompom, cherries).
- **How we render it:** rounded geometry (heavily bevelled or "inflated" meshes), satin/clearcoat materials, soft key light, subtle noise normal map for the clay feel, gradient textures.

## Designers: soft tech, custom texture, 2D-in-3D
References: [14](references/14-designers-mood.jpg), [15](references/15-designers-objects-soft-tech.jpg), [16](references/16-designers-objects-custom-texture.jpg), [17](references/17-designers-typography-2d-in-3d.jpg), [18](references/18-designers-characters-blank-toy.jpg).

- **Feel:** artists and graphic designers; a canvas for the creator's own work.
- **Objects:** soft retro tech (CRT monitors, phones, bottles) in monochrome purple/blue; **blank objects whose surface the user customizes** (their photo, a pattern, an AI-made texture): slide 16.
- **Typography:** letters built from objects, signs and emojis ("2D assets in 3D space"): flat cut-outs with thickness, playful collage.
- **Characters:** a **blank designer toy** (Munny-style base) that users paint or texture; a strong replacement for Ready Player Me avatars.
- **How we render it:** clean UV-mapped base meshes for custom textures; cut-out sprites with an extruded edge for 2D-in-3D; flat, soft lighting.

## Rules for every asset

- Original work only. No brand logos, no copyrighted characters (also enforced in AI creation).
- Fits phone budgets (see the `3d-assets` skill).
- Reads well at marker scale (about 15 cm) and in both placements (standing on a flat marker, upright in front of a vertical one).
- Each asset is tagged with its type, its style(s) and free tags; a world, where it has one, is just one tag among others.

## Production

No 3D artist is available (decision 2026-10-05). Starter content comes from
code (typography styles, materials, screens, procedural shapes), CC0 model
packs re-materialed in our styles, and AI generation with style
presets. Nico art-directs: nothing enters the library without approval.
