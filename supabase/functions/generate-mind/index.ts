// supabase/functions/generate-mind/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Environment variables (set in Supabase dashboard)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  try {
    const { imageUrl, videoUrl } = await req.json();
    console.log("🧠 Starting generation for", imageUrl);

    // 1️⃣ Download image
    const res = await fetch(imageUrl);
    const imgBuffer = new Uint8Array(await res.arrayBuffer());

    // 2️⃣ Generate fake .mind file (simulate generation)
    const mindBuffer = new TextEncoder().encode("FAKE_MINDAR_BINARY_" + Date.now());
    const mindFileName = `minds/${crypto.randomUUID()}.mind`;

    // 3️⃣ Upload .mind file to Supabase Storage
    const { data, error: uploadErr } = await supabase.storage
      .from("assets")
      .upload(mindFileName, mindBuffer, {
        contentType: "application/octet-stream",
        upsert: true,
      });

    if (uploadErr) throw uploadErr;

    const { data: mindPublic } = supabase.storage.from("assets").getPublicUrl(mindFileName);

    // 4️⃣ Save record
    const { error: dbErr } = await supabase.from("targets").insert([
      {
        imageUrl,
        videoUrl,
        mindUrl: mindPublic.publicUrl,
        created_at: new Date().toISOString(),
      },
    ]);

    if (dbErr) throw dbErr;

    console.log("✅ Mind file generated successfully!");
    return new Response(
      JSON.stringify({ success: true, mindUrl: mindPublic.publicUrl }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("❌ Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});
