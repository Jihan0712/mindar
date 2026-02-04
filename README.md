# MindAR (INRL AR)

Static UI (admin + viewer + shop) hosted on Cloudflare Pages, with a same-origin Cloudflare Worker API at `/api/*`.

**Quick links**
- Admin UI: [admin.html](admin.html)
- Viewer: [index.html](index.html)
- Shop: [ecommerce/index.html](ecommerce/index.html)
- Checkout: [ecommerce/checkout.html](ecommerce/checkout.html)
- Worker source: [cloudflare/worker/index.js](cloudflare/worker/index.js)

---

## Architecture

- **Hosting:** Cloudflare Pages serves static HTML/JS/CSS.
- **API:** Cloudflare Worker (routed on the same origin under `/api/*`) for cookie-session auth + CRUD.
- **Database:** Cloudflare D1 for users/brands/targets/sessions/products.
- **Storage:** Cloudflare R2 for `.mind` + videos/images; public URLs via an assets domain.

## Worker configuration

Worker bindings / variables (configure in the Cloudflare dashboard):

- D1 binding: `DB`
- R2 binding: `ASSETS_BUCKET`
- Vars: `ASSETS_DOMAIN` (e.g. `https://assets.example.com`), `ALLOWED_ORIGINS` (comma-separated)
- Secrets: `BOOTSTRAP_ADMIN_KEY` (one-time bootstrap), `WORKER_DELETE_KEY` (server-side deletes only)
- Optional vars/secrets (cache purge): `CF_ZONE_ID`, `CF_API_TOKEN`

## API surface (high level)

See [cloudflare/worker/index.js](cloudflare/worker/index.js) for details.

- Auth: `POST /api/auth/bootstrap-admin`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`
- Targets: `GET /api/targets`, `POST /api/targets`, `POST /api/targets/:id/activate`, `POST /api/targets/:id/deactivate`, `DELETE /api/targets/:id`
- Products: `GET /api/products`, `POST /api/products`, `POST /api/products/:id`, `DELETE /api/products/:id` (`includeUnpublished=1` for admin/brand dashboards)
- Viewer: `GET /api/viewer/active?brand=&product=`

All browser calls are same-origin and must send cookies (`credentials: 'include'`).

## D1 schema reference

A reference D1 (SQLite) schema is included at [sql/d1_schema.sql](sql/d1_schema.sql).

## Local development

The frontend is static; run any static server from the repo root.

PowerShell:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000/admin.html` or `http://localhost:8000/index.html`.

## Optional checkout API (local demo)

The checkout pages post orders to `http://localhost:8080/orders` by default.

- Backend source: [backend/server.js](backend/server.js)
- Start it (from `backend/`): `npm install` then `npm start`

---

See [TODO.md](TODO.md) for the project checklist and planned work.
