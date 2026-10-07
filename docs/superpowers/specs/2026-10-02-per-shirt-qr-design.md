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
| QR look | Fingerprint emblem (2026-10-07): flowing maze strokes and rounded eyes inside broken concentric rings, all generated from the shirt's link; black on a white backing shaped like the outer ring, transparent outside | User |

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
  margin, so: dark modules are joined by a maze of strokes (a spanning forest over
  orthogonal and light-corner diagonal neighbours, picked by a generator seeded from the
  link, with straight runs merged and corners smoothly blended); modules with no stroke are
  dots; eyes are rounded squares; a 2-module light margin separates the code from broken
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

Shown once the product has an AR target and a Printful link:

- Placement select (from `GET /api/admin/printful/catalog/:id/placements`), size in inches
  (default 1.5, minimum 1.0), top and left in inches, "Centre horizontally" button.
- "Preview" calls the mockup endpoint, extended to accept the QR settings and render the art
  plus a sample QR (`SAMP-LE00`).
- "Save" writes `printful_qr` via `POST /api/products/:id`.
- Orders tab: "Resubmit to Printful" on paid orders with `printful_status = 'error'`.

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
  Printful's designer. Mitigation: the Preview renders exactly what will be printed; the
  admin can upload a print-ready art file per placement if it is off.
- Exact field names on Printful v1 sync variants (`variant_id`, `product.product_id`,
  `files[].type`, `files[].url`) are confirmed on the first re-import, which reports what it
  copied.
- Each shirt becomes its own Printful item. Printful pricing is per item, so this does not
  change cost, but very large quantities make larger order payloads.
