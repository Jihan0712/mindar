# Per-shirt QR printed at order time

Date: 2026-10-02
Status: implemented 2026-10-06

## Goal

When a customer buys a shirt, generate a QR code unique to that physical shirt and print it
on the shirt as part of the Printful order. Anyone who scans the QR lands on that exact
shirt's AR. This replaces the "register a piece" flow (claiming a shirt by typing or scanning
a tag code).

## Decisions

| Question | Decision | Source |
|---|---|---|
| Who scans the QR, where is it printed | Anyone; visible on the outside, near the print | User |
| Ownership for buyers without an account | Account required to check out, every piece is owned from payment | User |
| How the QR reaches Printful | Approach A: our dashboard holds the print files; every order is a Printful catalog order with the art layer plus a per-shirt QR layer | User |
| Resale / transfer of a piece | Out of scope. A piece stays with the buying account; the admin moves one by hand if ever needed | Assumption, accepted |
| QR look | Fingerprint emblem: classic square modules merged into solid blocks (2026-10-12, replacing the 2026-10-07 maze strokes) and rounded eyes inside broken concentric rings, all generated from the shirt's link; black on a white backing shaped like the outer ring, transparent outside | User |

## Non-goals

- Owner-to-owner transfer of a piece.
- Changing the AR marker or how the viewer tracks it.
- Email sending or verification.
- Brand-role changes (brands keep uploading the product's default video).

## End-to-end flow

1. Admin, once per product: link the product to Printful. Importing a product designed on
   printful.com now also copies its art files into R2 and records the catalog garment and
   catalog variants. Admin sets QR placement, size and position, previews the mockup, publishes.
2. Customer: must be logged in to check out. Stripe hosted checkout is unchanged.
3. Stripe `checkout.session.completed` webhook (already guarded by the "mark paid only if
   unpaid" lock, so it runs once per order):
   1. Mint one `garment_units` row per shirt, owned by `orders.user_id`, with `order_id`,
      `item_index` and `unit_index` set.
   2. For each unit on an AR product, generate its QR PNG and store it in R2 at
      `qr/<claim_code>.png`; save the URL on the unit.
   3. Create one Printful order with one item per shirt (quantity 1, `external_id` = unit
      id) and confirm it.
4. The shirt arrives with its QR. Scanning opens `https://<site>/p/<code>`, which redirects
   to `index.html?piece=<code>` (existing piece viewer). The owner sets what it plays on
   `piece.html`, unchanged.

## Data model

One migration, `sql/per_shirt_qr_migration.sql`, pasted into the D1 Console:

```sql
alter table products add column printful_qr text null;
alter table garment_units add column item_index integer null;
alter table garment_units add column unit_index integer null;
alter table garment_units add column qr_url text null;
create unique index if not exists idx_garment_units_order_slot
  on garment_units(order_id, item_index, unit_index);
```

Each shirt in an order has a slot `(order_id, item_index, unit_index)`, where `unit_index`
runs 0..qty-1 within the line. The unique index makes minting idempotent: re-running it for
an order inserts only the missing slots. SQLite treats NULLs as distinct, so pieces with no
order (none are created any more, but older rows exist) are unaffected.

- `products.printful_qr`: JSON
  `{ "placement": "back", "size_in": 1.5, "top_in": 12.0, "left_in": 5.25,
     "area_width_in": 12, "area_height_in": 16 }`.
  Area dimensions are saved from the catalog placements endpoint when the admin picks the
  placement, so the order payload never needs a Printful lookup.
- `products.printful_catalog_product_id` and `products.printful_variant_map` (both exist)
  are now also filled by the printful.com import.
- `products.printful_design_images` (exists) holds `{placement: R2 URL}` art files; the
  import fills it.
- `garment_units.order_id` (exists, never set until now) plus the new `item_index` and
  `unit_index` tie a unit to its slot in the order. `garment_units.qr_url` is the stored QR
  image.
- Minting for an order inserts each slot with a fresh claim code. A claim-code collision
  (31^8 codes, so essentially never) leaves that slot empty, and it is retried with a new
  code; an existing slot is skipped, never duplicated.
- `garment_units.claim_code` stays as the piece's public code. Nothing accepts it as proof
  of ownership any more, so it is no longer a secret.

## QR generation (in the Worker)

The Worker is a single file deployed without a bundler, so the encoder is inline.

- Byte mode, error correction level H (30%, headroom for the styling), smallest version 1-10
  that fits. A typical link `https://shop.inrl.co/p/ABCD-2345` (32 bytes) fits version 4
  (33x33 modules).
- Reed-Solomon over GF(256) with the standard generator polynomials and block structure.
- All 8 masks evaluated with the four standard penalty rules; lowest score wins. Format and
  version information written per the spec.
- PNG: the fingerprint emblem, 8-bit grey+alpha, drawn from signed distances with
  anti-aliased edges. Scanners sample only module centres, finder/alignment eyes and the
  margin, so: dark modules are crisp squares drawn as one exact union, so neighbours form
  solid blocks with no seam (`test/qr-emblem.test.mjs` checks every module centre and every
  shared edge); eyes are rounded squares; a 2-module light margin separates the code from broken
  concentric rings whose wobble, dash lengths and gaps are also seeded from the link. Ink
  never reaches within ~0.3 module of a light module's centre. Backing is white inside the
  outer ring, transparent outside. `size_in` is the whole emblem's width (the code is about
  half; admin default 2.5 in, minimum 2 in; the server still accepts 1 in for products saved
  earlier). Pixel size = `round(size_in * 300)`. Scanlines use filter type 0 and are
  compressed with `CompressionStream('deflate')` (zlib format, as PNG requires); CRC-32
  computed inline.
- The physical size sent to Printful is recomputed from the final pixel width at 300 DPI.
- Public functions: `qrMatrix(text) -> { size, modules: Uint8Array }` and
  `qrPng(text, sizeIn) -> Promise<Uint8Array>`.

## Printful order payload

Every item goes to `POST /v2/orders` as a catalog item:

```js
{
  source: 'catalog',
  external_id: '<unit id>',            // or '<order id>-<line>' for non-AR lines
  catalog_variant_id: <from printful_variant_map[size]>,
  quantity: 1,                          // AR lines: one item per shirt
  placements: [
    { placement: 'back', technique: 'dtg', layers: [
        { type: 'file', url: '<art R2 URL>' },
        { type: 'file', url: '<qr R2 URL>',
          position: { area_width, area_height, width, height, top, left } } ] },
    { placement: 'front', technique: 'dtg', layers: [ { type: 'file', url: '<front art>' } ] },
  ],
}
```

- Lines for products without an AR target: one item with the line's quantity and no QR.
- If the QR placement has no art file, it becomes its own placement containing only the QR.
- Printful allows up to 5 layers per placement; we use at most 2.
- The v1 Sync Product order path (`submitPrintfulOrderV1`) is removed. All orders use v2.
- Order is created then confirmed, as today.

## Printful.com import (`link-sync`) additions

For the chosen sync product, the import additionally:

- reads each sync variant's catalog `variant_id` and the product's catalog `product_id`
  and stores them in `printful_variant_map` / `printful_catalog_product_id`;
- copies each print file (every `files[]` entry except type `preview`) into R2 at
  `products/<id>/art-<placement>.png`, mapping Printful's `default` type to `front`, and
  stores the map in `printful_design_images`;
- returns what it copied so the admin sees it immediately.

Products imported before this change must be re-imported once.

## Checkout rules

`POST /api/checkout/session`:

- 401 without a logged-in session.
- Refuses ("Not available for purchase yet") any line whose product lacks a catalog variant
  for that size, lacks art, or has an AR target but no `printful_qr`.

## Failure handling

- QR generation or Printful submission failure: the order keeps `payment_status = 'paid'`,
  `printful_status = 'error'`, and the error is logged with the order id.
- New `POST /api/admin/orders/:id/resubmit` (admin): rebuilds the Printful order from the
  order's existing units (generating any missing QR), submits and confirms. It never mints
  units, so it cannot duplicate shirts. Refused if the order already has a confirmed Printful
  order.

## Admin UI (dashboard.html, Printful tab, per product)

_Rewritten 2026-10-12 by /plan-design-review (Issue 16). "Built" is shipped code; "Approved"
is decided in that review and not built yet._

**QR placement window** (Printful tab → QR placement; shown once the product has an AR target
and a Printful garment, which stays required: Issue 14 kept it):
- Built: placement select with its print area from `GET /api/admin/printful/catalog/:id/placements`;
  emblem width 2 to 6 in (default 2.5); top and left in inches; "Centre horizontally"; a
  to-scale stage with the placement's art fitted whole and centred; the QR box drags and
  resizes (square, ≥2 in, inside the area, 0.05 in snap); "Upload print file" per placement;
  Save writes `printful_qr` including the `art` box; a "Re-place QR" chip when the art changed.
- Approved (Issue 1): stage first, as tall as the modal allows, with a 4× close-up of the slot;
  number fields collapse under "Exact values".
- Approved (Issue 2): the QR box is outline-only by default (slot visible through it), with a
  toggle that draws a real sample emblem at the placed size.
- Approved (Issue 8, built; magenta handling per eng review 2 D4): the art marks the slot
  with a solid #FF00FF disc (PNG only). On load the placer finds it and snaps the QR to it,
  0.03 in larger on every side so the emblem's opaque white disc hides the marker; the
  print file is stored as uploaded. Errors: "No slot found", "Slot is under 2 in", "Slot is not round". No pre-filled
  default numbers before a slot is found.
- Approved (Issue 6): an uploaded file is a draft; Save commits art and placement together;
  Cancel discards the draft.
- Approved (Issue 5): Save is disabled with the reason shown until the art has loaded and
  passed a canvas read test ("No print file", "This file can't be used for print files,
  re-upload it").
- Approved (Issue 13): the QR box is focusable; arrows move 0.05 in, Shift+arrows 0.25 in,
  +/− resize by 0.05 in; teal focus ring; position and status announced (aria-live).
- Approved (Issue 15): when the product's AR marker was compiled from a different file than
  the current print file, the placer and product list show "AR marker out of date".
- "Preview" asks Printful for a mockup with a sample QR (`SAMP-LE00`): it checks garment
  placement only. It is not the per-shirt proof (each customer's emblem differs).

**Orders → Shirts** (per order):
- Built: Mark paid (self-fulfil) / Generate missing QR codes; Resubmit to Printful on paid
  Printful orders with `printful_status = 'error'` (never on self orders); per shirt QR
  thumbnail and Print file (300 DPI PNG of art plus that shirt's QR).
- Approved (Issue 4): placement and art are frozen on the order at payment; print files and
  resubmits use the frozen copy; "Product placement changed since this order" when they differ.
- Approved (Issue 3): a per-shirt proof panel before download: the composed file large with
  zoom on the QR, shirt code, order line, size, owner, inches and DPI.
- Approved (Issue 10): the proof decodes the composed file in the browser and enables Download
  only when it reads that shirt's exact link ("Reads https://shop.inrl.co/p/K7QX-9MPZ ✓").
- Approved (Issue 11): "Print at 100% / Actual size, not Fit to page" beside Download, and a
  paper test sheet: this QR at true size, a 1 in / 25 mm ruler, the slot's corner marks.
- Approved (Issue 17): file name `<order>-L<line>-S<shirt>-<size>-<code>-<placement>.png`; the
  same label is printed on the test sheet.
- Approved (Issue 7): a shirt with no QR or no print file shows the cause and a link to the
  fix ("No QR: PUBLIC_SITE_URL not set", "No print file: save QR placement").
- Approved (Issue 12): "Verify printed shirt" scans a pressed shirt from the dashboard, shows
  code, order, line, size and owner, marks it verified; admin scans don't count toward
  `scan_count`.

**Emblem** (Issue 9, approved): the white disc's outer edge is an exact circle on every
emblem, so it fills a round slot edge to edge; the rings inside keep their per-customer
wobble. This changes the rim of the user's reference image, whose outer edge wobbles.

## Customer UI

- `checkout.html`: not logged in, go to `login.html?next=checkout.html` (bag kept).
- `wardrobe.html`: remove the three "Register a piece" links and the add card; empty state
  says pieces appear here after a purchase.
- `ecommerce/js/app-rail.js`: remove the "Register a piece" item.
- `piece.html`: show the stored QR image (`qr_url`) and the `/p/<code>` link instead of
  drawing a QR in the browser.
- `ecommerce/register-piece.html`: deleted.

## Removed endpoints and code

- `POST /api/pieces/claim`, `GET /api/pieces/lookup`,
  `POST /api/admin/products/:id/pieces/generate`.
- Owner lookup by email in `provisionGarmentUnitsForOrder` (every order now has `user_id`).
- `submitPrintfulOrderV1` and the v1 branch of `submitPrintfulOrder`.

## Routing and config

- `_redirects`: `/p/:code /index.html?piece=:code 302`.
- New Worker variable `PUBLIC_SITE_URL` (for example `https://shop.inrl.co`), used to build
  the QR link. Falls back to the webhook request's origin.
- `apiGetPiece.viewer_url` becomes `<PUBLIC_SITE_URL>/p/<code>`.

## Testing

QR encoder, run in the built-in browser pane against the `qrcode@1.4.4` library the site
already loads in `piece.html`:

- For a set of strings (short, the real link format, 1-10 version boundaries), force the
  same version, level H and each mask; module matrices must be identical.
- Decompress the generated PNG and check every pixel against the matrix, including the quiet
  zone and the module scale.

Order pipeline, in the existing D1-on-SQLite harness with Printful `fetch` and R2 mocked:

- Anonymous checkout gets 401.
- AR product without `printful_qr` is refused at checkout.
- Paid webhook: units minted with `order_id`, `item_index`, `unit_index`, `owner_user_id`; one QR object
  per unit in R2; Printful payload has one item per shirt with art layer, QR layer and
  position, `external_id` = unit id; quantity 2 gives 2 items.
- Non-AR line: one item, quantity kept, no QR.
- Duplicate Stripe delivery prints once.
- Printful failure marks `printful_status = 'error'`; resubmit reuses units, mints nothing,
  and is refused once confirmed.
- `/api/pieces/claim`, `/lookup`, `/generate` return 404.

Not testable here, done by the owner before opening sales: one Preview on a real product,
then one real single-shirt order shipped to the owner.

## Rollout

1. Paste `sql/per_shirt_qr_migration.sql` in the D1 Console.
2. Set `PUBLIC_SITE_URL` on the Worker.
3. Deploy the Worker and site (including `_redirects`).
4. Re-import each printful.com product.
5. Set QR settings and Preview each AR product.
6. One real test order.

## Risks

- The print file stored on printful.com may not carry the exact on-shirt position set in
  Printful's designer. Mitigation: upload a print-ready art file at the print area's exact
  size (the art box then fixes its position); the Printful Preview checks garment placement
  with a sample QR, and the per-shirt proof (Admin UI) checks each real shirt.
- Exact field names on Printful v1 sync variants (`variant_id`, `product.product_id`,
  `files[].type`, `files[].url`) are confirmed on the first re-import, which reports what it
  copied.
- Each shirt becomes its own Printful item. Printful pricing is per item, so this does not
  change cost, but very large quantities make larger order payloads.

---

# Eng review 2026-10-12: applying this spec to the INRL fingerprint poster

Target: this spec (`docs/superpowers/specs/2026-10-02-per-shirt-qr-design.md`), reviewed by
/plan-eng-review against the user's poster design (fingerprint art, INRL bar, round QR emblem
bottom-right) and the live site `shop.inrl.co`. Everything above this line is the original
plan, unchanged.

User ask: put this design on a shirt and replace the bottom-right QR with each customer's own
per-shirt QR; is that live now?

## Scope record

Scope Challenge B skipped: proposed work touches fewer than 8 files (estimated 0 to 3:
`cloudflare/worker/index.js`, `ecommerce/dashboard.html`, `docs/AR-MARKER-PRINT-GUIDE.md`,
depending on answers) and adds no new classes or services. Scope accepted as-is.

## Decision ledger

### R1: emblem print width for this design's QR slot
Finding: S1, P1, confidence 8/10, `ecommerce/dashboard.html:1009` (`min="2" max="6" value="2.5"`) and spec line 100-103 ("admin default 2.5 in, minimum 2 in"), Scope Challenge.
Plan baseline: spec sets admin default 2.5 in, minimum 2 in (server accepts 1 in for older products, `cloudflare/worker/index.js:2246`).
Runtime evidence: the emblem in the supplied design spans about 86 of 849 px, about 10% of the width [estimated from the image]. On a 12 x 16 in print area fitted to height the poster is about 11.3 in wide, so the emblem would be about 1.1 in and the code inside it about 0.55 in [estimated].
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 emblem width | design ~1.1 in, pending | 2.5 in | 2.0 in | ~1.1 in |
| R2 emblem colours | black on white disc, pending | pending | pending | pending |
| R3 art fit in print area | Printful default fit, pending | pending | pending | pending |
Question D1:
D1 — The QR slot in this design is too small to scan reliably
Project/branch/task: main; applying the per-shirt QR spec to the INRL fingerprint poster.
ELI10: The round QR in the bottom-right corner is about 10% of the poster's width. Printed on a 12-inch-wide area that is about 1.1 inches across, and the part a phone actually reads is only the middle half, about half an inch. The generator was built for an emblem of at least 2 inches (code about 1 inch), because DTG ink on cotton spreads and small squares blur together.
Stakes if we pick wrong: shirts ship with a QR phones can't read, so the buyer's AR never opens and every printed shirt is wasted.
Recommendation: A because it keeps the code at the size the generator was built for and needs no code change.
Completeness: A=9/10, B=7/10, C=3/10
Pros / cons:
A) Enlarge slot to 2.5 in (recommended)
  ✅ Matches the dashboard default, so the scan margin the spec planned for is kept intact
  ✅ No code change: only the art file and the saved QR placement change
  ❌ The corner element grows to about a fifth of the poster width, a visible design change
B) Enlarge slot to 2.0 in
  ✅ Smallest change to the design that still meets the dashboard's own minimum size
  ✅ No code change: only the art file and the saved QR placement change
  ❌ Less margin for low light, worn fabric and older phone cameras than the 2.5 in default
C) Keep the current ~1.1 in
  ✅ The design stays exactly as drawn, with no change to the corner layout at all
  ✅ The server still accepts 1 in, so it can be saved through the API directly
  ❌ Code about 0.55 in wide on cotton; a large share of shirts will likely not scan
