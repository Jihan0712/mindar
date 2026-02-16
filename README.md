# MindAR (INRL AR)

Static UI (admin + viewer + shop) hosted on Cloudflare Pages, with a same-origin Cloudflare Worker API at `/api/*`.

**Quick links**
- Admin UI: [admin.html](admin.html)
- Viewer: [index.html](index.html)
- Shop: [ecommerce/index.html](ecommerce/index.html)
- Product Dashboard: [ecommerce/dashboard.html](ecommerce/dashboard.html)
- Single Product: [ecommerce/single-product.html](ecommerce/single-product.html)
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

Shop pages that hydrate from the catalog:

- [ecommerce/single-product.html](ecommerce/single-product.html) fetches `GET /api/products` and populates the product gallery + tabs (Description + Additional information) from the product record.
- [ecommerce/dashboard.html](ecommerce/dashboard.html) manages the product catalog for `admin`/`brand` roles and includes a “Store” link to preview the store page.

All browser calls are same-origin and must send cookies (`credentials: 'include'`).

## D1 schema reference

A reference D1 (SQLite) schema is included at [sql/d1_schema.sql](sql/d1_schema.sql).

## Cloudflare-only testing (no local setup)

Because auth uses cookies, the UI and Worker API must be **same-origin**.

Use Cloudflare Pages + Worker Routes:

- In Cloudflare Dashboard → Workers → your worker → Settings → Routes
	- Map your site host to the worker for: `/api*`, `/upload`, `/delete`, `/purge`
- Ensure your Pages site is deployed (custom domain or `*.pages.dev`).

Smoke test on the deployed origin:

- Visit `https://<your-site>/api/auth/me` and confirm it returns `{ user: null }` when logged out
- Log in at `https://<your-site>/login.html`
- Open `https://<your-site>/ecommerce/dashboard.html` (admin/brand only)
- Open `https://<your-site>/ecommerce/single-product.html?product=<slug>` and confirm product + reviews load

## Optional checkout API (local demo)

The checkout pages post orders to `http://localhost:8080/orders` by default.

- Backend source: [backend/server.js](backend/server.js)
- Start it (from `backend/`): `npm install` then `npm start`

---

See [TODO.md](TODO.md) for the project checklist and planned work.
