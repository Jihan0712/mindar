# Handoff — Printful + Stripe integration rebuild

Session summary for continuing this work in VS Code. Written 2026-08-25.

## What this session built

A from-scratch rebuild of the print-on-demand purchase flow: customer picks a product → pays via Stripe → order automatically confirms and goes to Printful for printing/shipping → customer can track it.

**Architecture:** Cloudflare Pages (static `ecommerce/*.html`) + one Cloudflare Worker (`cloudflare/worker/index.js`, single file, ~3700 lines) + D1 (SQLite) + Printful API v2 + Stripe.

### Deploy process (important — two completely separate mechanisms)
- **`cloudflare/worker/index.js`** deploys via **manual copy-paste**: open the file, select all, paste into Cloudflare Dashboard → Workers & Pages → the worker → Edit Code → replace everything → Deploy. There is no `wrangler.toml` / CI for this. **git commits to this file are NOT deployed automatically.**
- **Everything else** (`ecommerce/*.html`, `ecommerce/js/*.js`) is a normal Cloudflare Pages site that **auto-deploys on `git push` to `main`**.
- Live site: `https://shop.inrl.co`. Worker's own `workers.dev` URL: `https://mindar-worker.nico-824.workers.dev` (useful for testing the Worker in isolation, but has no session cookie for `shop.inrl.co`, so anything requiring login will 401 there).

### What was built, by area
- **Printful v2 integration** (`cloudflare/worker/index.js`): the codebase originally targeted Printful's v1 "Sync Products" model, which v2 doesn't support at all. Rebuilt around v2's real model: `GET /v2/catalog-products` (paginated, 100/page, no server-side search) to browse blank garments, `GET /v2/catalog-products/{id}/catalog-variants` (separate paginated call) for size/color variants, and orders built with `catalog_variant_id` + `source:"catalog"` + a design-file `placements` array — not `sync_variant_id`. Orders are created as **unconfirmed drafts** in v2 and require a separate `POST /orders/{id}/confirm` call to actually start production/billing — easy to miss, was a real bug.
- **Admin dashboard** (`ecommerce/dashboard.html`): removed the old "Design Creator" / "Sync Existing Catalog" UI (built for the dead v1 model), replaced with a "Link to Printful Catalog" picker — search real Printful catalog products, auto-resolve `{size: catalog_variant_id}`, manual override for anything unmatched.
- **Stripe Checkout**: `POST /api/checkout/session` creates a hosted Stripe Checkout Session from server-resolved cart data (price/design/variant always re-resolved from D1, never trusted from the client). `POST /api/webhooks/stripe` verifies the webhook signature (HMAC via Web Crypto, no SDK) and on `checkout.session.completed` marks the order paid and triggers Printful submission.
- **Order tracking** (`ecommerce/order-tracking.html`): guest-safe lookup by order ID + email (`GET /api/orders/:id/track`), plus an account-based "Your Orders" list for logged-in customers (`GET /api/orders/mine`), plus a "Complete Payment" resume flow for orders stuck unpaid (`POST /api/orders/:id/resume-payment`).
- **Order confirmation** (`ecommerce/order-confirmation.html`): polls `GET /api/orders/:id/status?session_id=...` after the Stripe redirect back, shows a paid/pending/error state.

## 🔴 Current blocking issue — unresolved, pick up here

**Symptom:** Logged-in customers see empty "Your Orders" on `order-tracking.html`, and `order-confirmation.html` gets stuck on "Still Processing" — its status-polling requests were returning `500` / Cloudflare "Worker threw exception" (error 1101) in the browser console.

**What's been ruled out** (each confirmed with live evidence against the deployed site, not just code review):
- D1 migration (`sql/stripe_migration.sql`) — genuinely applied; re-running one line gives `duplicate column name: payment_status`, proving the column exists.
- Stale deployment — ruled out by testing after multiple confirmed full re-pastes.
- `user_id` linkage — confirmed correct byte-for-byte (order rows have the right `user_id`, matching `/api/auth/me`'s session user id exactly).
- Caching — response headers show no cache hit, fresh computation every time.

**What actually broke it, just found:** `apiListMyOrders` (`GET /api/orders/mine`) and `apiGetOrderStatusPublic` (`GET /api/orders/:id/status`) had their defensive fallback/retry logic stripped out in an earlier "simplify, fail loud" pass this session (intentional — the old fallback logic used fragile substring-matching on error messages and was silently swallowing real errors). But **the Worker's top-level `fetch()` handler had zero error handling at all** — so once the fallback nets were removed, any real exception in those functions became an uncaught exception, which Cloudflare renders as an opaque "Worker threw exception" crash page with **no error detail at all**. That's what the DevTools 500s were.

**Fix just made, not yet confirmed live:** added a global try/catch around the top-level `fetch()` handler (`cloudflare/worker/index.js`, right after `export default { async fetch(...) }`) that catches any uncaught exception anywhere in the Worker and returns it as readable JSON (`{error, detail}` with the stack trace) instead of the opaque Cloudflare page. This was just sent to the user to redeploy — **the actual underlying exception message has never been seen yet.**

### Next step
1. Redeploy the current `cloudflare/worker/index.js` (has uncommitted local changes — see `git diff cloudflare/worker/index.js`, not yet committed).
2. Load `order-tracking.html` while logged in, and/or an `order-confirmation.html?order_id=...&session_id=...` URL for a pending order.
3. This time a real error `{error: "Internal server error", detail: "<stack trace>"}` should come back instead of a crash page — that stack trace will finally show the actual root cause. Fix whatever it says.
4. Once `apiListMyOrders`/`apiGetOrderStatusPublic` work, re-verify end-to-end: place a real order → complete Stripe test payment (`4242 4242 4242 4242`) → confirm it shows paid in "Your Orders" and confirmed (not draft) in Printful's own dashboard.

## Gotchas discovered this session (useful if you hit them again)
- SQLite `ALTER TABLE ADD COLUMN` does **not** support `IF NOT EXISTS` (only `CREATE TABLE`/`INDEX` do) — `sql/*.sql` migration files were fixed to drop that clause.
- Printful v2 requires the `X-PF-Language` header as a long-form locale (`en_US`), not `EN` — a bare `EN` gets `400: Invalid locale!`.
- Printful v2 wraps API responses under `"data"`, not `"result"` like v1 — code defensively checks both (`resp.data ?? resp.result`).
- This site's real pages live under `/ecommerce/*.html`, not site root — Stripe `success_url`/`cancel_url` must use `${siteUrl}/ecommerce/...`, not `${siteUrl}/...` (root falls back to the unrelated MindAR AR camera viewer app).
- The site has TWO login pages historically (`/login.html` root — now deleted, was dead legacy Tailwind page) vs `/ecommerce/login.html` (the real one, INRL dark theme). All nav links now point to the latter.

## Key files
- `cloudflare/worker/index.js` — the entire backend. Deploy = manual paste (see above).
- `sql/stripe_migration.sql`, `sql/printful_migration.sql` — D1 migrations, run manually in the D1 console.
- `ecommerce/checkout.html` / `ecommerce/js/checkout.js` — checkout form → Stripe redirect.
- `ecommerce/order-confirmation.html` — post-payment polling/confirmation page.
- `ecommerce/order-tracking.html` — guest lookup + "Your Orders" for logged-in customers.
- `ecommerce/dashboard.html` — admin product management + "Link to Printful Catalog" picker.
- `TODO.md` — pre-existing project checklist (predates this session's rebuild, partially stale re: Printful — this file supersedes its Printful section).