Net: a bigger corner emblem versus a QR that may not work on the shirt.
Header: QR size
Options:
A) Enlarge slot to 2.5 in (recommended)
Redesign the bottom-right slot so the emblem prints 2.5 in wide (about 21% of a 12 in print width). Export the art with that area empty. No code change. Human ~1 h design / CC: none.
B) Enlarge slot to 2.0 in
Slot prints 2.0 in wide (about 17% of width), the dashboard minimum. No code change. Less scan margin than the default.
C) Keep the current ~1.1 in
Keep the design as drawn; save 1.1 in through the API since the dashboard blocks under 2 in. Code about 0.55 in; high risk of unreadable shirts.

State: approved
Actual answer: A) Enlarge slot to 2.5 in (D1, 2026-10-12)
Accepted scope: redesign the bottom-right slot so the emblem prints 2.5 in wide; export the art with that area empty; save printful_qr.size_in = 2.5. No code change.
History: none

Scope Challenge required steps (no alternative, recorded as findings, no question):
- S2, P1, confidence 9/10, `cloudflare/worker/index.js:2264` (`placement, technique: 'dtg', layers: [{ type: 'file', url }]`) and `:2268` (`target.layers.push(qrLayer.layer)`): the art layer prints under the shirt's QR in the same placement, so the uploaded art must not contain the sample QR.
- S3, P2, confidence 7/10, `docs/AR-MARKER-PRINT-GUIDE.md:23` ("It tracks corners, not shapes"): compile the AR marker from the same empty-slot art, since every shirt's QR differs.
- S4, P1, confidence 9/10, live probe 2026-10-12: `/p/TEST-0000` 302 to `/viewer?piece=TEST-0000`; `/api/checkout/session` 401 "Sign in to check out."; only published product id 17 has `ar_target_id=44`, `printful_qr=null`, no `printful_design_images`, so checkout refuses it.

### R2: emblem colours on this design
Finding: A1, P2, confidence 9/10, `cloudflare/worker/index.js:882` ("Black ink on a white backing shaped like the outer ring") and `:909` (`ihdr[9] = 4`, grey+alpha PNG), Architecture.
Plan baseline: spec decision "black on a white backing shaped like the outer ring, transparent outside" (spec line 21, user 2026-10-07).
Runtime evidence: the generator only writes grey+alpha, so it cannot produce the teal emblem shown in the design. On this black poster it prints as a white disc with a black code.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 emblem width | 2.5 in, approved D1 | 2.5 in | 2.5 in | 2.5 in |
| R2 emblem colours | black on white disc (spec) | black on white disc | dark ink on coloured light disc (new colour options) | teal code on black, inverted (new colour options) |
| R3 art fit in print area | Printful default fit, pending | pending | pending | pending |
Question D2:
D2 — The generated QR is black on a white disc, your design shows teal on black
Project/branch/task: main; applying the per-shirt QR spec to the INRL fingerprint poster.
ELI10: Each shirt's QR is drawn by the server as black lines on a white circle. Your mock has a teal emblem sitting straight on the black poster. Phone cameras read dark-on-light QR codes reliably; light-on-dark ("inverted") codes are read by some camera apps and missed by others. Matching the teal look needs a colour option added to the generator.
Stakes if we pick wrong: either the corner looks off-brand (a white disc on a black poster) or some buyers' phones can't open their AR at all.
Recommendation: A because the spec already chose this look and dark-on-light gives the most scans, with no code change.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Black on white disc (recommended)
  ✅ Highest scan rate: dark code on a light disc is what every camera app reads first
  ✅ No code change; already live and already the spec's chosen look since 2026-10-07
  ❌ Prints as a white circle on the black poster, not the teal emblem from the mock
