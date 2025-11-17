# Supabase Edge Function: delete-user

This Edge Function deletes a Supabase Auth user by their `userId` and optionally cleans up rows
in configured tables.

Security
- Protect access by setting `ADMIN_DELETE_KEY` as a secret and sending it in the `x-admin-key` header.
- The function requires the `SUPABASE_SERVICE_ROLE_KEY` to call Admin APIs — store this as a secret.

Environment variables (set these as function secrets in your Supabase project):

- `SUPABASE_URL` — your Supabase project URL (e.g. `https://xxxx.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (keep this secret, server-side only)
- `ADMIN_DELETE_KEY` — a secret token you provide to trusted callers
- `CLEANUP_TABLES` — optional comma-separated list of tables to delete rows from (matching `id` column)

Request
- Method: POST
- Headers: `x-admin-key: <ADMIN_DELETE_KEY>`
- Body (JSON): `{ "userId": "<auth-uid>" }`

Response
- 200: `{ "ok": true }` on success
- 4xx/5xx: `{ "error": "message" }`

Deploy
1. Install Supabase CLI: https://supabase.com/docs/guides/cli
2. Log in and link to project
3. From repo root: `supabase functions deploy delete-user --project-ref <ref>`
4. Set secrets: `supabase secrets set SUPABASE_SERVICE_ROLE_KEY="..." ADMIN_DELETE_KEY="..." SUPABASE_URL="https://<ref>.supabase.co"`

Example curl
```bash
curl -X POST "https://<your-edge-fn-url>" \
  -H "Content-Type: application/json" \
  -H "x-admin-key: <ADMIN_DELETE_KEY>" \
  -d '{"userId":"auth0|abc123"}'
```

Notes
- This function deletes the Auth user and optionally runs simple cleanup on configured tables by `id`.
- For full data cleanup, adapt to your schema and consider transactional behavior or delayed background jobs.
