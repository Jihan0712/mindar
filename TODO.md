# Cloudflare-Only Migration TODO

Goal: Consolidate hosting, API, data, and storage on Cloudflare (Pages + Workers + R2 + D1). This checklist tracks the repo work to complete the migration.

## 1) Worker bindings and secrets

- [x] Create/bind R2 bucket as `ASSETS_BUCKET` (name: mindar-assets)
- [x] Create D1 database and bind as `DB` (name: mindardb)
- [x] Set `ASSETS_DOMAIN` (e.g., https://assets.example.com)
  - Explanation: Public base used by the Worker when returning asset URLs (e.g., `https://assets.example.com/path/to/file`). Include `https://`. If using a Workers.dev route, set it to that domain.
- [x] Set `ALLOWED_ORIGINS` (comma-separated admin/viewer origins)
  - Explanation: CORS allowlist for your Pages domain(s) and local dev (e.g., `https://your-site.pages.dev, http://localhost:8000`). Requests from these origins receive `Access-Control-Allow-Origin`.
- [x] Set `WORKER_DELETE_KEY` (random long secret)
  - Explanation: Checked by the Worker `POST /delete` endpoint to authorize asset removal from R2. Keep server-side only; do not expose in clients. Set via Wrangler secrets or Dashboard.
- [x] Set `BOOTSTRAP_ADMIN_KEY` (temporary; delete after bootstrap)
  - Explanation: One-time secret used by `POST /api/auth/bootstrap-admin` to create the first admin. Remove/rotate after bootstrap for safety.
- [x] (Optional) `CF_ZONE_ID`, `CF_API_TOKEN` for purge
  - Explanation: Enables optional cache purge calls after deletes. Token should be scoped for your zone with `Cache Purge: Zone` (and optionally `Workers: Edit`) permissions.

Example (Wrangler secrets):

```bash
wrangler secret put WORKER_DELETE_KEY
wrangler secret put BOOTSTRAP_ADMIN_KEY
# Optional
wrangler secret put CF_API_TOKEN
```

## 2) Bootstrap admin

- [x] With `BOOTSTRAP_ADMIN_KEY` set, run:

```bash
curl -i -X POST "$WORKER_URL/api/auth/bootstrap-admin" \
  -H "x-bootstrap-key: $BOOTSTRAP_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  --data '{"email":"admin@example.com","password":"changeme"}'  
```

## 3) UI auth → Worker

- [x] Replace legacy auth in `admin.html`, `brand-register.html`, `admin-register.html`, `login.html`
- [x] Use `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`

Dashboard-only setup (no Wrangler)

- Pages domain: Create/attach your Pages project to a custom domain (e.g., `https://shop.inrl.co`). Add this exact origin to `ALLOWED_ORIGINS` in the Worker.
- Worker routes (same-origin): In Cloudflare Dashboard → Workers → your worker → Settings → Routes → add:
  - `shop.inrl.co/api*` (auth + data)
  - `shop.inrl.co/upload` (file uploads)
  - `shop.inrl.co/delete` (asset deletion)
  - `shop.inrl.co/purge` (optional CDN purge)
  If you also serve `www`, add equivalents for `www.shop.inrl.co/*`.
- Why this matters: `assets/js/auth-worker.js` calls relative `/api/...` with `credentials: 'include'` so the browser sends the session cookie only when the API is same-origin. Mapping `/api*` (and `/upload`) on your site domain ensures the Worker handles those requests on the same origin.
- Preview domains: If you use Pages previews (e.g., `https://<project>.pages.dev`), include that origin in `ALLOWED_ORIGINS` as well so CORS preflight succeeds during OPTIONS/JSON calls.
- CORS & cookies: The Worker sets `Access-Control-Allow-Origin` to the request origin when it matches `ALLOWED_ORIGINS`. Cookie-based sessions require same-origin; cross-origin (e.g., calling a `workers.dev` URL from your site) will not send cookies. Prefer the same-origin `/api` route and map `/upload` to the same domain as the UI.
- Conflicts: Ensure you do not also define Pages Functions for `/api/*` on the same domain. If you do, remove or change those so Worker Routes own `/api*`. Similarly, avoid a Pages Function for `/upload` if the Worker handles uploads.
- Health check: After adding the route, visit `https://shop.inrl.co/api/auth/me` in the browser (you should get `{ user: null }` unauthenticated) and `https://shop.inrl.co/` should still serve your Pages site.

DNS for `shop.inrl.co` (Dashboard-only)

- In Cloudflare DNS, add a CNAME record `shop` → your Pages hostname (e.g., `<project>.pages.dev`), proxied (orange cloud).
- In Cloudflare Pages → your project → Custom Domains → add `shop.inrl.co` and complete verification.
- Keep `assets.inrl.co` as a separate subdomain for asset delivery (already routed). Set `ASSETS_DOMAIN` to `https://assets.inrl.co` in Worker variables so returned URLs are under assets.

## 4) Admin targets → Worker/D1

- [x] List targets via `GET /api/targets`
- [x] Create via `POST /api/targets`
- [x] Activate via `POST /api/targets/:id/activate`
- [x] Deactivate via `POST /api/targets/:id/deactivate`
- [x] Delete via `DELETE /api/targets/:id` (also removes R2 assets)
 - [x] Filters wired (brand, product, clientId)

## 5) Viewer → Worker

- [x] Fetch active target from `GET /api/viewer/active?brand=&product=`
- [x] Apply returned `mindurl` / `videourl` to MindAR viewer (`index.html`)

## 6) Asset uploads → Worker

- [ ] Continue using `POST /upload` in `admin.html` (already integrated)
- [ ] Ensure `ASSETS_DOMAIN` is correct/public

## 7) Data migration (legacy → D1)

- [ ] Export CSV/SQL for `targets`, `admins`, `profiles` (for brands/role)
- [ ] Transform to D1 schema: `users(email, role, password_hash?)`, `brands`, `brand_users`, `targets`, `brand_limits`
- [ ] Write/import script (SQL or Worker one-off) to seed D1

## 8) Hosting on Cloudflare Pages

- [x] Set up Pages project pointing to repo root
- [x] Configure custom domain and `ALLOWED_ORIGINS`
- Build settings (no Wrangler):
  - Build command: leave empty (static files only)
  - Output directory: `.` (repo root with index.html) or `ecommerce` if serving from that folder
  - Do NOT set `npx wrangler deploy` here; Workers are routed via Dashboard → Worker Routes

## 9) Remove legacy

- [x] Remove legacy hosting directories
- [x] Strip legacy SDK includes from HTML files

## 14) Homepage CMS (admin dashboard)

- [x] Dashboard tab UI — Products + Homepage Editor tabs (Bootstrap tab nav)
- [x] Homepage Editor pane in `ecommerce/dashboard.html` with sections:
  - Billboard (title + description)
  - Hero slides (image/title/text/link/label + add/remove)
  - Who We Are (label, headline, body, stats)
  - Features (label, headline, 3 cards with title/body)
  - Testimonials (quote/author/role, add/remove)
  - Newsletter headline
- [x] Worker `GET /api/homepage` returns full content (all sections)
- [x] Worker `POST /api/homepage` now saves extended fields (`whoWeAre`, `features`, `testimonials`, `newsletter`)
- [x] `ecommerce/index.html` `initHomepageCms()` populated from `/api/homepage` for all sections
- [x] Hero banner flash fix — hero section starts `visibility:hidden`, revealed after Swiper is initialised from CMS data
- [x] Single-slide hero — when billboard fallback is the only slide, navigation arrows are hidden and Swiper navigation is disabled
- [x] Add `ecommerce/index.html` DOM population for `whoWeAre`, `features`, `testimonials`, `newsletter` sections (CMS-driven content rendering)

## 12) Ecommerce ↔ AR integration

- [x] Connect the AR dashboard to the ecommerce side (product catalog → target linking)
  - Worker: `GET /api/viewer/active?brand=&product=` prefers `products.slug → products.ar_target_id` when available.
- [x] Add an ecommerce dashboard to regulate products (CRUD + publish/unpublish + link AR target)
- [x] Add “Store” preview link in Product Dashboard to open the store product page (`/ecommerce/single-product.html?product=<slug|id>`)
- [x] Unify accounts + roles across ecommerce and AR (single session + same role)
  - Role hierarchy: `admin` (full), `brand`/`user` (brand-scoped), `client` (viewer/shop)
  - Use the same Worker cookie session for both `/admin.html` and `/ecommerce/*` (same-origin `/api/*` with `credentials: 'include'`)
  - Update ecommerce UI to read `GET /api/auth/me` and enforce role-based redirects consistently
  - Ensure D1 `users.role` is the single source of truth (no separate ecommerce auth)

### Ecommerce navigation cleanup (template “Pages” dropdown)

- [x] Fix the “Pages” dropdown links in `ecommerce/index.html` (currently template placeholders)
  - [x] Cart: added `ecommerce/cart.html`
  - [x] Checkout: links to `ecommerce/checkout.html`
  - [x] My Account: added `ecommerce/account.html` (Worker auth-aware)
  - [x] Wishlist / Order Tracking: routed to `ecommerce/coming-soon.html?page=...`
  - [x] About / Contact / FAQs / Error Page / Coming Soon: routed to `ecommerce/coming-soon.html?page=...`

### Pages TODO (shop)

Goal: make each page in the shop nav “real” (not placeholders) and consistent across all `ecommerce/*.html`.

- [ ] Navigation consistency
  - [x] `navArDashboard` added to all pages that have auth-aware nav — Dashboard + AR Dashboard shown for admin and brand roles
  - [x] Replace placeholder top-nav links (`href="#"`) for **Blog** and **Contact** — no Blog link exists; Contact is a real page
  - [x] Ensure Login/Logout links reflect Worker session (`GET /api/auth/me`) on every page — confirmed on all 14 ecommerce pages

- [x] About (`ecommerce/about.html`)
  - [x] Replace template copy with INRL/MindAR-specific content — real INRL brand content (hero, stats, mission, values, CTA)

- [x] Cart (`ecommerce/cart.html`)
  - [x] Verify cart UI uses the shared cart storage/logic (add/remove/update qty + totals)
  - [x] Verify "Continue to Checkout" carries the correct state

- [x] Checkout (`ecommerce/checkout.html`)
  - [x] Decide order submission target — aligned to Worker `/api/orders` (same-origin)
  - [x] Confirm success/failure UX and post-checkout cart clearing — cart cleared on success

- [ ] Coming Soon (`ecommerce/coming-soon.html`)
  - [ ] If used as a placeholder for other pages, standardize query param usage (e.g. `?page=wishlist`) and visible title

- [ ] Contact (`ecommerce/contact.html`)
  - [ ] Decide how the contact form is handled (email link vs Worker endpoint) and remove dead form actions

- [ ] Error Page (`ecommerce/error.html`)
  - [ ] Confirm 404 routing behavior (Pages `_redirects`) shows this page when appropriate

- [x] FAQs (`ecommerce/faqs.html`)
  - [x] Replace template FAQs with real support content — Shipping, AR & Digital Identity, Returns & Exchanges sections

- [x] My Account (`ecommerce/account.html`)
  - [x] Require login; redirect unauthenticated users to `/login.html`
  - [x] Verify account details load from Worker session/user (`/api/auth/me`)

- [x] Order Tracking (`ecommerce/order-tracking.html`)
  - [x] Rebuilt with full INRL dark theme navbar + order ID lookup form (real-time tracking TBD)

- [x] Wishlist (`ecommerce/wishlist.html`)
  - [x] Rebuilt with full INRL dark theme navbar + functional localStorage wishlist (Wishlist.add/remove/list via cart.js)

- [ ] Single Product (`ecommerce/single-product.html`)
  - [x] Fix product image gallery thumbnail scroller (Swiper re-init + mousewheel/drag)
  - [x] Populate product tabs from `/api/products` (Description + Additional information)
  - [x] Reviews: load + submit via `GET/POST /api/products/:slug/reviews`
  - [x] Related products: load from `/api/products` filtered by category
  - [ ] Decide whether Shipping & Return content should be CMS-managed

## 10) Verification

- [x] Admin login/logout works
- [ ] Deployed smoke test (Pages + Worker Routes) works end-to-end
  - Verify Worker routes are mapped on the same origin as Pages:
    - `/api*`, `/upload`, `/delete`, `/purge`
  - Verify on `https://<your-site>`:
    - `/api/auth/me` returns `{ user: null }` when logged out
    - `/login.html` can log in
    - `/ecommerce/index.html` loads
    - `/ecommerce/product.html?product=<slug>` loads product + reviews
    - (legacy) `/ecommerce/single-product.html?product=<slug>` redirects to `product.html`
- [ ] Run automated smoke test script:
  - `powershell -ExecutionPolicy Bypass -File scripts/verify-step10.ps1 -BaseUrl "https://<your-site>" -Email "admin@example.com" -Password "..." -ProductSlug "<existing-slug>"`
- [ ] Upload .mind/video/image -> URLs resolve from R2
- [ ] Create/activate target -> Viewer plays video
- [ ] Delete target -> R2 assets deleted

## 13) User flows (admin/brand vs shoppers)

Goal: Document and verify the real end-to-end paths users take through auth, dashboards, and the shop.

### Admin / Brand flow

- [x] Sign in at `/login.html` (Worker session) and redirect by role
  - `admin` → `/admin.html`
  - `brand` → `/brand.html`
- [x] Role-based access guards
  - `/admin.html` requires `admin|brand`
  - `/brand.html` requires `brand` (and redirects admins to `/admin.html`)
  - `/ecommerce/dashboard.html` requires `admin|brand`
- [x] Manage product catalog in `/ecommerce/dashboard.html` (CRUD + publish + link AR target)
- [x] Preview store product page from dashboard (`Store` link → `/ecommerce/single-product.html?product=<slug|id>`)
- [x] AR Dashboard link added to `/ecommerce/dashboard.html` tab nav (visible to both brand and admin users)
- [x] Admin stats panel in `/admin.html` expanded — shows Total Targets, Active Targets, Brand Accounts, Total Products, Published, AR-Linked Products (fetches `/api/targets` + `/api/products` in parallel)
- [x] Worker-native brand user provisioning — admin can create brand users via `/api/admin/brand-users` from the Admin section of `/admin.html`
- [x] Worker `GET /api/admin/users` endpoint — lists all registered users (admin only, filterable by role)
- [x] Brand Accounts table in Admin section of `/admin.html` — lists brand users with email, brand(s), and creation date; refreshes on every dashboard load
- [x] Replace/remove legacy Supabase invite/token UI in `/admin.html` (no legacy code found — already clean)
- [x] Navigation consistency — `navArDashboard` link added to `coming-soon.html`, `error.html`, `order-tracking.html`, `wishlist.html`; Dashboard/AR Dashboard now visible for both admin and brand roles
- [x] `account.html` auth-aware nav — Login/Logout/Dashboard/AR Dashboard links wired to Worker session

### Shopper flow

- [x] Anonymous shopping works (browse store pages without login)
- [x] Deprecated `/ecommerce/login.html` redirects to `/login.html` (single login for AR + shop)
- [x] Shopper account model — Option B implemented
  - `ecommerce/signup.html` created (INRL dark-theme, Bootstrap, mirrors login.html)
  - Posts to `/api/auth/register` (rate-limited, creates `role:'client'` user)
  - `ecommerce/login.html` "Create one" link updated → `signup.html`
  - `canDashboard` fixed across all 10 ecommerce pages (`admin || brand`)
  - `navArDashboard` wired on all pages not previously fixed
- [ ] Verify cart behavior end-to-end (add/remove/update qty + cart count + totals across pages)
- [x] Checkout submission: aligned to Worker `/api/orders`
  - Fixed: `ecommerce/js/config.js` `MINDAR_API_BASE` changed from `http://localhost:8080` to `''` (same-origin)
  - `checkout.js` already calls `${API_BASE}/api/orders`; cart is cleared on success
- [x] Single product page hydrates from `/api/products`
  - Gallery Swiper scroller works after dynamic slide injection
  - Tabs: Description + Additional information populate from product record

---

## 15) AR Dashboard redesign ✅

Goal: Bring `admin.html` and `brand.html` in line with the INRL ecommerce design system (dark theme, Bootstrap 5, Roboto Mono / Averia Serif Libre, green `#00ED0A` accent, brutalist card borders) so the full product feels visually consistent.

- [x] Redesign `admin.html` — replaced Tailwind with Bootstrap 5 + INRL dark theme
  - Dark `#1C1C1C` background, `#212121` card panels, `3px solid #333` borders
  - Green `#00ED0A` accent for active states, buttons, badges
  - Roboto Mono for labels/code, Averia Serif Libre for headings
  - Top navbar replacing sidebar (matches ecommerce pages), Bootstrap offcanvas on mobile
  - Stats panel, target table, brand accounts table — all restyled
- [x] Redesign `brand.html` — same design system (brand-scoped view)
  - Upload form, target list, activate/deactivate controls
- [x] Top navbar on both pages with auth-aware nav links using `auth-worker.js`



## 11) Optional: CDN purge support (CF_API_TOKEN / CF_ZONE_ID)

When to enable: If `ASSETS_DOMAIN` uses your Cloudflare zone (custom domain) and you cache assets aggressively (e.g., long TTL, Cache Everything), add purge so deletions/overwrites reflect instantly at the edge.

- [ ] Ensure `ASSETS_DOMAIN` is under your Cloudflare zone (not workers.dev)
- [ ] Copy your Zone ID: Websites → your domain → Overview → Zone ID → set Worker variable `CF_ZONE_ID`
- [ ] Create API token: My Profile → API Tokens → Create Custom Token
  - Permissions: `Cache Purge: Zone` (Edit)
  - Zone Resources: Include → Specific Zone → select your domain
  - (Optional) Add `Workers: Edit` if you plan to expand programmatic worker configs
  - Create token and copy the value
- [ ] Add Worker secret `CF_API_TOKEN` (Worker → Settings → Secrets)
- [ ] Deploy
- [ ] Verify purge on delete: upload a file, then delete the target in admin (Worker deletes R2 and purges); the asset URL should return 404 quickly

Manual purge test (optional)

Use the Worker request tester to call `POST /purge` with body:

```json
{ "urls": ["https://ASSETS_DOMAIN/path/to/file"] }
```

Expect `{ ok: true }`, then re-check the asset URL.

---

## 16) Printful Integration

Goal: Wire Printful as the print-on-demand fulfillment backend. When a customer places an order, the Worker forwards it to Printful automatically. Printful prints, packs, and ships the item; webhooks push tracking back so customers can see real status on the order-tracking page.

### Overview of the full flow

```
Customer checkout (checkout.html)
  → POST /api/orders (Worker)
    → Save order to D1
    → Forward to Printful POST /v2/orders
    → Store printful_order_id in D1
  ← { order_id }

Printful ships the item
  → POST /api/webhooks/printful (Worker)
    → Verify webhook token
    → Update D1 order: tracking_number, tracking_url, carrier, status

Customer visits order-tracking.html
  → GET /api/orders/:id (Worker)
  ← { printful_status, tracking_number, tracking_url, carrier }
```

---

### Phase 1 — Printful account & Worker secrets

- [ ] Create a Printful store and connect your product catalog at printful.com
- [ ] Generate a Printful API token: Printful Dashboard → Settings → Stores → API → Generate token
- [ ] Add Worker secret `PRINTFUL_API_KEY` (Wrangler or CF Dashboard → Worker → Settings → Secrets)
- [ ] Add Worker variable `PRINTFUL_STORE_ID` (string, found in Printful dashboard URL or store settings)

```bash
wrangler secret put PRINTFUL_API_KEY
```

---

### Phase 2 — D1 schema additions

- [ ] Add Printful columns to `products` table:

```sql
ALTER TABLE products ADD COLUMN printful_sync_product_id INTEGER;
ALTER TABLE products ADD COLUMN printful_sync_variant_id INTEGER;
```

- [ ] Add Printful + tracking columns to `orders` table:

```sql
ALTER TABLE orders ADD COLUMN printful_order_id TEXT;
ALTER TABLE orders ADD COLUMN printful_status TEXT DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN tracking_number TEXT;
ALTER TABLE orders ADD COLUMN tracking_url TEXT;
ALTER TABLE orders ADD COLUMN carrier TEXT;
ALTER TABLE orders ADD COLUMN shipped_at TEXT;
```

- [ ] Add SQL migration file at `sql/printful_migration.sql` with both `ALTER TABLE` blocks above
- [ ] Run migration against your D1 database (CF Dashboard → D1 → your db → Console, or `wrangler d1 execute`)

---

### Phase 3 — Product catalog sync with Printful

Goal: each product in D1 carries its Printful `sync_product_id` and `sync_variant_id` so orders can be forwarded correctly.

- [ ] Worker endpoint `POST /api/admin/printful/sync` (admin-only):
  - Call Printful `GET /v2/sync-products?store_id=PRINTFUL_STORE_ID`
  - For each sync product + its variants, upsert into D1 `products`:
    - `printful_sync_product_id`, `printful_sync_variant_id`
    - Optionally sync `name`, `price`, and `image_url` from Printful
  - Return `{ synced: N }` summary
- [ ] Alternative (manual): Admin sets `printful_sync_variant_id` per product in the dashboard product edit form — add the field to the dashboard product CRUD form in `ecommerce/dashboard.html`
- [ ] Dashboard "Printful" tab in `ecommerce/dashboard.html`:
  - "Sync from Printful" button → calls `POST /api/admin/printful/sync`
  - Display sync status (`printful_sync_variant_id` set / unset) per product in the product table

---

### Phase 4 — Product variants at checkout

Goal: Printful products have size/color variants. Cart items must carry the correct `printful_sync_variant_id` so the order maps to the right SKU.

- [ ] Worker `GET /api/products/:slug/variants` — return the list of variants (fetched from Printful or stored in D1) with `id`, `name`, `size`, `color`, `price`, `printful_sync_variant_id`
- [ ] `ecommerce/product.html` (and `single-product.html`) — fetch variants and render size/color selectors; set selected `variantId` before "Add to Cart"
- [ ] `ecommerce/js/cart.js` — store `variantId` (i.e. `printful_sync_variant_id`) alongside each cart item when adding to cart
- [ ] `ecommerce/js/checkout.js` — include `variantId` per item in the `POST /api/orders` payload

Cart item shape (target):

```json
{ "id": "slug-SIZE", "name": "Tee – M", "price": 35, "qty": 1, "variantId": 123456789 }
```

---

### Phase 5 — Worker order endpoint → Printful fulfillment

File: `cloudflare/worker/index.js` — update `POST /api/orders` handler.

- [ ] After saving the order to D1, build the Printful order payload:

```json
{
  "recipient": {
    "name": "First Last",
    "address1": "...",
    "city": "...",
    "state_code": "CA",
    "country_code": "US",
    "zip": "...",
    "email": "customer@example.com"
  },
  "items": [
    { "sync_variant_id": 123456789, "quantity": 1 }
  ]
}
```

- [ ] Call `POST https://api.printful.com/v2/orders?store_id=PRINTFUL_STORE_ID` with `Authorization: Bearer PRINTFUL_API_KEY`
- [ ] On success: store `printful_order_id` + `printful_status: 'pending'` in D1 `orders` row
- [ ] On Printful API error: log, set `printful_status: 'error'`, still return `{ order_id }` so checkout succeeds (do not block the customer)
- [ ] Add helper `callPrintful(path, method, body)` in the Worker to centralise Printful HTTP calls + error handling

---

### Phase 6 — Printful webhooks → order status

- [ ] Add Worker secret `PRINTFUL_WEBHOOK_TOKEN` (any random string you generate, e.g. `openssl rand -hex 32`)
- [ ] Register the webhook **via the dashboard** — go to `ecommerce/dashboard.html` → Printful tab → enter your site URL → click "Register Webhook". This calls `POST /api/admin/printful/webhook/register` which hits Printful's API (`POST /v2/webhooks`) automatically.
- [ ] Worker endpoint `POST /api/webhooks/printful` (no auth cookie required, public):
  - Read `X-Printful-Webhook-Token` header; reject with 401 if mismatch
  - Parse event body; look up D1 order by `printful_order_id`
  - `package_shipped` → update `tracking_number`, `tracking_url`, `carrier`, `shipped_at`, `printful_status: 'shipped'`
  - `order_updated` → update `printful_status` from event data
  - `order_failed` → set `printful_status: 'failed'`
  - Return `{ ok: true }` (Printful expects 200)
- [ ] Add `/api/webhooks/printful` route to Worker path routing (before auth middleware — this endpoint has its own token validation)
- [ ] Add the webhook route to Cloudflare Worker Routes on the same domain: `shop.inrl.co/api/webhooks/printful`

---

### Phase 7 — Order tracking page

- [ ] Worker `GET /api/orders/:id`:
  - Admin/brand: return full order row (all columns incl. `printful_status`, `tracking_number`, `tracking_url`, `carrier`)
  - Client: verify `orders.customer_email` matches session user email before returning
- [ ] `ecommerce/order-tracking.html` — after fetching the order:
  - Show `printful_status` badge (pending / shipped / failed)
  - If `tracking_url` is set, show "Track Package" link and carrier name
  - If `tracking_number` is set, show copy-to-clipboard or direct carrier link

---

### Phase 8 (optional) — Live shipping rates at checkout

- [ ] Worker `POST /api/shipping/rates`:
  - Accept `{ recipient, items }` from client
  - Proxy to Printful `POST /v2/shipping/rates`
  - Return array of `{ id, name, rate, currency, minDeliveryDays, maxDeliveryDays }`
- [ ] `ecommerce/checkout.html` — after address is filled, call `/api/shipping/rates` and render a shipping method selector; add selected shipping rate to the order payload
- [ ] Include `shipping` choice in `POST /api/orders` payload → pass `retail_costs.shipping` or the chosen rate to the Printful order

---

### Phase 9 — Admin dashboard: Printful orders view

- [ ] Dashboard `ecommerce/dashboard.html` → "Printful" tab:
  - Orders table: `order_id` | `customer` | `printful_status` | `carrier` | `tracking_number` | `shipped_at` | Actions
  - "Refresh status" button per order → calls `POST /api/admin/printful/orders/:printful_order_id/sync` which re-fetches from Printful `GET /v2/orders/:id` and updates D1
  - Filter by status (pending / shipped / failed)
- [ ] Worker `POST /api/admin/printful/orders/:printful_order_id/sync` (admin-only):
  - Call Printful `GET /v2/orders/:printful_order_id`
  - Update D1 `orders` row with latest status + tracking

---

### Phase 10 — Verification

- [ ] Place a test order end-to-end: browse product → select variant → add to cart → checkout → confirm `printful_order_id` is stored in D1
- [ ] Verify Printful receives the order in the Printful dashboard (Orders section)
- [ ] Trigger a test webhook from Printful (Dashboard → Webhooks → Send test) and verify D1 order updates
- [ ] Verify `order-tracking.html` shows correct status and tracking link after webhook fires
- [ ] (Optional) Verify shipping rates appear in checkout after address entry