B) Dark code on a teal disc
  ✅ Gets the teal brand colour into the corner while staying dark-on-light for scanners
  ✅ Colours saved per product in printful_qr, so other designs can choose their own pair
  ❌ New code in the PNG writer and dashboard plus tests (human ~1 day / CC ~30 min)
C) Teal code on black (inverted)
  ✅ Matches the mock exactly: teal lines sitting straight on the black poster background
  ✅ Same colour option code as B, so the look is configurable per product afterwards
  ❌ Inverted QR codes fail on some phones' camera apps; that buyer's AR never opens
Net: brand look in the corner versus how many phones can read it.
Header: QR colours
Options:
A) Black on white disc (recommended)
Keep the generator as is: black code on a white disc, transparent outside. No code change. The corner prints as a white circle on the black poster.
B) Dark code on a teal disc
Add ink and backing colour options (RGBA PNG) saved in printful_qr and the dashboard, with a scan/pixel test. Human ~1 day / CC ~30 min.
C) Teal code on black (inverted)
Same colour option work as B, used inverted: teal code, no backing. Matches the mock; some phones will not read it.

State: approved
Actual answer: A) Black on white disc (D2, 2026-10-12)
Accepted scope: keep the generator as is (black code on a white disc, transparent outside). No code change. The design's slot should be drawn to frame a white 2.5 in disc.
History: none

### R3: how the art is placed in the print area
Finding: A2, P2, confidence 6/10 (Printful's default fit for a layer without `position` is not verified here), `cloudflare/worker/index.js:2264` (`layers: [{ type: 'file', url }]`, no position) versus `:2281` (QR layer `position: { area_width, area_height, width, height, top, left }`), Architecture.
Plan baseline: spec risk "The print file stored on printful.com may not carry the exact on-shirt position ... Mitigation: the Preview renders exactly what will be printed" (spec line 239-241).
Runtime evidence: the supplied poster is 849 x 1199 px (aspect 0.708) [measured: image]; a 12 x 16 in area is 0.75 [estimated: common DTG front area, actual from the placements endpoint]. QR top/left are inches from the print area's corner, so any gap Printful leaves around the art shifts the QR off the slot.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 emblem width | 2.5 in, approved D1 | 2.5 in | 2.5 in | 2.5 in |
| R2 emblem colours | black on white disc, approved D2 | black on white disc | black on white disc | black on white disc |
| R3 art fit | art layer sent without position | art exported at the print area's exact aspect and 300 DPI; QR measured on that file; Preview confirms | new art-box position saved per placement and sent on the art layer (code + dashboard + test) | no change; adjust QR top/left by trial in Preview |
Question D3:
D3 — The QR position depends on how Printful fits your poster into the print area
Project/branch/task: main; applying the per-shirt QR spec to the INRL fingerprint poster.
ELI10: The art goes to Printful with no position, so Printful decides how to fit it. Your poster is a little narrower than a typical 12 x 16 inch print area. The QR's spot is measured from the print area's top-left corner, not the poster's, so if Printful centres the poster with gaps at the sides, a spot you measured on the poster lands slightly off the slot.
Stakes if we pick wrong: every shirt's QR prints shifted, overlapping the INRL bar or sitting off its frame.
Recommendation: A because it makes poster inches equal print-area inches with no code change, and the Preview checks it.
Completeness: A=8/10, B=9/10, C=5/10
Pros / cons:
A) Art at exact print-area size (recommended)
  ✅ Poster inches equal print-area inches, so measured QR top/left are exact
  ✅ No code change; the existing Preview mockup confirms it before any real order
  ❌ The art must be re-exported per garment if the print area size differs
B) Send an explicit art position
  ✅ Full control of art size and placement inside the print area for any file shape
  ✅ Removes the dependence on Printful's unverified default fit for position-less layers
  ❌ New saved fields, dashboard inputs and tests (human ~1 day / CC ~45 min)
C) Tune top/left in Preview only
  ✅ Nothing to build and nothing to re-export; works with the art file as it is now
  ✅ Preview already renders the art plus a sample QR exactly as it will print
  ❌ Trial and error per product, and easy to leave a small offset nobody notices
Net: one careful export versus new placement code versus guessing in the preview.
Header: Art fit
Options:
A) Art at exact print-area size (recommended)
Export the art at the placement's exact print area (e.g. 3600 x 4800 px for 12 x 16 in at 300 DPI), with the empty 2.5 in slot. Measure QR top/left on that file; confirm in Preview. No code change.
B) Send an explicit art position
Save an art box per placement and send it as the art layer's position in printfulPlacements, with dashboard inputs and a payload test. Human ~1 day / CC ~45 min.
C) Tune top/left in Preview only
Upload the art as is and nudge QR top/left until the Preview mockup looks right. No code change; trial and error.

State: approved
Actual answer: A) Art at exact print-area size (D3, 2026-10-12)
Accepted scope: export the art at the chosen placement's exact print area at 300 DPI (read area_width/area_height from the dashboard's placement picker), with the empty 2.5 in slot; measure QR top/left in inches on that file; confirm with Preview before any real order. No code change.
History: Superseded 2026-10-12: the user asked for all four placement fixes, so the QR placer now saves the art's box and sends it to Printful as the art layer's position (`artLayerPosition`, `printFileSpec`). The export rule still holds; "no code change" no longer does. See Admin UI.

### R4: what the QR link uses when PUBLIC_SITE_URL is not set
Finding: A3, P2, confidence 7/10, `cloudflare/worker/index.js:2525-2528` (`publicSiteBase`: `const configured = String(globalThis.PUBLIC_SITE_URL || '')...` then `return request ? new URL(request.url).origin : ''`), Architecture.
Plan baseline: spec "New Worker variable PUBLIC_SITE_URL ... Falls back to the webhook request's origin" (spec line 198-199).
Runtime evidence: whether PUBLIC_SITE_URL is set on the live Worker is unknown (not readable from outside). The fallback is the Stripe webhook request's host, which is whatever URL the Stripe endpoint was registered with.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 emblem width | 2.5 in, approved D1 | 2.5 in | 2.5 in |
| R2 emblem colours | black on white disc, approved D2 | black on white disc | black on white disc |
| R3 art fit | exact print-area export, approved D3 | exact print-area export | exact print-area export |
| R4 missing PUBLIC_SITE_URL | QR encodes the webhook's host | QR generation refuses; order marked printful_status error until set, then admin resubmits | unchanged fallback; owner checks the variable before the first sale |
Question D4:
D4 — Without PUBLIC_SITE_URL, printed QRs encode whatever host Stripe called
Project/branch/task: main; applying the per-shirt QR spec to the INRL fingerprint poster.
ELI10: Each QR is printed permanently on a shirt, so its link can never be fixed later. The link comes from the PUBLIC_SITE_URL setting; if that setting is missing, the server quietly uses the address Stripe used to reach it, which might be a workers.dev or old address. Nobody can tell from outside whether the setting is there on the live Worker.
Stakes if we pick wrong: a batch of shirts ships with QRs pointing at a host that later stops working, and those shirts' AR is gone for good.
Recommendation: A because a printed link is permanent, so failing loudly beats a silent guess (explicit over clever).
Completeness: A=9/10, B=6/10
Pros / cons:
A) Require it, refuse without (recommended)
  ✅ No shirt is ever printed with a guessed host; the order waits visibly with an error
  ✅ Existing Resubmit to Printful button recovers the order once the setting is added
  ❌ Small code change plus one test (human ~1 h / CC ~10 min), and a sale can wait on config
B) Keep the fallback, check once
  ✅ No code change; fine as long as the setting is confirmed before the first real sale
  ✅ Works today if Stripe already calls shop.inrl.co directly, which is the documented route
  ❌ A later config slip (new Worker, renamed variable) silently prints wrong links again
Net: a one-line guard against permanent bad prints versus relying on a manual check.
Header: Site URL
Options:
A) Require it, refuse without (recommended)
publicSiteBase returns nothing without PUBLIC_SITE_URL; ensureOrderQrs throws, the order gets printful_status error, admin resubmits after setting it. One test. Human ~1 h / CC ~10 min.
B) Keep the fallback, check once
No code change. Confirm PUBLIC_SITE_URL = https://shop.inrl.co in the Worker settings before the first real order.

State: approved
Actual answer: A) Require it, refuse without (D4, 2026-10-12); guard placement narrowed by D5 A
Accepted scope: printed QRs require PUBLIC_SITE_URL: ensureOrderQrs throws when it is unset, so the order gets printful_status 'error' and no QR is stored; admin resubmits after setting it. One test. publicSiteBase itself is unchanged (D5 A).
History: D4 option text said "publicSiteBase returns nothing without PUBLIC_SITE_URL"; reopened by R5 because that also changes the piece page and admin links; D5 A keeps the guard in ensureOrderQrs only.

### R5: regression contract for the other publicSiteBase callers
Finding: T1, P2, confidence 9/10, Test review (regression rule). `publicSiteBase` is also called by `apiGetPiece` (`viewer_url: pieceLink(publicSiteBase(request), unit.claim_code)`, `cloudflare/worker/index.js` apiGetPiece) and `apiAdminOrderPieces` (`link: pieceLink(base, r.claim_code)`, `:2894`).
Plan baseline: D4 A approved "publicSiteBase returns nothing without PUBLIC_SITE_URL".
Runtime evidence: today, without the variable, those two endpoints return absolute links on the request's host; with D4 A as worded they would return relative `/p/<code>` links.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 missing PUBLIC_SITE_URL | QR refuses, approved D4 | QR refuses | QR refuses |
| R5 piece/admin links without the variable | absolute on request host | unchanged: piece page and admin keep request-host links; only QR generation requires the variable | relative `/p/<code>` links in piece page and admin |
| R5 with the variable set | absolute on PUBLIC_SITE_URL | unchanged | unchanged |
Question D5:
D5 — Should the D4 guard change the piece page and admin links too?
Project/branch/task: main; applying the per-shirt QR spec to the INRL fingerprint poster.
ELI10: The same helper that builds the QR link also builds the link shown on the customer's piece page and in the admin's order view. Those links are only shown on screen, never printed, so a fallback there is harmless. The D4 guard can be placed so it only stops QR printing and leaves the on-screen links exactly as they work today.
Stakes if we pick wrong: the piece page and admin links quietly change shape, or the guard misses a path that prints.
Recommendation: A because it guards the one permanent output and keeps every on-screen link working as it does now.
Completeness: A=9/10, B=7/10
Pros / cons:
A) Guard only the printed QR (recommended)
  ✅ The guard sits in ensureOrderQrs, the only path whose output is printed permanently
  ✅ Piece page and admin links keep today's behaviour; tests assert they are unchanged
  ❌ Two code paths for the site base: one strict for printing, one lenient for display
B) Make the helper strict everywhere
  ✅ One strict helper: every link, printed or shown, comes from the same configured value
  ✅ A missing variable becomes visible on screens too, not only in failed orders
  ❌ Piece page and admin show relative /p/ links while unset, a visible behaviour change
