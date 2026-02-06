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

## 12) Ecommerce ↔ AR integration

- [x] Connect the AR dashboard to the ecommerce side (product catalog → target linking)
  - Worker: `GET /api/viewer/active?brand=&product=` prefers `products.slug → products.ar_target_id` when available.
- [x] Add an ecommerce dashboard to regulate products (CRUD + publish/unpublish + link AR target)
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

## 10) Verification

- [x] Admin login/logout works
- [ ] Upload .mind/video/image -> URLs resolve from R2
- [ ] Create/activate target -> Viewer plays video
- [ ] Delete target -> R2 assets deleted

---

Notes:
- The Worker implementation lives in `cloudflare/worker/index.js` and already supports R2 + D1 + cookie sessions.
- If you want, I can add a `wrangler.toml` skeleton with bindings and GitHub Actions for Pages/Workers deploys.

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
