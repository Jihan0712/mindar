# Admin deletion backend (Option 2)

This folder contains a minimal Express server that exposes POST /admin-delete-user to fully delete accounts (Auth + domain) for admins.

Deploy anywhere (Render, Fly.io, Railway, your VPS) and set these env vars:

- SUPABASE_URL = https://YOUR-PROJECT.supabase.co
- SUPABASE_SERVICE_ROLE_KEY = <service role key>
- ALLOWED_ORIGINS = https://your-admin-site.com (comma-separated list)

Local run:

```bash
cd backend
npm install
npm start
```

Endpoint contract:
- POST /admin-delete-user
- Headers: Authorization: Bearer <access_token>, Content-Type: application/json
- Body: { "user_id": "<uuid>" }
- Response: { status: "deleted" } or { status: "domain_only", warning: "..." }

Security: The Service Role key must only live on the server. The admin UI (`admin.html`) sends the current session JWT and never sees the Service Role key.