Net: the narrowest guard on permanent output versus one strict rule for every link.
Header: Guard scope
Options:
A) Guard only the printed QR (recommended)
Leave publicSiteBase as is; ensureOrderQrs refuses when PUBLIC_SITE_URL is unset. Assertions: unset gives printful_status 'error' and no R2 QR object; set gives QR text https://shop.inrl.co/p/<code>; apiGetPiece viewer_url and admin links unchanged in both cases.
B) Make the helper strict everywhere
publicSiteBase returns nothing when unset (as D4 worded it); piece page and admin links become relative /p/<code> while unset. Same QR assertions as A, plus relative-link assertions.

State: approved
Actual answer: A) Guard only the printed QR (D5, 2026-10-12)
Accepted scope: leave publicSiteBase as is; ensureOrderQrs refuses when PUBLIC_SITE_URL is unset. Regression contract: unset gives printful_status 'error' and no R2 QR object; set gives QR text https://shop.inrl.co/p/<code>; apiGetPiece viewer_url and admin order-piece links unchanged in both cases.
History: none

### R6: where the R4/R5 test runs
Finding: T2, P2, confidence 9/10, Test review. `package.json` has only `dependency-cruiser` and no test script; `git ls-files` finds no test files. A node:sqlite D1 shim harness was used in earlier sessions but never committed (prior learning `mindar-d1-sqlite-shim`, 2026-10-01).
Plan baseline: R4/R5 approved "One test" with the R5 assertions.
Runtime evidence: no committed test runner in the repo.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4/R5 behaviour and assertions | approved D4, D5 | unchanged | unchanged |
| R6 test runner | none committed | Node's built-in node:test plus a small committed D1/R2 shim under test/, run with `node --test test/`; no new dependency | the same assertions run once by hand in a throwaway script and reported, nothing committed |
Question D6:
D6 — Where should the PUBLIC_SITE_URL guard's test live?
Project/branch/task: main; applying the per-shirt QR spec to the INRL fingerprint poster.
ELI10: The repo has no test runner checked in, so the D4/D5 guard's test needs a home. Node 24 already ships a test runner (node:test) and SQLite, so a small fake database and fake file store can be committed next to the test with nothing to install. The other route is to run the checks once by hand and keep nothing.
Stakes if we pick wrong: the guard can be removed by a later edit with nothing to catch it, and wrong links get printed again.
Recommendation: A because it uses only what Node already ships and the guard protects permanent prints.
Completeness: A=9/10, B=5/10
Pros / cons:
A) Commit node:test + shim (recommended)
  ✅ No new dependency: node:test and node:sqlite are built into the Node 24 already used
  ✅ The guard and both link contracts stay checked on every later edit, not just today
  ❌ A new test/ folder and shim to maintain (human ~3 h / CC ~20 min)
B) Run once by hand, commit nothing
  ✅ Nothing new to maintain in the repo; matches how this project has been verified so far
  ✅ Still proves the guard works before the first real order goes out
  ❌ Nothing stops a later edit from removing the guard without anyone noticing
Net: a small permanent test harness versus a one-off check.
Header: Test home
Options:
A) Commit node:test + shim (recommended)
Add test/qr-site-url.test.mjs with a minimal D1 (node:sqlite) and Map R2 shim, run with node --test test/; add a "test" script to package.json. Human ~3 h / CC ~20 min.
B) Run once by hand, commit nothing
Run the R5 assertions once in a scratch script against the worker and report the result; nothing committed.

State: approved
Actual answer: A) Commit node:test + shim (D6, 2026-10-12)
Accepted scope: add test/qr-site-url.test.mjs with a minimal D1 (node:sqlite) and Map-backed R2 shim (keeping customMetadata), run with `node --test test/`; add a "test" script to package.json. No new dependency.
History: none

### R7: TODO for QR rendering on the Stripe webhook path
Finding: P1-perf, P3, confidence 5/10 (Medium confidence, verify this is actually an issue: the Worker's CPU limit is unknown), Performance. `cloudflare/worker/index.js:887` (`const px = Math.max(64, Math.round(Number(sizeIn) * 300));`) and `apiStripeWebhook` (`await finalizeOrderPrintfulSubmission(orderId, request);` before `return new Response('OK', { status: 200 })`).
Plan baseline: spec renders every QR inside the paid-webhook handler (spec line 36-43).
Runtime evidence: a 2.5 in emblem is 750 x 750 = 562,500 pixels [measured: index.js:887], each with an atan2, a hypot and a distance function, per AR shirt, before Stripe gets its 200. Scale per order: qty x 562,500 pixel evaluations [estimated]. If the Worker hits its CPU limit mid-run, the order stays 'paid' with no printful_order_id; the dashboard already shows Resubmit for that state (`ecommerce/dashboard.html:2004`).
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R7 TODO | none | add TODO to TODO.md (Orders / fulfillment) | skip | build now in this change |
Question D7:
D7 — Add a TODO to move QR rendering off the Stripe webhook's response?
Project/branch/task: main; applying the per-shirt QR spec to the INRL fingerprint poster.
ELI10: When an order is paid, the server draws every shirt's QR pixel by pixel (about half a million pixels per shirt at 2.5 inches) and sends the Printful order, all before answering Stripe. A big order might run into the Worker's time limit. If it does, the order stays paid but unsent until an admin presses Resubmit, which already exists.
What: return Stripe's 200 after the paid lock and minting, and run QR rendering plus Printful submission in ctx.waitUntil (or a queue).
Why: bigger orders and bigger emblems can exceed the Worker CPU limit, leaving paid orders unsent until someone notices.
Context: index.js:887 sets the pixel count; apiStripeWebhook awaits finalizeOrderPrintfulSubmission before responding; the Resubmit button covers recovery today. Start by timing one 10-shirt order in the local shim.
Depends on / blocked by: knowing the Worker plan's CPU limit.
Stakes if we pick wrong: either a known risk is forgotten, or time is spent on something that never happens at this order size.
Recommendation: A because the risk is real but unmeasured, and recovery already exists, so recording it beats building it blind.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add to TODO.md (recommended)
  ✅ The risk and where to start are written down next to the other fulfillment follow-ups
  ✅ No code change now; Resubmit already recovers any order this would affect
  ❌ Large orders can still hit the limit until someone picks the TODO up
B) Skip it
  ✅ Nothing to track; one-shirt orders are far below any plausible limit
  ✅ Keeps TODO.md focused on problems that have actually been seen
  ❌ If a big order stalls, nobody will remember why or where to look
C) Build it now
  ✅ Removes the risk before the first big order instead of after it shows up
  ✅ Stripe gets its answer immediately, avoiding Stripe retry noise on slow orders
  ❌ Changes the payment path without a measured problem (human ~1 day / CC ~45 min)
Net: write down an unmeasured risk versus forget it versus fix it blind.
Header: Webhook TODO
Options:
A) Add to TODO.md (recommended)
Add the item under "Flow review follow-ups → Orders / fulfillment" in TODO.md with What/Why/Context/Depends on. No code change.
B) Skip it
Do not record it.
C) Build it now
Move QR rendering and Printful submission into ctx.waitUntil in this change, with a test. Human ~1 day / CC ~45 min.

State: approved
Actual answer: A) Add to TODO.md (D7, 2026-10-12)
Accepted scope: TODO item added under "Flow review follow-ups → Orders / fulfillment" in TODO.md. No code change.
History: none

Approval readiness: PASS. Checked R1 (D1 A), R2 (D2 A), R3 (D3 A), R4 (D4 A, narrowed by D5 A), R5 (D5 A), R6 (D6 A), R7 (D7 A). S2, S3, S4 are required steps or facts, not remedies.

## Is it live? (answer to the user)

The pipeline is live; this design is not sellable yet.

- Live on `shop.inrl.co` (probed 2026-10-12): `/p/<code>` redirects to the viewer, `/api/viewer/piece` answers, checkout requires sign-in. A paid order would mint shirts, render a QR per shirt and send a v2 catalog order with the QR layer.
- Not sellable: no product carries this design, and the one published product (id 17, "Unisex Hoodie") has no QR placement and no print art, so checkout refuses it.
- Not verifiable from outside: whether PUBLIC_SITE_URL is set on the Worker, and whether the uncommitted `cloudflare/worker/index.js` edits in the working tree (order ownership by user_id) are deployed.

## Working plan for this design (approved)

1. Redesign the bottom-right slot to hold a 2.5 in white disc (D1, D2). Leave it empty in the art.
2. Pick the garment and placement in the dashboard; read that placement's print area (area_width x area_height in inches).
3. Export the art at exactly that area at 300 DPI (for 12 x 16 in: 3600 x 4800 px), slot empty (D3, S2).
4. Compile the AR marker from that same file in the admin panel (S3).
5. Product setup: import from printful.com (or upload the art per placement), link the AR target, set QR placement = the art's placement, size 2.5 in, top/left = the slot's top-left corner in inches on that file. Preview. Publish.
6. Code: ensureOrderQrs refuses without PUBLIC_SITE_URL (D4, D5), with a committed node:test (D6). Set PUBLIC_SITE_URL = https://shop.inrl.co. Deploy the Worker.
7. One real single-shirt order to the owner; scan with an iPhone and an Android phone.

## Section results

Scope Challenge: S1 (P1, 8/10) slot too small → D1 A. S2 (P1, 9/10) art must not contain the sample QR → required step. S3 (P2, 7/10) marker from empty-slot art → required step. S4 (P1, 9/10) live status → reported above.

Section 1, Architecture:
- [P2] (confidence: 9/10) cloudflare/worker/index.js:882 — generator is black on white only; design shows teal on black. Dispositions: accepted D2 A (no change).
- [P2] (confidence: 6/10) cloudflare/worker/index.js:2264 — art layer has no position, so QR placement depends on Printful's fit. Medium confidence, verify this is actually an issue. Dispositions: accepted D3 A (exact print-area export).
- [P2] (confidence: 7/10) cloudflare/worker/index.js:2528 — QR link falls back to the webhook's host when PUBLIC_SITE_URL is unset. Dispositions: accepted D4 A, narrowed by D5 A.

Section 2, Code quality: No issues found. The dashboard's 2 in minimum against the server's 1 in floor is a documented difference (spec line 100-103).

Section 3, Tests:
- [P2] (confidence: 9/10) regression contract for publicSiteBase callers. Dispositions: accepted D5 A.
- [P2] (confidence: 9/10) package.json — no committed test runner. Dispositions: accepted D6 A (node:test + shim).

