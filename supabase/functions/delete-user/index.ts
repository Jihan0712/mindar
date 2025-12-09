// @ts-ignore: remote Deno std lib (resolved at runtime)
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
// @ts-ignore: import supabase client from remote ESM (resolved at runtime)
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ADMIN_KEY = Deno.env.get("ADMIN_DELETE_KEY");
const CLEANUP_TABLES = (Deno.env.get("CLEANUP_TABLES") || "").split(",").map((s: string) => s.trim()).filter(Boolean);
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
}

const supabaseAdmin = createClient(SUPABASE_URL ?? "", SERVICE_ROLE ?? "");

serve(async (req: Request) => {
  // CORS preflight handling
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-key, Authorization',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: corsHeaders });

  // Accept either the x-admin-key header or an Authorization: Bearer <token> header
  let provided = req.headers.get('x-admin-key');
  if (!provided) {
    const auth = req.headers.get('authorization') || req.headers.get('Authorization');
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      provided = auth.slice(7).trim();
    }
  }

  if (!ADMIN_KEY || provided !== ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders });
  }

  const userId = body.userId || body.user_id || body.id;
  if (!userId) return new Response(JSON.stringify({ error: 'Missing userId in body' }), { status: 400, headers: corsHeaders });

  try {
    // Optional: clean up rows in configured tables (CLEANUP_TABLES env var comma-separated)
    for (const table of CLEANUP_TABLES) {
      try {
        const { error: delErr } = await supabaseAdmin.from(table).delete().eq('id', userId);
        if (delErr) console.warn(`cleanup ${table} error:`, delErr.message || delErr);
      } catch (e: any) {
        console.warn(`cleanup ${table} exception:`, e);
      }
    }

    // Delete the auth user
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.error('deleteUser error:', error);
      return new Response(JSON.stringify({ error: error.message || error }), { status: 500, headers: corsHeaders });
    }
    // If provided, attempt to delete associated asset URLs via the Worker
    const assets: string[] = Array.isArray(body.assets) ? body.assets : [];
    const workerBase = Deno.env.get('WORKER_BASE') || Deno.env.get('WORKER_UPLOAD_URL') || '';
    const workerKey = Deno.env.get('WORKER_DELETE_KEY') || '';
    const assetResults: any[] = [];
    if (assets.length && workerBase && workerKey) {
      for (const a of assets) {
        try {
          const url = `${workerBase.replace(/\/$/, '')}/delete`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-key': workerKey,
            },
            body: JSON.stringify({ url: a }),
          });
          const txt = await resp.text().catch(() => '');
          assetResults.push({ url: a, status: resp.status, body: txt });
        } catch (e: any) {
          assetResults.push({ url: a, error: e.message || String(e) });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, assetResults }), { status: 200, headers: corsHeaders });
  } catch (err: any) {
    console.error('Unexpected error in delete-user:', err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), { status: 500, headers: corsHeaders });
  }
});
