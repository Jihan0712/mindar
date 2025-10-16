import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImageTargetCompiler } from "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js";

Deno.serve(async (req) => {
  try {
    const { imageUrl, videoUrl } = await req.json();

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1️⃣ Download the uploaded image
    const res = await fetch(imageUrl);
    const buffer = await res.arrayBuffer();
    const blob = new Blob([buffer]);

    // 2️⃣ Compile to .mind (using MindAR's built-in ImageTargetCompiler)
    const compiler = new ImageTargetCompiler();
    const targetImage = await createImageBitmap(blob);
    const mindResult = await compiler.compileImageTargets([targetImage]);

    // 3️⃣ Get the generated .mind file (as Uint8Array)
    const mindFile = new Uint8Array(mindResult);

    // 4️⃣ Upload to Supabase Storage
    const filename = imageUrl.split("/").pop()?.replace(/\.(jpg|jpeg|png)$/i, ".mind") ?? "output.mind";
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("assets")
      .upload(`mindfiles/${filename}`, mindFile, {
        upsert: true,
        contentType: "application/octet-stream",
      });

    if (uploadError) throw uploadError;

    // 5️⃣ Get public URL
    const { data: mindPublic } = supabase.storage
      .from("assets")
      .getPublicUrl(`mindfiles/${filename}`);

    // 6️⃣ Save record to targets table
    const { error: dbError } = await supabase.from("targets").insert([
      { mindUrl: mindPublic.publicUrl, videoUrl },
    ]);

    if (dbError) throw dbError;

    return new Response(JSON.stringify({ mindUrl: mindPublic.publicUrl }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
