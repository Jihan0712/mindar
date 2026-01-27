# Cloudflare-Only Migration TODO

Goal: Consolidate hosting, API, data, and storage on Cloudflare (Pages + Workers + R2 + D1). This checklist tracks the repo work to complete the migration.

## 1) Worker bindings and secrets

- [x] Create/bind R2 bucket as `ASSETS_BUCKET` (name: mindar-assets)
- [x] Create D1 database and bind as `DB` (name: mindardb)
- [x] Set `ASSETS_DOMAIN` (e.g., https://assets.example.com)
  - Explanation: Public base used by the Worker when returning asset URLs (e.g., `https://assets.example.com/path/to/file`). Include `https://`. If using a Workers.dev route, set it to that domain.
- [x] Set `ALLOWED_ORIGINS` (comma-separated admin/viewer origins)
  - Explanation: CORS allowlist for your Pages domain(s) and local dev (e.g., `https://your-site.pages.dev, http://localhost:8000`). Requests from these origins receive `Access-Control-Allow-Origin`.
- [ ] Set `WORKER_DELETE_KEY` (random long secret)
  - Explanation: Checked by the Worker `POST /delete` endpoint to authorize asset removal from R2. Keep server-side only; do not expose in clients. Set via Wrangler secrets or Dashboard.
- [ ] Set `BOOTSTRAP_ADMIN_KEY` (temporary; delete after bootstrap)
  - Explanation: One-time secret used by `POST /api/auth/bootstrap-admin` to create the first admin. Remove/rotate after bootstrap for safety.
- [ ] (Optional) `CF_ZONE_ID`, `CF_API_TOKEN` for purge
  - Explanation: Enables optional cache purge calls after deletes. Token should be scoped for your zone with `Cache Purge: Zone` (and optionally `Workers: Edit`) permissions.

Example (Wrangler secrets):

```bash
wrangler secret put WORKER_DELETE_KEY
wrangler secret put BOOTSTRAP_ADMIN_KEY
# Optional
wrangler secret put CF_API_TOKEN
```

## 2) Bootstrap admin

- [ ] With `BOOTSTRAP_ADMIN_KEY` set, run:

```bash
curl -i -X POST "$WORKER_URL/api/auth/bootstrap-admin" \
  -H "x-bootstrap-key: $BOOTSTRAP_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  --data '{"email":"admin@example.com","password":"changeme"}'
```

## 3) UI auth → Worker

- [ ] Replace Supabase auth in `admin.html`, `brand-register.html`, `admin-register.html`, `login.html`
- [ ] Use `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`

## 4) Admin targets → Worker/D1

- [ ] List targets via `GET /api/targets`
- [ ] Create via `POST /api/targets`
- [ ] Activate via `POST /api/targets/:id/activate`
- [ ] Deactivate via `POST /api/targets/:id/deactivate`
- [ ] Delete via `DELETE /api/targets/:id` (also removes R2 assets)

## 5) Viewer → Worker

- [ ] Fetch active target from `GET /api/viewer/active?brand=&product=`
- [ ] Apply returned `mindurl` / `videourl` to MindAR viewer

## 6) Asset uploads → Worker

- [ ] Continue using `POST /upload` in `admin.html` (already integrated)
- [ ] Ensure `ASSETS_DOMAIN` is correct/public

## 7) Data migration (Supabase → D1)

- [ ] Export CSV/SQL for `targets`, `admins`, `profiles` (for brands/role)
- [ ] Transform to D1 schema: `users(email, role, password_hash?)`, `brands`, `brand_users`, `targets`, `brand_limits`
- [ ] Write/import script (SQL or Worker one-off) to seed D1

## 8) Hosting on Cloudflare Pages

- [ ] Set up Pages project pointing to repo root
- [ ] Configure custom domain and `ALLOWED_ORIGINS`

## 9) Remove legacy

- [ ] Remove `supabase/` and `netlify/` directories
- [ ] Strip Supabase SDK includes from HTML files

## 10) Verification

- [ ] Admin login/logout works
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
