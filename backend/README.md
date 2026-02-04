# Checkout demo backend

This folder contains a minimal Express server used by the checkout pages as a demo API.

Endpoints:
- `POST /orders` — accepts `{ cart, customer, total }` and returns `{ order_id, status, total }` (no persistence)
- `GET /health` — returns `{ ok: true }`

Env vars:
- `ALLOWED_ORIGINS` — comma-separated allowlist for CORS (default `*`)

Local run:

```bash
cd backend
npm install
npm start
```

By default the checkout JS posts to `http://localhost:8080/orders`.
