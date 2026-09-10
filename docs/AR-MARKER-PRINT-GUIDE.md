# AR marker requirements for printed garments

How to design and print a marker that the INRL AR layer can actually track when
it is on a shirt, on a person, seen through a phone.

The admin upload page (`admin.html`) scores every marker against these rules
before it compiles, and reports the real feature-point count afterwards. This
document explains what it is checking and why.

---

## How the tracker sees your artwork

Three facts about MindAR drive every rule below.

**1. It only sees brightness.** The compiler flattens each marker to greyscale
with `(R + G + B) / 3` before it does anything else. Colour is discarded
entirely. Two colours that are equally bright — a mid-red on a mid-green, for
example — are the *same pixel value* to the tracker, no matter how much they
contrast to the eye. This is the single most common reason a striking design
tracks badly.

**2. It tracks corners, not shapes.** It finds feature points at local extrema
of the image gradient — places where brightness changes sharply in more than one
direction. Broad flat fills, smooth gradients, and long straight edges produce
almost nothing. Irregular, high-frequency detail produces a lot.

**3. It assumes a flat, rigid plane.** MindAR solves a planar homography. A
shirt on a body is neither flat nor rigid: it curves around the torso and folds
as the wearer moves. Every fold makes the real print deviate from the flat
target the tracker is matching against. You cannot fix this in software — you
compensate by giving the tracker a large surplus of features, so the ones still
visible on the flat parts are enough.

---

## Artwork rules

### Contrast must be in brightness

Design in greyscale first, or check your artwork by desaturating it. If it turns
into mush when the colour is removed, the tracker sees mush.

Aim for strong light/dark differences between adjacent areas. The admin panel
reports "brightness contrast" — a standard deviation of luminance. Below ~25 is
a failure; 40+ is comfortable.

### Busy and irregular beats clean and minimal

This runs directly against most apparel design instincts, and it is the trade
you have to make consciously.

Good: dense texture, halftones, noise, photographic detail, hand-drawn line
work, irregular collage, small varied type.

Bad: a single large logo, thin outlines on a plain field, big flat colour
blocks, wide margins of empty fabric, smooth gradients.

### Never use a repeating pattern

Stripes, checks, grids, evenly tiled logos, regular dot patterns. A repeating
motif matches itself in several positions, so the tracker cannot decide which
one it is looking at. The overlay jumps between positions or refuses to lock.
Break any repetition with irregular variation.

### Spread detail across the whole print

The admin panel reports "coverage" — the share of an 8×8 grid whose cells
contain real detail. Below 40% is flagged.

This matters more on fabric than anywhere else. If all your features are in the
middle and the print folds down the middle, tracking is gone. Detail spread to
the edges means a fold across one region leaves enough elsewhere.

### Avoid extremes of overall brightness

A near-white or near-black design has nowhere to go. Work in mid-tones with
strong local contrast.

### Keep the target roughly square

Up to about 3:1 is fine. Beyond that, one end leaves the camera frame before the
user is close enough for the rest to resolve, and tracking drops.

---

## Source file requirements

| Property | Requirement |
|---|---|
| Short side | 640px minimum; 1024px+ preferred |
| Format | PNG or JPEG, minimal compression artefacts |
| Aspect ratio | 3:1 or squarer |
| Background | Include the actual printed background colour, not transparency |

The compile step resizes anything larger to fit 1024px, then builds its
matching pyramid at 256px and 128px on the short side. Detail that does not
survive being reduced to 128px is not contributing to detection — which is
another way of saying fine hairlines will not save a low-contrast design.

Supply the artwork **exactly as printed**. If the shirt shows it cropped, or
over a coloured garment, compile that version — not the original full-bleed
file on white.

---

## Printing rules

### Print it big

**15 cm / 6 in across minimum.** Larger is better. The user has to be able to
fill a useful part of the camera frame at a comfortable arm's length; a small
chest print forces them uncomfortably close, and at that distance the print is
also more curved.

### Matte, never glossy

Glossy plastisol, foil, metallic, and heavy vinyl all produce specular
highlights that blow out under a phone's light. The blown-out region loses all
its features. Matte prints — screen print with a matte base, DTG, soft-hand
water-based inks — hold up far better.

### Print on a flat, stable panel of the garment

Front chest and back panel are good. Avoid: across a seam, over a pocket, at the
waist hem where the fabric gathers, or across the shoulder curve.

### Mind the substrate

Heavy texture (slub, waffle, ribbing) adds noise the tracker has to see past.
Smooth jersey is best. On dark garments, make sure the underbase is opaque
enough that your light areas actually read as light.

---

## Testing before a production run

Do not go to a full run on a desk test alone. A marker that tracks perfectly on
a flat sheet of paper can fail entirely on a body.

1. Compile the marker in the admin panel. Check the reported feature points —
   under 250 matching points is a red flag.
2. Print one physical sample at final size on the final garment and ink.
3. Test it **worn by a person**, not laid flat: standing still, walking,
   arms moving, turning.
4. Test in three lighting conditions: bright daylight, indoor artificial light,
   and dim indoor. Dim is where weak markers fail first.
5. Test on both an iOS and an Android device.
6. Test at 0.5 m, 1 m, and 2 m.

If it locks slowly, loses tracking when the wearer moves normally, or fails in
dim light, the artwork needs more brightness contrast and more spread detail —
not a software change.

---

## Related tracking configuration

Runtime tracking behaviour is tuned in [`index.html`](../index.html), in the
`TRACKING` constant:

- `filterMinCF` / `filterBeta` — One Euro pose-smoothing filter. `filterBeta` is
  what lets the overlay catch up during motion; do not set it near zero.
- `warmupTolerance` — frames of consistent detection before the overlay shows.
- `missTolerance` — frames of loss tolerated before hiding it. Raised above
  MindAR's default because fabric drops frames constantly.

Camera resolution is capped separately, via `CAMERA_MAX_WIDTH` /
`CAMERA_MAX_HEIGHT` / `CAMERA_MAX_FPS`. MindAR processes every frame at whatever
resolution the browser hands back, so an unconstrained stream on a
high-resolution phone costs several times more per frame with no gain in
tracking quality. The cap uses `max`, so it only pulls devices down, never up.

To tune it against real hardware, open the page on the device with a console
attached and look for the line the viewer logs on startup:

```
[INRL] camera stream: 1280x720 @ 30fps
```

That is the resolution the tracker is actually working at. If a device reports
something well above the cap, the cap is not being applied; if performance is
still poor at 720p, lowering the cap toward 640×480 buys speed at the cost of
detection range.

The marker's aspect ratio is read from the compiled `.mind` file at runtime, so
the cover plane matches the print exactly; no manual aspect configuration is
needed.