```
CODE PATHS                                              USER FLOWS
[+] cloudflare/worker/index.js                          [+] Admin sets up this design
  ├── ensureOrderQrs() (guard, D4/D5)                     ├── [GAP] manual: Preview shows QR in the slot
  │   ├── [GAP] PUBLIC_SITE_URL unset → throw, no R2 obj  └── [GAP] manual: marker from empty-slot art tracks
  │   └── [GAP] set → QR text https://shop.inrl.co/p/<c>  [+] Customer scans shirt
  ├── publicSiteBase() (unchanged)                        ├── [GAP] [→E2E] manual: real order scans (iOS + Android)
  │   └── [GAP] trailing slash trimmed                    └── [★★ live probe] /p/<code> → /viewer?piece=<code>
  ├── apiGetPiece viewer_url / apiAdminOrderPieces link   [+] Error states
  │   └── [GAP] unchanged with and without the variable   └── [GAP] order shows printful_status error, Resubmit works
  └── finalizeOrderPrintfulSubmission → Printful payload
      └── [GAP] art layer + QR layer at saved top/left

COVERAGE: 1/10 paths tested (live probe only) | Code paths: 0/6 | User flows: 1/4 (none automated)
QUALITY: ★★★:0 ★★:1 ★:0 | GAPS: 9 (1 E2E manual, 3 manual)
Legend: ★★★ behavior + edge + error | ★★ happy path | ★ smoke check | [→E2E] needs integration test
```

Proposed tests (approved by D5/D6): `test/qr-site-url.test.mjs` (node:test, D1 node:sqlite shim, Map R2 shim), one table-driven test covering unset / set / set-with-trailing-slash, asserting QR text, R2 object presence, printful_status, apiGetPiece viewer_url and admin piece links. Value cards in the Test Plan artifact `~/.gstack/projects/Jihan0712-ar-customizer/ryley-main-eng-review-test-plan-20261012-145054.md`. Tests made obsolete: none.

Section 4, Performance:
- [P3] (confidence: 5/10) cloudflare/worker/index.js:887 — 562,500 pixel evaluations per 2.5 in shirt inside the Stripe webhook before it responds; Worker CPU limit unknown. Medium confidence, verify this is actually an issue. Dispositions: accepted D7 A (TODO in TODO.md).

Outside voice: unavailable. Codex is not installed, and this session has no TaskOutput tool for the bounded native fallback. Missing coverage, not a clean result.

## NOT in scope

- Teal or inverted emblem colours: declined in D2; dark-on-light scans best.
- Explicit art-layer position in the Printful payload: declined in D3; the exact print-area export makes it unnecessary.
- Moving QR rendering off the webhook response: recorded as a TODO (D7), unmeasured.
- Making publicSiteBase strict for on-screen links: declined in D5.

## What already exists

- Per-shirt QR generation, storage and Printful v2 layering: `ensureOrderQrs`, `qrPng`, `buildPrintfulOrderItems`, `qrPrintLayer` in `cloudflare/worker/index.js`. Reused as is.
- QR placement editor with Preview mockup: `ecommerce/dashboard.html:2347` onward, `POST /api/admin/printful/products/:id/mockup`. Reused for D3's check.
- Placement print-area lookup: `GET /api/admin/printful/catalog/:id/placements`. Supplies the export size for D3.
- Resubmit to Printful: `POST /api/admin/orders/:id/resubmit`, button at `ecommerce/dashboard.html:2004`. Recovery for D4's refused orders.
- Marker compiler: `admin.html:1347`. Used for S3.

## Diagram: this design's path to a printed shirt

```
poster art (slot empty, print-area size, 300 DPI) ──┬──> products.printful_design_images[placement]
                                                    └──> admin.html compiler ──> targets.mind_url (S3)
dashboard QR placement {placement, 2.5 in, top, left, area} ──> products.printful_qr
paid Stripe webhook ──> mint garment_units ──> ensureOrderQrs
        PUBLIC_SITE_URL unset? ── yes ──> throw ──> printful_status 'error' ──> admin sets var ──> Resubmit
                              └─ no ──> qrPng(https://shop.inrl.co/p/<code>, 2.5) ──> R2 qr/<code>.png
──> placement layers [art, QR @ top/left] ──> Printful create + confirm ──> shirt
scan ──> /p/<code> ──> /viewer?piece=<code> ──> /api/viewer/piece ──> marker + owner's video
```

## Failure modes

| Path | Realistic failure | Test / handling | User sees |
|---|---|---|---|
| Art upload | sample QR left in the art | Preview (manual) | double QR on the shirt if Preview skipped |
| QR position | slot measured on a file of the wrong size | Preview (manual), D3 export rule | QR off the slot frame |
| PUBLIC_SITE_URL unset | QR would encode the webhook host | D4 guard + D6 test | admin sees printful_status error; customer's order waits |
| Webhook CPU limit on a big order | handler killed before Printful submit | none; Resubmit recovers | **critical gap**: silent until an admin opens the order (TODO D7) |
| Marker compiled with the sample QR | tracking weaker on every shirt | manual scan test | AR slow to lock or drifting |

Critical gaps: 1 (webhook CPU limit), tracked as the D7 TODO.

## Worktree parallelization strategy

Sequential implementation, no parallelization opportunity. The only code change is one Worker module plus its test; the rest is design and dashboard setup done by hand.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~1h / CC: n/a)** — artwork — Redesign the slot for a 2.5 in white disc and export at the exact print area, slot empty
  - Surfaced by: Scope Challenge S1/S2, D1 A, D2 A, D3 A
  - Files: the design source file (outside the repo)
  - Verify: exported PNG is area_width x 300 by area_height x 300 px, and the slot is empty
- [ ] **T2 (P2, human: ~10min / CC: n/a)** — AR marker — Compile the .mind from the T1 export
  - Surfaced by: Scope Challenge S3
  - Files: admin.html (use, no edit)
  - Verify: compiler's feature-point report; viewer locks onto a printed test sheet
- [x] **T3 (P1, human: ~30min / CC: ~10min)** — worker — ensureOrderQrs refuses without PUBLIC_SITE_URL
  - Surfaced by: Architecture A3, D4 A, D5 A
  - Files: cloudflare/worker/index.js
  - Verify: `node --test test/`
- [x] **T4 (P1, human: ~2h / CC: ~15min)** — tests — Add node:test with a D1/R2 shim covering the D5 contract
  - Surfaced by: Test review T1/T2, D6 A
  - Files: test/self-fulfil-qr.test.mjs, test/helpers/worker-harness.mjs, package.json (built 2026-10-12 as part of the self-fulfil path; run `npm test`)
  - Verify: `node --test test/` passes; fails if the T3 guard is removed
- [ ] **T5 (P1, human: ~20min / CC: n/a)** — config + deploy — Set PUBLIC_SITE_URL = https://shop.inrl.co and deploy the Worker
  - Surfaced by: Architecture A3, live status S4
  - Files: Cloudflare Worker settings
  - Verify: one test order's QR text starts with https://shop.inrl.co/p/
- [ ] **T6 (P1, human: ~30min / CC: n/a)** — product setup — Create the product with the T1 art, AR target from T2, QR 2.5 in at the slot; Preview; publish
  - Surfaced by: live status S4, D3 A
  - Files: ecommerce/dashboard.html (use, no edit)
  - Verify: Preview shows the QR disc inside the slot; checkout no longer says "Not available for purchase yet"
- [ ] **T7 (P1, human: ~1 week incl. shipping / CC: n/a)** — launch check — One real single-shirt order, scanned with iPhone and Android
  - Surfaced by: Test review critical path (manual E2E)
  - Files: none
  - Verify: both phones open that shirt's AR from the printed QR

_No new tasks from Code quality review._ Performance produced a TODO only (D7).

## Unresolved decisions

None.

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted (PLAN_REALITY line below), 2 unverified premises
- Architecture Review: 3 issues found
- Code Quality Review: 0 issues found
- Test Review: diagram produced, 2 gaps identified
- Performance Review: 1 issue found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user (added to TODO.md)
- Failure modes: 1 critical gap flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (not installed; no TaskOutput for native fallback)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 0/5 (D1, D3, D4, D5, D6 scored; no option scored 10/10)

## Reality rows

| premise | claim | file:line receipt | verdict |
|---|---|---|---|
| P1 | per-shirt QR routes are live | live probe 2026-10-12 (`/p/TEST-0000` 302, checkout 401) | true |
| P2 | no product is sellable with a QR yet | live `/api/products`: id 17 `printful_qr=null`, no art | true |
| P3 | generator is black on white only | index.js:882, :909 | true |
| P4 | dashboard minimum emblem is 2 in | dashboard.html:1009 | true |
| P5 | art layer is sent without position | index.js:2264 | true |
| P6 | QR link falls back to request origin | index.js:2525-2528 | true |
| P7 | Printful's fit for a position-less layer leaves side gaps | none | unverified |
| P8 | PUBLIC_SITE_URL is set on the live Worker | none | unverified |

unverified=2

REALITY: premise-table finding 8 premises, unverified=2 (P7, P8) index.js:2264
REALITY: already-done pass no commits since 2026-10-07 touch QR colour, size or site-URL guard (git log origin/main) index.js:2525
REALITY: surface-check pass /p/:code, /api/viewer/piece, /api/checkout/session probed live; mockup route in router index.js:1439
REALITY: binding-decisions pass no branch decisions logged; spec decision "black on white backing" kept by D2 spec:21
REALITY: numbers pass emblem 86/849 px [estimated: image], 750 px = 2.5 x 300 [measured: index.js:887], 3600 x 4800 [estimated: 12 x 16 area] index.js:887
REALITY: deferred-asks pass user asked "how" and "is it live"; both answered above docs/superpowers/specs/2026-10-02-per-shirt-qr-design.md:574
REALITY: pr-count pass default one PR (no .gstack/ship-policy.json); code change is T3+T4 only index.js:2535

## Suppressed findings (appendix)

- (confidence: 4/10) Teal/teal-on-black emblem might scan fine on current iOS and Android camera apps; not tested here, which is why D2 kept dark-on-light.
- (confidence: 3/10) The INRL bar's thin outline near the slot may pick up DTG bleed next to a white disc; check in the T7 print.

---

# Design review 2026-10-12: making each customer's QR land correctly

Target: this spec, reviewed by /plan-design-review against `ecommerce/dashboard.html` (QR
placement window, Orders → Shirts) and `cloudflare/worker/index.js` (`qrPng`, `printFileSpec`).
Question: what is the best way to make sure the QR placement on each customer's custom QR is
correct? Outside voice: an independent Claude subagent (Codex not installed). Mockups: not
generated (the gstack designer has no OpenAI key here).

## Answer

Make the art define the slot, make every emblem fit it identically, freeze the setup per
order, and prove each shirt before and after printing:

