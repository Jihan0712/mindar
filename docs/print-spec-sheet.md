# Print spec sheet (Printful)

Make every design at the **full print area size below** and it will need no adjusting when you
create the product: the canvas *is* the print area, so a design that fills it fills the shirt.

Source: Printful's own data for each garment, read through the shop's admin API
(`/api/admin/printful/catalog/<id>/placements`) on 2026-11-19.

## How to export

| | |
|---|---|
| File type | **PNG**, transparent background (transparent prints nothing; any colour, even white, prints) |
| Resolution | **300 DPI** (Printful's minimum is 150 DPI; our QR step and print files work at 300) |
| Canvas | exactly the print area size below, e.g. 12 × 16 in = **3600 × 4800 px** |
| Colour | sRGB |
| QR | **leave it out of the design.** Each shirt gets its own QR; you place it in the dashboard's QR step (smallest 1 in, 1.4–1.5 in scans comfortably). It can go anywhere, **over the art too**: it prints on top. Over busy or dark art, use **Black on white** (the QR brings its own white square); a coloured QR has a see-through background, so use it only on a plain area of the art |

## T-shirt: Bella + Canvas 3001ECO, Unisex Staple Eco T-Shirt (Printful 760)

Used by: **Fingerprints Tee**, **INRL BETA**, Coffee Shirt (draft).

| Placement | Print area (in) | At 300 DPI (px) | Printful minimum, 150 DPI (px) | Extra cost |
|---|---|---|---|---|
| **Front** | **12 × 16** | **3600 × 4800** | 1800 × 2400 | included |
| **Back** | **12 × 16** | **3600 × 4800** | 1800 × 2400 | +$5.95 |
| Left sleeve | 4 × 3.5 | 1200 × 1050 | 600 × 525 | +$2.49 |
| Right sleeve | 4 × 3.5 | 1200 × 1050 | 600 × 525 | +$2.49 |
| Outside label | 3 × 3 | 900 × 900 | 450 × 450 | +$2.49 |
| Inside label | 3 × 3 | 900 × 900 | 450 × 450 | +$0.99 |
| Inside label (small style) | 3 × 1.13 | 900 × 339 | (300 DPI required) | +$0.99 |

All printed by DTG (direct to garment).

## T-shirt: Gildan 64000, Unisex Basic Softstyle T-Shirt (Printful 12)

Used by: **Coffee Shirt** (published).

| Placement | Print area (in) | At 300 DPI (px) | Printful minimum, 150 DPI (px) | Extra cost |
|---|---|---|---|---|
| **Front** | **12 × 16** | **3600 × 4800** | 1800 × 2400 | included |
| **Back** | **12 × 16** | **3600 × 4800** | 1800 × 2400 | +$5.95 |
| Left sleeve | 4 × 3.5 | 1200 × 1050 | 600 × 525 | +$2.49 |
| Right sleeve | 4 × 3.5 | 1200 × 1050 | 600 × 525 | +$2.49 |
| Outside label | 3 × 3 | 900 × 900 | 450 × 450 | +$2.49 |
| Inside label | 3 × 3 (or 3 × 1.13) | 900 × 900 (900 × 339) | 450 × 450 | +$0.99 |
| Left chest, embroidery | 4 × 4 | 1200 × 1200 | (300 DPI required) | +$2.95 |
| Center chest, embroidery | 4 × 4 | 1200 × 1200 | (300 DPI required) | +$2.95 |

Printful also lists DTF ("large front/back print") versions of this shirt; their sizes weren't in
the data returned, so check Printful's editor before using them.

## Hoodie: Gildan 18500, Unisex Heavy Blend Hoodie (Printful 146)

Used by: **Unisex Hoodie**.

| Placement | Print area (in) | At 300 DPI (px) | Printful minimum, 150 DPI (px) | Extra cost |
|---|---|---|---|---|
| **Front** | **14 × 14** (square: the pocket sits below it) | **4200 × 4200** | 2100 × 2100 | included |
| **Back** | **12 × 16** | **3600 × 4800** | 1800 × 2400 | +$5.95 |
| Left sleeve | 3 × 12 (tall) | 900 × 3600 | 450 × 1800 | +$5.95 |
| Right sleeve | 3 × 12 (tall) | 900 × 3600 | 450 × 1800 | +$5.95 |
| Outside label | 3 × 3 | 900 × 900 | 450 × 450 | +$2.49 |
| Inside label (DTF) | 3 × 3 (or 3 × 1.13) | 900 × 900 (900 × 339) | 450 × 450 | +$0.99 |
| Left chest, embroidery | 4 × 4 | 1200 × 1200 | (300 DPI required) | +$2.95 |
| Center chest, embroidery | 4 × 4 | 1200 × 1200 | (300 DPI required) | +$2.95 |

## Quick reference

- **Any of our T-shirts, front or back:** 12 × 16 in → **3600 × 4800 px**.
- **Hoodie front:** 14 × 14 in → **4200 × 4200 px**. **Hoodie back:** 3600 × 4800 px.
- A design narrower than the canvas prints narrower on the shirt. To make it smaller on purpose,
  keep the full canvas and leave transparent space, rather than exporting a smaller file.
- Costs are Printful's extra charge per placement on top of the garment, as listed in their
  catalog on 2026-11-19; Printful can change them.
