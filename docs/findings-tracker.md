# Findings tracker

Problems found while reviewing the shop as a customer, adding a product as an admin
(Fingerprints Tee), and checking the AR. Tick an item when it is fixed **and checked on the
live site**. Each open item says where the problem is and what "done" looks like.

Last updated: 2026-11-19

**Status:** 32 done · 24 open · 3 won't fix · plus 5 ideas

Key: `[x]` done and checked live · `[ ]` open · `[-]` won't fix (outside our code)

---

## 1. Customers: blockers (people get stuck)

- [ ] **iPhone videos are refused.** The add-your-video page only takes MP4, up to 10 MB and
  30 s. iPhones save `.MOV`, and a 15 s clip is often 20–40 MB.
  *Where:* `ecommerce/piece.html` (`MAX`, `MAX_SECONDS`, the format check in `choose()`).
  *Done when:* an iPhone `.MOV` of any normal length can be picked and plays on the shirt
  (converted/shrunk automatically, with a simple trim to 30 s).
- [ ] **No emails after purchase.** The only email sent is the password reset. The
  confirmation page even promises "we'll email you as soon as it clears".
  *Where:* `cloudflare/worker/index.js` (`sendMail`, the Stripe and Printful webhooks).
  *Done when:* buyers get "order confirmed", "your T-shirt is ready: add your video" and
  "shipped" (with tracking) emails.
- [ ] **"See it in action" opens a camera with nothing to scan.** On a phone, shoppers land on
  "point your camera at the print", but they don't own the print yet.
  *Where:* `ecommerce/product.html` (`seePlays` links), `viewer.html`.
  *Done when:* before purchase it shows a demo video of a real scan, plus "try it: point your
  phone at this picture" with the print on screen.

## 2. Customers: polish

- [x] Product page showed three empty grey thumbnails when there is only one photo.
- [x] Unisex products only showed under "All" (now under Men and Women too).
- [x] Home page image and video slots were empty (hero video, film still, how-it-works photos).
- [ ] **Product pages look unfinished:** "No description yet" on older products, only the
  plain front photo, and addresses like `draft-mv4zuden0gxy`.
  *Done when:* every published product has a description, a photo of the AR print, and a
  readable address. (Change a slug only on products with no printed shirts yet.)
- [ ] **Coffee Shirt is sold with no AR** (a plain tee in an AR shop).
  *Done when:* it has AR, or it is unpublished.
- [ ] **"Unisex Hoodie" is in the Men category** and listed under "T-shirts".
  *Done when:* category is Unisex, and the shop heading/count doesn't call a hoodie a T-shirt.
- [ ] **Screen readers read "PRIMARY IMAGE"** for every product photo.
  *Where:* the product card in `ecommerce/js/ui.js`.
  *Done when:* each photo's alt text is the product name.
- [ ] **The phone scanner screen doesn't show the print** (the laptop page now does).
  *Where:* `viewer.html`, the gate state.
  *Done when:* the print picture shows on the phone before the camera opens.
- [ ] **Out-of-date wording on the order confirmation:** "If you checked out signed in…", but
  checkout now always requires an account.
  *Where:* `ecommerce/order-confirmation.html`.
- [ ] **Home hero video has its own captions** that overlap "PRINTED ONCE. CHANGE FOREVER."
  *Done when:* a version without captions is in the Homepage editor.
