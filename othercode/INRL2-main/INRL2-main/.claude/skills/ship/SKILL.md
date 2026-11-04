---
name: ship
description: Ship a change in INRL2 to the live site. Runs the checks, commits with a why-focused message, pushes to main, waits for the Cloudflare build, verifies the live site, and updates the project docs. Use whenever work is ready to go live or Nico asks to deploy, publish or "push".
---

# Ship a change

1. **Check** (all must pass; fix before going on):
   ```bash
   npm run lint && npx tsc -b && npm test && npm run build
   ```
   If the change touches AR, the scene builder, media or markers, also run the `ar-testing` skill.

2. **Docs**: update `docs/STATUS.md` (what changed, what's next) and add any new decision to `docs/product/decisions.md`. Keep `docs/tech/architecture.md` true if structure changed. Record new third-party assets in `CREDITS.md`.

3. **Commit** on `main` (Nico's repo, single branch for now). Subject line in plain English; body says *why*. End with the Co-Authored-By line the session provides. Use Nico's identity:
   ```bash
   git -c user.name="Nicolas Tessier" -c user.email="nico@wearenot.co" commit -F <message>
   ```

4. **Push and wait for Cloudflare** (the build appears as a GitHub check run):
   ```bash
   git push
   SHA=$(git rev-parse --short HEAD)
   for i in $(seq 1 40); do out=$(gh api repos/Wearenico/INRL2/commits/$SHA/check-runs --jq '.check_runs[] | "\(.status)|\(.conclusion)"'); echo "$out" | grep -q completed && break; sleep 10; done; echo "$out"
   ```
   If no check run appears at all after ~2 minutes (an empty list), Cloudflare skipped the push (seen 2026-10-07): push an empty commit (`git commit --allow-empty -m "Re-trigger the Cloudflare build"`) and wait again. `gh` can hang: wrap calls in `perl -e 'alarm 25; exec @ARGV' gh …`.
   On `failure`: Cloudflare's log is only visible in its dashboard. Ask Nico to open Workers & Pages → inrl2 → the failed build and paste the log. Common causes so far: native install scripts (kept off by `.npmrc`), `_redirects` loops (don't add one), Node version (Wrangler needs ≥ 22; don't pin Node 20).

5. **Verify live** at https://inrl2.marine-469.workers.dev:
   ```bash
   for p in / /ar /3d /marker; do curl -s -o /dev/null -w "$p %{http_code}\n" https://inrl2.marine-469.workers.dev$p; done
   curl -s -D - -o /dev/null -H "Range: bytes=0-1" https://inrl2.marine-469.workers.dev/test/video.mp4 | head -1   # expect 206
   ```
   For AR changes: `URL=https://inrl2.marine-469.workers.dev/ar npm run test:ar`.

6. **Tell Nico** in plain language what is live and exactly what to try on the iPhone.