1. The design marks the slot (solid #FF00FF disc); the placer finds it and snaps the QR to it.
2. Every emblem's white disc has the same exact round edge, so it fills that slot on every shirt.
3. Placement and art are frozen on the order at payment, so later edits can't move sold shirts.
4. Each shirt's proof shows its composed file and must decode to its own link before Download.
5. A paper test sheet with a ruler catches printer scaling; a "Verify printed shirt" scan
   confirms the pressed shirt is the right customer's.

## Decisions (each individually approved)

| # | Issue | Decision |
|---|---|---|
| 1 | Placer too small to judge alignment | 1A stage first, large, 4× slot zoom |
| 2 | QR placeholder hides the slot | 2A outline by default + real sample emblem toggle |
| 3 | No per-shirt proof before printing | 3A proof panel before Download |
| 4 | Old orders change when placement is edited (critical) | 4A freeze placement + art per order |
| 5 | Save works with missing/unreadable art | 5A block Save until art is print-ready |
| 6 | Upload goes live before Save; Cancel doesn't undo | 6A upload is a draft until Save |
| 7 | "Not generated" gives no reason | 7A cause + fix per shirt |
| 8 | Slot defined twice by hand | 8A auto-detect a #FF00FF slot in the art |
| 9 | Emblem rim differs per customer | 9A exact round rim, wobble inside only |
| 10 | Composed file never scan-checked | 10A decode in browser, Download only on match |
| 11 | Printer may rescale the file | 11A paper test sheet + "Print at 100%" |
| 12 | No check of which pressed shirt is which | 12A "Verify printed shirt" scan |
| 13 | Drag-only placement | 13A keyboard nudge, focus ring, aria-live |
| 14 | Placer needs a Printful garment | 14B keep Printful required (user choice) |
| 15 | AR marker not tied to the print file | 15A warn "AR marker out of date" |
| 16 | Spec Admin UI section out of date | 16A rewritten above; D3 marked superseded |
| 17 | Print file names don't say which shirt | 17A `<order>-L<line>-S<shirt>-<size>-<code>-<placement>.png` |

## Information hierarchy (approved)

```
QR PLACEMENT WINDOW                         SHIRT PROOF (per shirt)
┌──────────────────────────┬────────────┐   ┌──────────────────────────┬──────────────┐
│ 1 Print area to scale    │ 2 Slot 4×  │   │ 1 Composed print file    │ 2 Code, line │
│   art + slot + QR outline│   close-up │   │   (art + this QR), zoom  │   size, owner│
│                          ├────────────┤   │                          ├──────────────┤
│                          │ 3 Status:  │   │                          │ 3 Reads link │
│                          │   slot found│  │                          │   ✓ / ✗      │
│                          │   art ready │  │                          ├──────────────┤
│                          ├────────────┤   │                          │ 4 Download   │
│                          │ Exact values│  │                          │   12×16 in,  │
│                          │ (collapsed) │  │                          │   300 DPI    │
└──────────────────────────┴────────────┘   │                          │   Print 100% │
  Save (disabled until ready) · Cancel      │                          │ Test sheet   │
                                            └──────────────────────────┴──────────────┘
```

## Interaction states (approved)

```
FEATURE          | LOADING              | EMPTY                    | ERROR                                 | SUCCESS                       | PARTIAL
-----------------|----------------------|--------------------------|---------------------------------------|-------------------------------|------------------------------
Placer art       | "Loading print file…"| "No print file yet:      | "Can't be used for print files,       | "Slot found: 2.50 in at       | Draft uploaded, not saved:
                 | stage shows area     |  upload one (print area  |  re-upload" / "No slot found" /       |  9.20, 13.10 in"; Save on     |  "Unsaved changes", Cancel
                 | outline              |  size, #FF00FF slot)"    |  "Slot under 2 in" / "not round"      |                               |  discards
Save             | button shows "Saving"| disabled, reason shown   | server error text, nothing changed    | "Saved. New orders print here"| n/a
Shirt QR         | spinner in QR cell   | "No QR: <cause>" + link  | "QR failed: <reason>"                 | thumbnail + Proof             | some shirts done: per-row
Proof            | "Building proof…"    | "No print file: save QR  | "Doesn't read this shirt's link",     | "Reads <link> ✓", Download on | n/a
                 |                      |  placement" + link       |  Download stays disabled              |                               |
Verify scan      | camera starting      | "Point the camera at the | "Not a shirt from this shop" /        | "Verified: <code> · L1 S1 · M |  n/a
                 |                      |  shirt's QR"             |  "Different order"                    |  · <owner>"                   |
Drift            | n/a                  | n/a                      | "Product placement changed since this | n/a                           | n/a
                 |                      |                          |  order" (uses the order's frozen copy)|                               |
```

## Journey (approved)

```
STEP | USER DOES                          | USER FEELS        | PLAN SPECIFIES
-----|------------------------------------|-------------------|-----------------------------------------------
1    | Exports art with #FF00FF slot      | unsure of rules   | export rule in the upload hint (Issue 8)
2    | Uploads it, sees QR snap into slot | relief, confidence| auto-detect + snap, sample emblem toggle (2, 8)
3    | Saves                              | done, safe        | Save blocked until ready, atomic (5, 6)
4    | Customer pays                      | (none)            | placement frozen on the order (4)
5    | Opens the shirt's proof            | checking          | composed preview, decode ✓ (3, 10)
6    | Prints the test sheet, measures    | certain           | ruler + "Print at 100%" (11)
7    | Presses, scans with Verify         | finished          | verify scan, not counted as a customer scan (12)
```

## Pass scores

| Pass | Before | After | Remaining gap |
|---|---|---|---|
| 1 Information architecture | 4 | 8 | none material |
| 2 Interaction states | 3 | 8 | none material |
| 3 Journey | 4 | 9 | none material |
| 4 AI slop (OPERATE surface) | 8 | 8 | no hard rejections; litmus 7/7 yes or n/a |
| 5 Design system | 6 | 6 | no DESIGN.md (TODO added) |
| 6 Responsive & a11y | 4 | 8 | desktop-only by design (≥1024 px) |
| 7 Decisions | | | 17 decided, 0 open |

## NOT in scope

- Manual print area for products with no Printful garment: declined (Issue 14B).
- Visual mockups: the gstack designer needs an OpenAI key; run its `setup` to enable them.
- DESIGN.md: deferred to TODO.md.

## What already exists

- To-scale stage, drag/resize, art box and Save (`qrStage`, `qrSettings` in `ecommerce/dashboard.html`).
- Composed per-shirt PNG at 300 DPI with a pHYs tag (`downloadPrintFile`, `pngAt300Dpi`).
- Shirts modal table, status line, `printfulStatusChip`, `btn-inrl` / `btn-inrl-outline`.
- Square-module emblem with scan tests (`qrPng`, `test/qr-emblem.test.mjs`).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~4h / CC: ~25min)** — worker + db — Freeze QR placement and art per order at payment; use it for print files and resubmit; drift warning
  - Surfaced by: Pass 2 — Issue 4 (printFileSpec reads live product settings)
  - Files: cloudflare/worker/index.js, sql/ (new migration), ecommerce/dashboard.html
  - Verify: test that editing placement after payment leaves the order's print spec unchanged
- [ ] **T2 (P1, human: ~3h / CC: ~20min)** — emblem — Exact round outer rim, wobble only inside
  - Surfaced by: Pass 3 — Issue 9 (shape(th) varies ±9% per customer)
  - Files: cloudflare/worker/index.js, test/qr-emblem.test.mjs
  - Verify: test that the backing edge radius is constant for several links; scan tests still pass
- [ ] **T3 (P1, human: ~1 day / CC: ~45min)** — placer — Auto-detect #FF00FF slot, snap QR, strip magenta, slot errors, no pre-filled defaults
  - Surfaced by: Pass 3 — Issue 8
  - Files: ecommerce/dashboard.html
  - Verify: local placer run with test art; QR equals the slot box; saved file has no magenta
- [ ] **T4 (P1, human: ~2h / CC: ~15min)** — placer — Draft upload committed with Save; Save blocked until art is print-ready (canvas read test)
  - Surfaced by: Pass 2 — Issues 5, 6
  - Files: ecommerce/dashboard.html, cloudflare/worker/index.js
  - Verify: Cancel after upload leaves the live art unchanged; Save disabled for unreadable art
- [ ] **T5 (P1, human: ~4h / CC: ~30min)** — shirts — Proof panel with composed preview, zoom, decode gate, descriptive file name
  - Surfaced by: Pass 1/3 — Issues 3, 10, 17
  - Files: ecommerce/dashboard.html (plus a small vendored QR decoder)
  - Verify: Download disabled until the decode equals the shirt's link; file name matches pattern
- [ ] **T6 (P2, human: ~2h / CC: ~15min)** — shirts — Paper test sheet + "Print at 100%" notice
  - Surfaced by: Pass 3 — Issue 11
  - Files: ecommerce/dashboard.html
  - Verify: printed sheet's ruler measures 1 in / 25 mm at 100%
- [ ] **T7 (P2, human: ~2h / CC: ~15min)** — shirts — Per-shirt cause + fix for missing QR or print file
  - Surfaced by: Pass 2 — Issue 7
  - Files: cloudflare/worker/index.js, ecommerce/dashboard.html
  - Verify: unset PUBLIC_SITE_URL shows "No QR: PUBLIC_SITE_URL not set" with a link
- [ ] **T8 (P2, human: ~3h / CC: ~20min)** — placer — Large stage first, 4× slot zoom, outline QR + sample emblem toggle
  - Surfaced by: Pass 1 — Issues 1, 2
  - Files: ecommerce/dashboard.html, cloudflare/worker/index.js (sample emblem endpoint)
  - Verify: local placer run; slot edges visible through the QR outline
- [ ] **T9 (P2, human: ~1h / CC: ~10min)** — placer — Keyboard nudge, focus ring, aria-live
  - Surfaced by: Pass 6 — Issue 13
  - Files: ecommerce/dashboard.html
  - Verify: arrows move 0.05 in, Shift 0.25 in; screen reader announces position
- [ ] **T10 (P2, human: ~1 day / CC: ~45min)** — shirts — "Verify printed shirt" camera scan, not counted as a customer scan
  - Surfaced by: Pass 3 — Issue 12
  - Files: ecommerce/dashboard.html, cloudflare/worker/index.js
  - Verify: scanning a shirt marks it verified; scan_count unchanged
- [ ] **T11 (P3, human: ~3h / CC: ~20min)** — AR — Record the marker's source-file fingerprint; "AR marker out of date" chip
  - Surfaced by: Pass 7 — Issue 15
  - Files: admin.html, cloudflare/worker/index.js, ecommerce/dashboard.html
  - Verify: replacing the print file shows the chip until the marker is recompiled

_No new tasks from Pass 4 (AI slop)._ Pass 5 produced a TODO only.

## Unresolved decisions

None. Deferred: DESIGN.md (TODO.md).

