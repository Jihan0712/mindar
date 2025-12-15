# MindAR — Admin & Viewer (INRL AR)

This repository provides a lightweight static admin UI and a public AR viewer built on MindAR and A-Frame, using Supabase for authentication and metadata. Over the project's lifetime we've migrated media hosting from Supabase Storage to Cloudflare R2 served by a Cloudflare Worker and implemented secure server-side deletion flows. This README documents the repository, a detailed history of changes, and guidance for future updates and integrations.

**Status:** Project is functional. Key pieces still require dashboard configuration (Cloudflare R2/Worker bindings, secrets, and optional Netlify/Supabase function envs).

**Quick links:**
- **Admin UI:** [admin.html](admin.html)
- **Viewer:** [index.html](index.html)
- **Brand registration:** [brand-register.html](brand-register.html)
- **Admin registration:** [admin-register.html](admin-register.html)
- **Netlify functions:** [netlify/functions](netlify/functions)
- **Supabase Edge function (delete-user):** [supabase/functions/delete-user/index.ts](supabase/functions/delete-user/index.ts)
- **Cloudflare Worker:** [cloudflare/worker/index.js](cloudflare/worker/index.js)
- **SQL migrations:** [sql](sql)

**Why this README was updated:**
The project underwent multiple migrations and hardening steps (asset hosting → R2, secure delete flow, URL normalization, migration helpers). This README now captures that history and provides specific operational and developer guidance so I can continue helping you with future work.

**Table of contents**
- **Project overview**
- **Chronological history (what was done)**
- **Files added or modified (important changes)**
- **Deployment & configuration checklist**
- **Security / secrets**
- **Developer notes: how to continue**
- **Troubleshooting & verification**

**Project overview**
- Core idea: store AR target metadata (mindurl, videourl, imageurl) and use MindAR viewer in `index.html` to load the active marker for a brand/product.
- Auth & metadata: Supabase (Auth + Postgres tables). Media storage: Cloudflare R2 (via Worker). Deletions: secured via server-side function that holds a Worker delete secret.

**Chronological history (high-level, actionable)**
- Initial app: static admin/viewer using Supabase Storage for assets and Supabase Auth for users.
- Migration design decision: move heavy media to Cloudflare R2 and serve via a Cloudflare Worker; keep Supabase for auth and metadata only.
- Implemented Cloudflare Worker endpoints: POST `/upload` (form multipart → R2 put), POST `/delete` (delete by key or URL, requires secret), POST `/purge` (optional Cloudflare cache purge), GET `/<key>` (serve object with correct CORS and Cache-Control).
- Patched frontends (`admin.html`, `brand.html`) to upload to the Worker (uploadToWorker helper) and to defensively normalize returned URLs (ensure `https://` prefix when necessary).
- Implemented migration helpers & SQL guidance to move existing assets from Supabase Storage → R2 (asset_migration strategy and SQL steps delivered). Temporary migration UI added and later removed after the user ran migration.
- Fixed thumbnail & CORS issues by returning proper CORS headers from the Worker and normalizing ASSETS_DOMAIN handling.
- Hardened delete flow: Worker now requires `WORKER_DELETE_KEY` for deletes; clients must call a server function (Netlify function `delete-assets.js` or a Supabase Edge Function) that holds `WORKER_DELETE_KEY` and forwards delete requests to the Worker.
- Updated Supabase Edge Function and Netlify delete-user functions to forward asset deletions to the Worker via the server-held secret.
- Added defensive viewer update: `index.html` now exposes an `applyActiveTarget()` helper and listens for `orientationchange` and `resize` to re-apply MindAR/video attributes so rotation doesn't break playback.

**Files added or significantly modified (summary)**
- `cloudflare/worker/index.js` — Worker implementation (GET/POST handlers, CORS, ASSETS_DOMAIN normalization). Security: checks `x-admin-key` on delete.
- `cloudflare/worker/wrangler.toml` — corrected bindings and env placeholders.
- `admin.html`, `brand.html` — switched uploads to use Worker `/upload`, added `uploadToWorker()` helper, defensive URL normalization, and updated delete flows to call a server forward function.
- `index.html` — viewer; updated to reapply active target on `orientationchange`/`resize` and expose `window.applyActiveTarget` for programmatic recovery.
- `netlify/functions/delete-assets.js` — new server-forward function that validates admin and forwards deletes to Worker with `WORKER_DELETE_KEY` (Netlify env var required).
- `netlify/functions/delete-user.js` and `supabase/functions/delete-user/index.ts` — updated to forward asset deletions securely to Cloudflare Worker.
- `sql/` — migration SQL and helpers for normalizing `is_active` per brand.