- [ ] **Two Printful mockups don't show where the shirt's QR prints** (it's added after
  Printful's mockup). Optional: add the QR to the shop photo.

### Ideas (not problems)

- [ ] Scan tips on the viewer after 5–10 s without a match (distance, light, keep it flat).
- [ ] After uploading a video, show "this is what people will see" over the print.
- [ ] Gift flow: "this is a gift", so the recipient claims the shirt and adds their own video.
- [ ] Owners see how often their shirt was scanned (`scan_count` already exists).
- [ ] "Share my shirt's video" link (uses the existing `/p/<code>` link).

## 3. Admins: adding a new product

Found while adding Fingerprints Tee on 2026-11-13. Fixed in commit `3ff4a2f` (live 2026-11-18).

- [x] Print file from Printful's design maker isn't copied, and the error read like a log line.
  Now: plain-language message, and the QR step takes the designer's own file.
- [x] The QR step needed a hand-built 12×16 in, 300 DPI file. Now: upload the design as it is
  and set its width and top/middle position.
- [x] WebP files were refused (PNG only). Now converted to PNG on upload.
- [x] No way to choose the QR colour without a coloured placeholder. Now: "Black on white" or
  "In a colour, no backing".
- [x] No guidance on file, QR spot, contrast or busy art. Now: a checklist on the Garment step.
- [x] No link to Printful from the dashboard. Now: "Open Printful ↗".
- [x] The QR step opened on Front for a back-only design, and an upload made before switching
  placement was silently dropped. Now it opens on the side the import found, and an upload
  follows a switch.
- [x] "Inside label" was listed four times.
- [x] Low resolution was only warned about on Printful. Now the QR step shows printed size and
  DPI, and warns under 150 DPI.
- [x] The import box started empty until Search was clicked. Now it lists pieces on open.
- [x] The import box was taller than the window; "Done" was unreachable. Now it scrolls.
- [x] Sizes were shown as raw Printful variant numbers. Now size chips; numbers folded away.
- [x] The AR target name was the old Printful name, not the product title.
- [x] "The target is inactive" wasn't explained, and the starter video's purpose wasn't either.
- [x] Drafts couldn't be previewed (even admins got a 404). Now admins see the draft with a
  Draft banner; shoppers still get 404.
- [x] Products page stayed blank for ~5 s. Now shows "Loading products…".
- [x] No Unisex category.
- [x] Products linked to Printful but missing a print file were labelled "UNLINKED", and the
  overview said "not linked to Printful". Now "NO PRINT FILE" / "can't be printed yet", with
  the reason named.
- [x] Pub in the products list gave no feedback and didn't switch the AR on, so "See it in
  action" said "No video here yet". Now it confirms and switches the AR on, like Publish.
- [x] The AR console opened on "Upload Target" instead of the targets list.
- [ ] **Two websites to add one product.** The garment still has to be created on
  printful.com, then imported.
  *Done when:* the dashboard can create the Printful product from an uploaded design
  (Printful API: create sync product), or this is accepted as the workflow.
- [-] Printful shows the price as "$" in one place and "€" in another. *(Printful's side.)*
- [-] Printful's Publish wizard skipped its naming step. *(Printful's side.)*
- [-] Clicking an import row wrote something to the clipboard. *(Not from our code; reopen if
  it happens again.)*

### Why the print didn't fill Printful's print area (2026-11-19)

The design had no clear spot for the shirt's QR, so it was shrunk to 10 in to fit a QR below
it; Printful's low-resolution warning (shown even at 116 DPI, above its own 75 DPI limit)
pushed the same way. Our tools never showed the mismatch:

- [x] **The import doesn't read where the design sits on Printful**, so our print layout and
  Printful's can differ silently (only ours prints; Printful's is the shop photo).
  *Fixed:* the QR step shows Printful's mockup under our layout to compare.
- [x] **The QR step doesn't say how much of the print area the design fills.**
  *Fixed:* "Fills 83% of the print width" plus a "Make it full width" button.
- [x] **Nothing warns that placing the QR will shrink or cover the design.**
  *Fixed:* with no placeholder, the QR step offers "Shrink the design, QR below it" or "Full
  width, QR over the design" (or the neck label).
- [x] **The QR finder missed the design's own placeholder QR** (a 1157 px export leaves it
  ~2 px per module, under a fingerprint swirl). *Fixed:* when nothing is found in a small file,
  the QR step looks again on a 2x then 3x enlarged copy; the badge is now found, the shirt's
  QR takes its place (1.21 in) and it is erased under it.
