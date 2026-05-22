# MindAR (INRL AR)

Static UI (admin + viewer + shop) hosted on Cloudflare Pages, with a same-origin Cloudflare Worker API at `/api/*`.

**Quick links**
- Admin UI: [admin.html](admin.html)
- Viewer: [index.html](index.html)
- Shop: [ecommerce/index.html](ecommerce/index.html)
- Product Dashboard: [ecommerce/dashboard.html](ecommerce/dashboard.html)
- Product Page: [ecommerce/product.html](ecommerce/product.html)
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

- [ecommerce/product.html](ecommerce/product.html) fetches `GET /api/products` and populates the product gallery + tabs (Description + Additional information) from the product record.
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
- Open `https://<your-site>/ecommerce/product.html?product=<slug>` and confirm product + reviews load

## Security

All security controls are enforced server-side in the Cloudflare Worker ([cloudflare/worker/index.js](cloudflare/worker/index.js)).

### SQL injection prevention
Every D1 query uses the D1 prepared statement API (`.prepare(sql).bind(...params)`). No user input is ever interpolated directly into SQL strings.

### Brute force / rate limiting
A per-IP in-memory rate limiter applies to all write and auth endpoints:

| Endpoint(s) | Limit |
|---|---|
| `POST /api/auth/login`, `POST /api/auth/register` | 10 req / min |
| `POST /api/orders` | 10 req / min |
| `POST /api/products/:slug/reviews` | 10 req / min |
| `POST /upload` | 20 req / min |

Exceeding the limit returns `HTTP 429 Too Many Requests`.

> **Note:** the rate limiter lives in Worker memory and resets on cold start. For persistent cross-isolate rate limiting, replace with a Cloudflare Durable Object or KV counter.

### Password hashing
Passwords are hashed with **PBKDF2-SHA-256 / 100 000 iterations** with a random per-user salt. All comparisons use a constant-time equality check to prevent timing attacks.

### Session cookies
Session tokens are stored in `HttpOnly; SameSite=Lax; Secure` cookies. The cookie is bound to the same origin as the API (`credentials: 'include'`). Sessions are invalidated server-side on logout and on password change.

### CORS
`Access-Control-Allow-Origin` is only set when the request `Origin` exactly matches an entry in the `ALLOWED_ORIGINS` environment variable. Unconfigured or mismatched origins receive no ACAO header and are blocked by the browser.

### Security headers
Every JSON response from the Worker includes:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'none'
```

### File upload safety
Uploads (`POST /upload`) require an `admin` or `brand` session, enforce a 50 MB size cap, restrict `Content-Type` to image/video/model, and sanitise the destination path to an allowlist of known subdirectories (no path traversal).

---

## Response caching

Public read endpoints return `Cache-Control` headers so Cloudflare's edge (and the browser) can serve cached responses instead of hitting D1 on every request:

| Endpoint | Browser TTL | Edge (s-maxage) |
|---|---|---|
| `GET /api/homepage` | 60 s | 5 min |
| `GET /api/products` (public catalog) | 30 s | 2 min |
| `GET /api/products/:slug` | 60 s | 5 min |
| `GET /api/products/:slug/reviews` | 60 s | 2 min |
| `GET /api/viewer/active` | 30 s | 1 min |
| Admin requests (`includeUnpublished=1`) | no-cache | no-cache |
| R2 assets (`/api/r2/*`, direct R2 GET) | — | 1 year immutable |

---

## Optional checkout API (local demo)

The checkout pages post orders to `http://localhost:8080/orders` by default.

- Backend source: [backend/server.js](backend/server.js)
- Start it (from `backend/`): `npm install` then `npm start`

---

See [TODO.md](TODO.md) for the project checklist and planned work.