**Deployment & configuration checklist (must-do items)**
- Cloudflare Worker: create a Worker, bind R2 bucket as `ASSETS_BUCKET`, and set env vars:
  - `ASSETS_DOMAIN` — optional custom domain for assets (include https:// or set to null to auto-resolve).
  - `WORKER_DELETE_KEY` — strong random secret (used by server functions only).
  - `ALLOWED_ORIGINS` — comma-separated origins to allow CORS from.
  - `CF_API_TOKEN` and `CF_ZONE_ID` — required only if you want the Worker to call Cloudflare cache purge on delete.
- R2: create an R2 bucket and grant the Worker write/read/delete permissions.
- Netlify (optional): if still hosting server-forward functions on Netlify, set env vars `WORKER_BASE` (worker base URL) and `WORKER_DELETE_KEY` and redeploy functions.
- Supabase Edge Functions (alternative to Netlify): deploy `supabase/functions/delete-user` and set `WORKER_BASE` and `WORKER_DELETE_KEY` in function envs.

**Security / secrets**
- Never store `SUPABASE_SERVICE_ROLE_KEY` in client-side code. Keep it in server-side envs for Edge/Netlify functions only.
- `WORKER_DELETE_KEY` must only exist in server envs (Netlify or Supabase Edge). Clients must not have this key; otherwise deletes can be abused.
- If you enable Cloudflare cache purge, create a scoped API token with `Cache Purge: Zone` and `Workers: Edit` permissions and keep `CF_API_TOKEN` secret.

**Developer notes: how I can help next**
- Configure Cloudflare: I can prepare a `wrangler` deploy config or step-by-step dashboard instructions and verify the Worker binding.
- Replace Netlify with Cloudflare Pages + Supabase Edge Functions: I can convert `netlify/functions/delete-assets.js` to a Supabase Edge Function and update admin calls.
- Add compile-service (optional): scaffold a small Node service that runs tfjs-node compilation workloads if you want server-side compilation and storage of heavy artifacts.
- Add e2e tests: small Puppeteer script that uploads an asset, sets active target, loads `index.html?brand=...`, and checks that the video plays and that delete flow removes R2 object.

**Troubleshooting & verification steps**
- After Worker deploy and env setup: run an upload from `admin.html` and confirm the returned URL resolves and the thumbnail loads in the admin list.
- Test delete flow: call the server-forward endpoint (`/.netlify/functions/delete-assets` or Supabase Edge Function) with the admin token and check that the object disappears from R2.
- If thumbnails are broken: check Worker logs for CORS issues and ensure `ASSETS_DOMAIN` is normalized with `https://` if you use a custom domain.

**Immediate next steps I recommend**
- Configure Cloudflare dashboard (R2 bucket + Worker + secrets). I can generate a deployable wrangler config and a checklist to finish this.
- Migrate Netlify functions to Supabase Edge Functions if you want to remove Netlify hosting.
- Add automated e2e verification for upload/delete/view flows.

If you'd like, I will also open a small PR that adds a `CHECKLIST.md` with step-by-step Cloudflare dashboard instructions and a tiny `deploy_worker.sh` script to make deployment smoother.

---

Last update: detailed project history and operational guidance added to help future updates and integrations. If you want more/less detail in any section, tell me which part to expand or where to add runbook-style commands.
# MindAR — Admin & Viewer (INRL AR)

This repository contains a lightweight static admin and viewer UI for a Supabase-backed AR system (MindAR-based). It includes admin pages to upload/compile AR targets, manage brands, invitations and admin tokens, and a viewer page which loads the active target for a brand.

This README summarizes how the code works, how the pieces fit together, and how to set up and run the project locally with Supabase.

## Project structure (important files)

- `admin.html` — Admin dashboard UI. Upload targets, compile markers, list targets, set active target, manage invites & admin tokens, and generate brand/admin registration links.
- `supabase/functions/admin-delete-user/index.ts` — Edge Function that validates admin privileges, deletes domain rows, and removes the Auth user. Deploy in production for reliable deletions.
- `index.html` — Public viewer page. Loads the active target (optionally for a brand) and shows the AR viewer. It expects one active target per brand.
- `index.html` — Public viewer page. Loads the active target (optionally for a brand and product) and shows the AR viewer. It expects one active target per (brand,product).
- `register.html`, `brand-register.html`, `admin-register.html` — Registration pages for generic users, brand invite flows, and admin token flows.
- `sql/001_enforce_single_active_target.sql` — Migration SQL to enforce one active target per brand and add an RPC (`set_active_target`) that atomically switches the active target scoped to the brand.
- `sql/README.md` — Short guidance for running the migration and normalizing duplicate active rows.

## Overview / data model expectations

This front-end expects a Supabase project with the following tables and (optionally) RPCs. Column names used by the UI are listed next to the table name.

- `public.targets` (used heavily by the UI)
  - Columns used: `id` (uuid), `name`, `mindurl`, `videourl`, `imageurl`, `brand` (text), `user_id` (uuid of uploader), `is_active` (boolean), `created_at` (timestamptz)
  - Semantics: There should be at most one `is_active = true` row per brand. If `brand` is NULL, targets belong to the global bucket.

- `public.profiles`
  - Columns used: `user_id`, `name`, `brand` (text)
  - Used to display brand association for users.

- `public.admins`
  - Columns used: `user_id`
  - Marks admin users.

 - `public.brand_invitations`
  - Columns used: `id`, `email`, `brand`, `name`, `created_by`, `created_at`
  - Brand invite rows. Admins create brand invitations; `brand-register.html` uses a SECURITY DEFINER RPC to load invites and allow brand users to register.

 - `public.admin_tokens`
  - Columns used: `token`, `created_by_id`, `created_at`, `consumed_at`
  - Admin registration tokens; creation of tokens is restricted to existing admins (RPC), and `admin-register.html` consumes tokens during admin signup.

## Key RPCs (recommended)

For RLS-protected setups we recommend these SECURITY DEFINER RPCs (the front-end prefers them):

 - `public.create_brand_invite(p_brand text, p_email text)` — creates a brand invite; the migration enforces that only admins can call this RPC.
 - `public.get_brand_invitation_by_id(p_id uuid)` — returns invite details for brand-register prefill (SECURITY DEFINER).
 - `public.create_admin_token()` — creates an admin token (RPC) — only callable by admins.
 - `public.consume_admin_token(p_token uuid)` — atomically marks an admin token consumed (used by `admin-register.html`).
 - `public.set_active_target(p_target_id uuid)` — atomically clears the active flag for the target's brand+product and sets the requested target active. (Provided in `sql/001_enforce_single_active_target.sql`.)
 - `public.get_accounts()` — return a list of users, join `auth.users` + `profiles` + `admins` so admin UI can display emails and brands.

If you enable Row Level Security in Supabase, create these RPCs using SECURITY DEFINER so authenticated web clients can call them while RLS prevents direct selects/updates on tables.

## How the admin flows work (high level)

- Admin authentication is done via Supabase Auth (the admin UI reads session info via `supabase.auth.getSession()` and checks `admins` table to enable Admin tab).
- Upload flow (`admin.html` Upload tab): admin or brand user compiles/upload `.mind` target and video and inserts a row in `targets` with `is_active` defaulting to false.
- View/Set Active: Admins click "Set Active" on a target. The UI attempts to call `supabase.rpc('set_active_target', { p_target_id })`. If the RPC doesn't exist, the UI falls back to a two-step client update (clear others, set the selected id) — note: the fallback may fail under RLS.
 - Pending invites & tokens: Admin UI lists recent `brand_invitations` (pending brand invites) and `admin_tokens` (filtering `consumed_at IS NULL`) and offers copy/delete actions. Brand invites are created via the `create_brand_invite` RPC; admin tokens via `create_admin_token` RPC.
 - Registration pages: `brand-register.html` reads `invite_id` query param, calls `get_brand_invitation_by_id` to prefill brand/email, registers via `supabase.auth.signUp()`, upserts `profiles` (idempotent), and deletes the `brand_invitations` row on success. `admin-register.html` registers admins and consumes an admin token via `consume_admin_token` during signup.

## Viewer (index.html) expectations

`index.html` expects to load the active target for the current brand. There are two common hosting approaches:

1. Single viewer with query params: `index.html?brand=<brand>&product=<product>` — the viewer reads the `brand` and optional `product` parameters and loads `targets` where `is_active = true` and `brand = <brand>` and `product = <product>` (or `brand/product IS NULL` for global). This is the simplest and supports multiple active markers per-brand scoped to product.
2. Per-brand static page: `index-<brand>.html` — if you prefer a separate page per brand (e.g., for SEO or simple hosting), you can create static files and the admin UI can copy links for those files.

The provided admin UI produces `index.html?brand=` links by default (see `copyBrandView()`), which works with approach (1).

## Migration: ensure one active target per brand

Run the SQL in `sql/001_enforce_single_active_target.sql` (open Supabase SQL editor and paste). If the index creation complains about duplicates, normalize first — see `sql/README.md`.

### Normalization guidance (if migration errors)
If you see an error about duplicates when creating the unique index, run the normalization SQL included in `sql/README.md` to keep the newest active per brand and clear the rest.

## Running locally

This is a static HTML front-end. To run locally for development:

1. Clone repo and open a simple static server in the repo root. If you have Python installed you can run:

```powershell
# from the project root (Windows PowerShell)
python -m http.server 8000
```

2. Open `http://localhost:8000/admin.html` and `http://localhost:8000/index.html` in your browser.

3. Ensure `admin.html` contains the correct Supabase URL & anon key (these are currently hard-coded for convenience in this repo; in production use env variables or a build step).

## Production: Full account deletion via external backend (Option 2)

If you don’t want to use Supabase Edge Functions, run a tiny secure backend (Node/Express or similar) and point the Admin UI to it. The backend keeps the Service Role key server‑side and performs the privileged deletion.

Expected endpoint

- Method: POST
- URL: `${BACKEND_API_URL}/admin-delete-user`
- Headers: `Authorization: Bearer <access_token>`, `Content-Type: application/json`
- Body: `{ "user_id": "<uuid>" }`
- Response (examples): `{ "status": "deleted" }` or `{ "status": "domain_only", "warning": "..." }`

Server outline (Express)

1) Create a small Express app with a route `/admin-delete-user` that:
- Validates the caller using the passed JWT (via `supabase.auth.getUser()` with Service Role client + Authorization header)
- Confirms the requester is an admin (row exists in `public.admins`)
- Deletes domain rows in `targets`, `admins`, `profiles` for `user_id`
- Calls `auth.admin.deleteUser(user_id)`