- [x] **Erasing a coloured placeholder took the design under it and left red behind** (the
  bar's black border and white fill went; dark and faint red stayed). *Fixed:* only the
  placeholder's own colour is erased (every shade), out to where its ink ends, and what ran
  under it is joined up again (lines and white fill). Test: `test/qr-placeholder.test.mjs`.
- [ ] **The live Fingerprints Tee print file still has the old cut** (its badge was erased with a
  plain circle that also took the end of the bar).
  *Done when:* the print file is rebuilt with the clean erase.
- [ ] **The colour read from a textured placeholder comes out lighter** (#cb7677 from a
  #b64445 badge: antialiased edges are averaged in).
  *Done when:* the ink is taken from the badge's solid pixels, or the admin sets it with the
  QR colour control.

## 4. AR stability

- [x] Compared our stabiliser with the teammate's INRL2 code: same filters, gyroscope fusion
  and frame lock, same numbers. Measured in a fake-camera test: it works as designed.
- [ ] **Test on a printed shirt, not a monitor.** The jitter seen was on a screen (screens
  flicker against the camera). Open `https://shop.inrl.co/viewer?piece=FQP5-KZ5W&debug=1` on an
  iPhone, flat and worn, and compare with `&stabilize=0`, `&gyro=0`, `&framelock=0`.
  *Done when:* steady on the printed shirt, or the debug readout shows which part fails
  (`motion`, `gyro`, `track …/s`).

## 5. Fingerprints Tee (product 27, live)

- [x] Created, published, Unisex, AR target 47 switched on, shirt QR red on the back.
- [ ] **Test print and scan** one shirt (per-shirt red QR opens the AR; tracking on fabric).
- [x] The design now fills the print area (12 in wide); each shirt's QR (1.4 in, red) prints
  over the design's own QR badge at the end of the bar, which is erased under it. A real shirt
  QR on this print decodes (jsQR).
- [ ] **Print resolution is ~96 DPI** at 12 in wide.
  *Done when:* a 300 DPI export (3600 px wide) replaces it in the QR step.
- [x] Printful's own copy set to 12 in wide at the top (matches what prints).
- [ ] **Shop photo still shows the old 10 in mockup.**
  *Done when:* the piece is re-imported in the dashboard (Garment → Import from Printful) once
  Printful has regenerated its mockups.
- [ ] Starter video is widescreen, so it plays with bars over the tall print. Optional: a
  portrait video.
- [ ] Five leftover copies of the design in storage (`designs/…fingerprints-back.png`,
  `designs/…fingerprints-print-area.png`, two unused uploads under `products/27/print/`, and
  the old 10 in print file `images/1794555182779-print-back-qr-spot-erased.png`).
  *Done when:* removed (only after confirming nothing references them).

## 6. Catalogue and housekeeping

- [ ] **Coffee Shirt and Unisex Hoodie are published but can't be printed** (no print file).
  Checkout refuses them.
  *Done when:* each has its print file and QR placement, or is unpublished.
- [ ] **Don't publish the unpublished "Coffee Shirt" draft:** it is linked to the INRL BETA
  Printful product. Delete or relink it.
- [ ] **`figma/` (13 MB) and `print-files/` (55 MB) are in the repo**, so they are published
  on the live site. Decide: keep, or remove.
- [ ] Design-checker warnings on existing pages (small grey text contrast, tight padding,
  text under 11 px, Roboto font) in `product.html`, `shop.html`, `viewer.html`.

---

### Not to break while fixing

Every printed shirt's QR opens `https://shop.inrl.co/p/<claim_code>`. That link, the viewer
reading `?piece=`, and `/api/viewer/piece` must keep working (see `CLAUDE.md`). Run
`npm test` before every change; `test/ar-link-contract.test.mjs` must pass.