## Completion summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | no DESIGN.md; UI: QR placer, Shirts modal   |
  | Step 0               | 4/10; all 7 passes                          |
  | Pass 1  (Info Arch)  | 4/10 → 8/10 after fixes                     |
  | Pass 2  (States)     | 3/10 → 8/10 after fixes                     |
  | Pass 3  (Journey)    | 4/10 → 9/10 after fixes                     |
  | Pass 4  (AI Slop)    | 8/10 → 8/10 after fixes                     |
  | Pass 5  (Design Sys) | 6/10 → 6/10 after fixes                     |
  | Pass 6  (Responsive) | 4/10 → 8/10 after fixes                     |
  | Pass 7  (Decisions)  | 17 resolved, 0 deferred                     |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (3 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 1 item proposed (added to TODO.md)          |
  | Approved Mockups     | 0 generated, 0 approved (no designer key)   |
  | Decisions made       | 16 added to plan (+1 keep-as-is)            |
  | Decisions deferred   | 1 (DESIGN.md TODO)                          |
  | Overall design score | 3/10 → 6/10                                 |
  +====================================================================+
```

---

# Eng review 2 (2026-10-12): design-review tasks T1-T11

Target: this spec's "Design review 2026-10-12" Implementation Tasks T1-T11, reviewed by
/plan-eng-review against `cloudflare/worker/index.js`, `ecommerce/dashboard.html`,
`viewer.html` and `admin.html`.

## Scope record (eng review 2)

feature answers: D1 B (T11 deferred to TODO.md); structure: D2 B (smaller arrangement);
accepted scope: T1-T10 with T1 reading the order's existing `items_json` snapshot (each line's
`qr` and `design_images`, saved at checkout, `index.js:2682`) instead of a new column, and T10
as a phone scan of `/p/<code>` that shows an admin overlay (order, line, size, owner, Mark
verified) without counting the scan, instead of a dashboard webcam view; pending remedies:
E1 decoder, E2 magenta edge, E3 resubmit vs freeze, E6 test seam. Scope Challenge result:
scope reduced per recommendation (T11 deferred).

## Decision ledger (eng review 2)

### E1: how the proof checks the composed file reads the shirt's link
Finding: E1, P1, confidence 9/10, Architecture. Approved behaviour (design Issue 10): Download only when the composed file reads that shirt's exact link. Windows Chrome has no `BarcodeDetector` (Chrome shape-detection docs list macOS, ChromeOS, Android).
Plan baseline: design review T5 "plus a small vendored QR decoder".
Runtime evidence: no decoder in the repo; the dashboard already loads Bootstrap from cdn.jsdelivr.net (`ecommerce/dashboard.html:7-8`).
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| E1 decoder | none | `barcode-detector` polyfill (ZXing in WebAssembly) from jsDelivr, used only when native is missing; decode a crop around the QR | jsQR (plain JS) from jsDelivr; decode a crop around the QR | no decoder: server returns the expected module grid; the page samples the composed file at each module centre |
| Behaviour | n/a | Download only on exact link match | same | same, but checks bits, not real scanner reading |
Question D3:
D3 — How should the proof check the QR actually reads?
Header: Decoder
Options:
A) barcode-detector polyfill (recommended)
Native BarcodeDetector where it exists, else the ZXing-in-WebAssembly polyfill from jsDelivr (about 1 MB, loaded only on the proof). Decodes a crop around the QR. Human ~3h / CC ~20 min.
B) jsQR
Plain-JS decoder from jsDelivr (about 130 KB). Decodes a crop around the QR. Same effort; older, less tolerant decoder.
C) Bit check, no decoder
Server sends the expected module grid; page samples the composed file at module centres. No library, but it checks our own encoder's bits rather than a real scanner reading.

State: approved
Actual answer: A) barcode-detector polyfill (D3, 2026-10-12)
Accepted scope: proof uses native BarcodeDetector when it supports qr_code, else the barcode-detector polyfill (ZXing WebAssembly) loaded from jsDelivr only when a proof opens; it decodes a crop around the QR and Download is enabled only when the text equals that shirt's link exactly.
History: none

### E2: what happens to the #FF00FF slot marker in the art
Finding: E2, P1, confidence 8/10, Architecture. The slot's anti-aliased edge pixels are blends of magenta and the art, not exact #FF00FF, so "strip the magenta" (design Issue 8) leaves a pink fringe unless it uses a tolerance; re-encoding a 3600 x 4800 PNG in the browser to strip it is slow and changes the user's file.
Plan baseline: design Issue 8 "strips the magenta from the saved print file".
Runtime evidence: the QR layer always prints over the art in the same placement (`printfulPlacements`, `downloadPrintFile`); the emblem's white disc is opaque.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| E2 slot marker | n/a | keep the file as uploaded; the emblem is drawn with a 0.03 in bleed past the detected slot, so its opaque white disc always hides the magenta and its fringe; PNG only | strip near-magenta pixels (colour-distance tolerance) to transparent in the browser and save the stripped PNG; emblem exactly slot size |
Question D4:
D4 — Hide the magenta slot under the QR, or cut it out of the file?
Header: Slot marker
Options:
A) Cover it with a 0.03 in bleed (recommended)
Keep the uploaded file unchanged; the QR emblem is 0.03 in wider than the detected slot so its white disc always covers the magenta and its soft edge. PNG uploads only.
B) Strip near-magenta in the browser
Turn magenta and near-magenta pixels transparent and save a new PNG; emblem exactly slot-sized. Slower upload and the saved file differs from yours.

State: approved
Actual answer: A) Cover it with a 0.03 in bleed (D4, 2026-10-12)
Accepted scope: the uploaded print file is stored unchanged (PNG only); the placer detects the #FF00FF disc and saves the QR at the slot's bounding box grown by 0.03 in each side: size = slot diameter + 0.06 in, top/left = slot top/left - 0.03 in, so the emblem's opaque white disc covers the magenta and its blended edge. Supersedes design Issue 8's "strips the magenta".
History: none

### E3: what Resubmit to Printful uses once placement is frozen
Finding: E3, P2, confidence 9/10, Architecture. `finalizeOrderPrintfulSubmission` re-reads every line from the product on purpose ("so a fixed product (variant, art, QR settings) is picked up on resubmit"); design Issue 4 freezes placement and art per order.
Plan baseline: design Issue 4 "print files and resubmits use the frozen copy".
Runtime evidence: `resolveOrderItemFromD1` returns catalog_variant_id, design_images and qr together; items_json holds the checkout-time copy of all three.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| E3 resubmit source | everything re-read from the product | QR placement + art from the order's snapshot; Printful variant re-read from the product (so a fixed size mapping still applies) | everything from the snapshot, nothing re-read |
Question D5:
D5 — On resubmit, what may still come from the product's current settings?
Header: Resubmit
Options:
A) Freeze art + QR, re-read variant (recommended)
Placement and art come from the order's snapshot; the Printful variant for the size is re-read, so fixing a wrong size mapping and resubmitting still works.
B) Freeze everything
Resubmit uses only the snapshot; fixing a product's variant mapping no longer helps an order that failed because of it.

State: approved
Actual answer: A) Freeze art + QR, re-read variant (D5, 2026-10-12)
Accepted scope: print files (`printFileSpec`) and `finalizeOrderPrintfulSubmission` take each line's `qr` and `design_images` from the order's `items_json` snapshot; only the Printful catalog variant is re-read from the product. The Shirts view warns "Product placement changed since this order" when the snapshot differs from the product.
History: none

Section 1 findings with no new choice (implementation of approved behaviour):
- A4, P2, 9/10, `cloudflare/worker/index.js:4435` (`update garment_units set scan_count = scan_count + 1`): `apiViewerPiece` counts every scan; T10's admin overlay must skip the count when the session is an admin, and store `garment_units.verified_at` (one small migration).
- A5, P2, 8/10, `emblemLayout` `const extent = Math.ceil(...)`: the image is rounded up to whole modules, so the white disc is narrower than the emblem width. With D4's bleed rule the disc diameter must equal the emblem width exactly; T2 sets the rim radius to `extent` itself.

### E5: what the proof does when the QR reader can't load
Finding: E5, P2, confidence 8/10, Code quality. D3's reader loads from jsDelivr when a proof opens; if it fails (offline, CDN blocked), Download stays disabled with no way forward.
Plan baseline: design Issue 10 "Download only on a match".
Runtime evidence: none yet (new code).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| E5 reader unavailable | n/a | Download stays disabled; message "QR reader didn't load: check your connection" + Retry | same message + an "I scanned it with my phone" checkbox that unlocks Download for that shirt only |
Question D6:
D6 — If the QR reader can't load, may the admin still download?
Header: Reader fails
Options:
A) Block, show Retry (recommended)
Download stays off until the reader loads and the code matches; clear message and a Retry button.
B) Allow a phone-scan override
Same message, plus a per-shirt "I scanned it with my phone" checkbox that unlocks Download.

State: approved
Actual answer: A) Block, show Retry (D6, 2026-10-12)
Accepted scope: if the reader fails to load, the proof shows "QR reader didn't load: check your connection" with Retry; Download stays disabled; no override.
History: none

### E6: where the slot detector and print-geometry code live
Finding: E6, P2, confidence 9/10, Code quality / Test review. The placer and print-file logic (contain-fit art box, composite positions, file name) are inline in `ecommerce/dashboard.html`'s single script, which no test can load; T3's slot detector and T6's test sheet would add more pure geometry there.
Plan baseline: design review T3/T5/T6 list only `ecommerce/dashboard.html`.
Runtime evidence: the dashboard's inline script is one closure; the existing tests load only the Worker.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| E6 code home | inline in dashboard.html | new `ecommerce/js/qr-print.js` (plain browser script, also importable by node tests): `findSlot(rgba, w, h)`, `fitArtBox`, `slotPlacement` (with D4 bleed), `printFileName`, `testSheetLayout`; dashboard calls it | keep inline; verify by hand in the local browser harness only |
Question D7:
D7 — Move the slot detector and print geometry into a testable file?
Header: Code home
Options:
A) New qr-print.js module (recommended)
Pure functions in ecommerce/js/qr-print.js used by the dashboard and unit-tested with node --test. Human ~1h / CC ~10 min extra.
B) Keep inline
Everything stays in dashboard.html; checked by hand in the local browser harness.

State: approved
Actual answer: A) New qr-print.js module (D7, 2026-10-12)
Accepted scope: `ecommerce/js/qr-print.js` holds `findSlot`, `fitArtBox`, `slotPlacement` (D4 bleed), `printFileName`, `testSheetLayout` as pure functions; the dashboard loads it with a script tag; unit tests import it with node --test.
History: none

Approval readiness: PASS. Checked E1 (D3 A), E2 (D4 A), E3 (D5 A), E5 (D6 A), E6 (D7 A); scope D1 B, D2 B. A4 and A5 are required implementation of approved design Issues 12 and 9.

## Section results (eng review 2)

Section 1, Architecture:
- [P1] (confidence: 9/10) no QR reader on Windows Chrome for the proof. Dispositions: accepted D3 A.
- [P1] (confidence: 8/10) stripping the #FF00FF slot leaves a pink fringe. Dispositions: accepted D4 A (cover with a 0.03 in bleed).
- [P2] (confidence: 9/10) `finalizeOrderPrintfulSubmission` re-reads the product on resubmit. Dispositions: accepted D5 A.
- [P2] (confidence: 9/10) cloudflare/worker/index.js:4435 counts every scan. Dispositions: required for T10 (skip when admin; `verified_at`).
- [P2] (confidence: 8/10) `emblemLayout` rounds `extent` up, so the disc is narrower than the emblem width. Dispositions: required for T2.

Section 2, Code quality:
- [P2] (confidence: 8/10) proof has no path when the reader fails to load. Dispositions: accepted D6 A.
- [P2] (confidence: 9/10) placement maths inline in dashboard.html, untestable. Dispositions: accepted D7 A (`ecommerce/js/qr-print.js`).

Section 3, Tests:

```
CODE PATHS                                              USER FLOWS
[+] ecommerce/js/qr-print.js (new)                      [+] Place QR on a product
  ├── findSlot()   [GAP] disc / none / <2 in / oval       ├── [GAP] PNG with slot → snap → Save
  ├── slotPlacement() [GAP] 0.03 in bleed each side       ├── [GAP] Upload then Cancel leaves live art
  ├── fitArtBox()  [GAP] fills / letterboxed               └── [GAP] JPEG refused
  ├── printFileName() [GAP] order-L-S-size-code-place     [+] Print a shirt
  └── testSheetLayout() [GAP] ruler 300 px = 1 in          ├── [GAP] [→E2E] proof decodes ✓, Download on
[+] cloudflare/worker/index.js                             ├── [GAP] reader fails → Retry, Download off
  ├── printFileSpec() from items_json [GAP] after edit     └── [GAP] test sheet prints 1 in at 100%
  ├── finalize/resubmit: snapshot look + fresh variant     [+] Verify pressed shirt
  │   [GAP] variant fixed after failure still resubmits    ├── [GAP] admin phone scan → overlay, Mark verified
  ├── qrPng() rim [GAP] constant radius = width/2          └── [GAP] customer scan still counted
  └── apiViewerPiece() [GAP] admin scan not counted

COVERAGE: 0/17 new paths tested (all new)  |  existing: qr-emblem + self-fulfil + art-placement suites green
QUALITY: planned ★★★ for qr-print.js tables, ★★ worker snapshot/resubmit, manual E2E print
```

Proposed tests (required proof of approved behaviour, value cards in the Test Plan artifact
`~/.gstack/projects/Jihan0712-ar-customizer/ryley-main-eng-review-test-plan-20261012-203041.md`):
- `test/qr-print.test.mjs`: table-driven `findSlot` (disc, none, small, oval, two blobs), `slotPlacement` bleed, `fitArtBox`, `printFileName`, `testSheetLayout`.
- `test/self-fulfil-qr.test.mjs` (extend): placement edited after payment leaves the print spec unchanged; drift flag set.
- `test/qr-art-placement.test.mjs` (extend): resubmit after a variant fix uses the new variant with the snapshot's art and QR.
- `test/qr-emblem.test.mjs` (extend): rim radius constant across links and equal to half the emblem width.
- New viewer test in `test/self-fulfil-qr.test.mjs`: admin scan of `/api/viewer/piece` leaves `scan_count`; customer scan increments it.
- Manual: the proof's decode gate and the printed test sheet (browser + printer; not automatable here).

Section 4, Performance: No issues found. `findSlot` scans 17.3 M pixels once per upload
(about 50-100 ms, estimated); the proof composites one 3600 x 4800 canvas per shirt (about
69 MB, freed after download) and decodes only a crop around the QR.

Outside voice: unavailable (Codex not installed; this session has no TaskOutput tool for the
native fallback). Missing coverage, not a clean result.

## Revised Implementation Tasks (eng review 2)

Replaces the design review's T1-T11 where they differ.

- [x] **T1 (P1, human: ~2h / CC: ~15min)** — worker — print spec and resubmit read QR + art from `items_json`; variant re-read; drift flag (D2 B, D5 A)
  - Files: cloudflare/worker/index.js, ecommerce/dashboard.html, test/self-fulfil-qr.test.mjs, test/qr-art-placement.test.mjs
  - Verify: `npm test`
- [x] **T2 (P1, human: ~3h / CC: ~20min)** — emblem — constant rim radius equal to half the emblem width; rings inside (A5)
  - Files: cloudflare/worker/index.js, test/qr-emblem.test.mjs
  - Verify: `npm test`
- [x] **T3 (P1, human: ~1 day / CC: ~45min)** — placer — `qr-print.js` `findSlot` + `slotPlacement` with 0.03 in bleed; PNG only; slot errors (D4 A, D7 A)
  - Files: ecommerce/js/qr-print.js (new), ecommerce/dashboard.html, test/qr-print.test.mjs (new)
  - Verify: `npm test`; local placer run
- [x] **T4 (P1, human: ~2h / CC: ~15min)** — placer — draft upload committed with Save; Save gated on canvas read test
  - Files: ecommerce/dashboard.html, cloudflare/worker/index.js
  - Verify: local placer run (Cancel keeps live art)
- [x] **T5 (P1, human: ~4h / CC: ~30min)** — shirts — proof panel; barcode-detector polyfill decode gate; Retry on load failure; descriptive file name (D3 A, D6 A)
  - Files: ecommerce/dashboard.html, ecommerce/js/qr-print.js
  - Verify: local proof run; Download only after "Reads <link> ✓"
- [x] **T6 (P2, human: ~2h / CC: ~15min)** — shirts — test sheet + "Print at 100%"
  - Files: ecommerce/js/qr-print.js, ecommerce/dashboard.html
  - Verify: `npm test` (layout); print at 100%, ruler = 1 in
- [x] **T7 (P2, human: ~2h / CC: ~15min)** — shirts — per-shirt cause + fix
  - Files: cloudflare/worker/index.js, ecommerce/dashboard.html
  - Verify: unset PUBLIC_SITE_URL shows the cause and link
- [x] **T8 (P2, human: ~3h / CC: ~20min)** — placer — large stage, 4x zoom, outline + sample emblem toggle
  - Files: ecommerce/dashboard.html, cloudflare/worker/index.js
  - Verify: local placer run
- [x] **T9 (P2, human: ~1h / CC: ~10min)** — placer — keyboard nudge, focus ring, aria-live
  - Files: ecommerce/dashboard.html
  - Verify: arrows/Shift/±; screen reader announces
- [x] **T10 (P2, human: ~3h / CC: ~20min)** — viewer — admin overlay on `/p/<code>` with Mark verified; admin scans not counted; `verified_at` migration (D2 B, A4)
  - Files: viewer.html, cloudflare/worker/index.js, sql/ (new migration), test/self-fulfil-qr.test.mjs
  - Verify: `npm test`; phone scan as admin
- T11 deferred to TODO.md (D1 B).

## NOT in scope (eng review 2)

- T11 AR marker fingerprint: deferred to TODO.md (D1).
- Dashboard webcam scanner: replaced by the phone scan of `/p/<code>` (D2).
- Stripping magenta from print files: replaced by the 0.03 in bleed (D4).
- Proof download override when the reader is down: declined (D6).

## What already exists (eng review 2)

- `orders.items_json` already snapshots each line's `qr` and `design_images` at checkout: reused for T1.
- `/p/<code>` → `viewer.html` → `apiViewerPiece`: reused for T10.
- `downloadPrintFile` / `pngAt300Dpi`: reused for the proof and test sheet.
- `test/helpers/worker-harness.mjs`: reused for the new worker tests.

## Failure modes (eng review 2)

| Path | Realistic failure | Test / handling | User sees |
|---|---|---|---|
| Slot detection | magenta area is an oval or two blobs | findSlot table test; error | "Slot is not round" |
| Bleed | disc diameter smaller than emblem width | rim test (T2) | none: test fails before ship |
| Snapshot | old order without art box in items_json | falls back to the snapshot's art with fit-and-centre | proof shows the fit; drift flag if product differs |
| Decode | reader CDN down | D6 Retry, Download disabled | clear message, Retry |
| Verify | admin scan counted as customer scan | viewer test | none: test fails before ship |

Critical gaps: 0.

## Worktree parallelization strategy (eng review 2)

| Step | Modules touched | Depends on |
|------|----------------|------------|
| T1, T2, T7, T10 worker | cloudflare/worker/, sql/, test/ | — |
| T3, T6 qr-print.js | ecommerce/js/, test/ | — |
| T4, T5, T8, T9 dashboard UI | ecommerce/dashboard.html | T3 (qr-print.js API) |
| T10 viewer overlay | viewer.html | T10 worker endpoint |

Lane A: worker tasks (cloudflare/worker/, sql/). Lane B: qr-print.js. Then Lane C: dashboard UI + viewer.
Execution order: launch A + B in parallel; merge both; then C. Conflict flag: T5 and T7 both edit the Shirts modal in dashboard.html; keep them in Lane C, sequential.

## Completion summary (eng review 2)

- Step 0: Scope Challenge — scope reduced per recommendation (T11 deferred)
- Reality rows: 7/7 applicable rows emitted, 1 unverified premise
- Architecture Review: 5 issues found
- Code Quality Review: 2 issues found
- Test Review: diagram produced, 17 gaps identified
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item (T11, from D1)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (not installed; no TaskOutput for native fallback)
- Parallelization: 3 lanes, 2 parallel / 1 sequential
- Lake Score: 1/5 (D3-D7 scored; only D7 A was a 10/10 option)

## Reality rows (eng review 2)

| premise | claim | file:line receipt | verdict |
|---|---|---|---|
| P1 | items_json snapshots qr and design_images | cloudflare/worker/index.js:2682, :2174, :2178 | true |
| P2 | resubmit re-reads the product | cloudflare/worker/index.js finalizeOrderPrintfulSubmission ("Re-resolve against current D1 data") | true |
| P3 | every piece scan is counted | cloudflare/worker/index.js:4435 | true |
| P4 | Windows Chrome lacks BarcodeDetector | Chrome shape-detection docs (macOS, ChromeOS, Android) | true |
| P5 | dashboard already loads from jsDelivr | ecommerce/dashboard.html:7-8 | true |
| P6 | findSlot runs in ~50-100 ms on 17.3 M px | none | unverified |

unverified=1

REALITY: premise-table finding 6 premises, unverified=1 (P6) cloudflare/worker/index.js:2682
REALITY: already-done pass no commits since 2026-10-12 implement T1-T11 (git log 083a7ed) ecommerce/dashboard.html:1
REALITY: surface-check pass /p/<code>, /api/viewer/piece, /api/admin/orders/:id/pieces exist cloudflare/worker/index.js:4435
REALITY: binding-decisions pass design decisions Issues 1-17 honoured; D4 supersedes Issue 8's strip, recorded docs/superpowers/specs/2026-10-02-per-shirt-qr-design.md:1069
REALITY: numbers pass 3600 x 4800 = 17.3 M px [measured: arithmetic], 1 MB polyfill [estimated], 0.03 in bleed [decided D4] docs/superpowers/specs/2026-10-02-per-shirt-qr-design.md:1069
REALITY: deferred-asks pass T11 deferred with reason (D1); all other design tasks kept docs/superpowers/specs/2026-10-02-per-shirt-qr-design.md:1032
REALITY: pr-count pass default one PR; three lanes merge before UI lane docs/superpowers/specs/2026-10-02-per-shirt-qr-design.md:1032

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review`; Claude subagent via `/plan-design-review` | Independent 2nd opinion | 3 | unavailable (codex, both eng runs); design voice in-host completed | design: 21 subagent findings folded into Issues 1-17 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | ISSUES OPEN | 24 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | ISSUES OPEN | score: 3/10 → 6/10, 16 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex unavailable for both eng plan-reviews and the design phase (CLI not installed). The design phase's in-host Claude subagent is not outside coverage.
- **VERDICT:** none CLEAR. Eng review 2 has mapped work (revised T1-T10) with 0 critical gaps and 0 unresolved decisions; status stays issues_open until built; eng review required.

NO UNRESOLVED DECISIONS