2) Configure env vars on your host:
- `SUPABASE_URL=https://YOUR-PROJECT.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=...` (keep secret)
- CORS allowlist for your admin site

3) In `admin.html`, set `BACKEND_API_URL` to your deployed backend origin.

Security notes

- Never put the Service Role key in the browser or inside SQL GUCs meant for clients.
- Use TLS, strict CORS, and (optionally) rate limiting/WAF in front of your backend.

## Backups & safety

- Always export a SQL dump or use Supabase Backups before running migrations that change data (e.g., normalization). The normalization step is destructive for duplicate `is_active` flags.

## Troubleshooting

- If `set_active_target` RPC fails, the admin UI falls back to client updates. If you use strict RLS, you must run the RPC migration.
- If the index creation fails with duplicate keys, run the normalization script from `sql/README.md` and try again.
- If the viewer doesn't show a target, ensure the `targets` table has an `is_active = true` row for the expected brand.

## Where to go next

If you'd like I can:
- Update `index.html` to explicitly read `?brand=` and query by brand so copied viewer links always work out-of-the-box.
- Add a small admin UI tweak to hide/disable "Set Active" for an already active target.
- Convert the migration to use a numeric brand/tenant id instead of text sentinel if you have brand ids.

---

If anything in your Supabase schema differs from the expected shape above, paste your `targets` table schema and I will adapt the docs and migration to match.
