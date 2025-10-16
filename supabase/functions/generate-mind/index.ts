// import Deno standard HTTP server
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// import Supabase client for Deno
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ✅ Environment variables are securely provided by Supabase
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Initialize Supabase client (with full service role for storage + DB)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ✅ Helper: JSON Response utility
function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ✅ Helper: convert image buffer to `.mind` data
async function convertToMindFile(imageBuffer: Uint8Array): Promise<Uint8Array> {
  // ⚠️ In a real setup, replace this with your actual MindAR converter logic
  // Example: using a CLI tool or web API to generate `.mind`
  // For now, we just simulate conversion by returning the original buffer
  console.log("🧠 Converting image to .mind format...");
  await new Promise((r) => setTimeout(r, 800)); // simulate processing delay
  return imageBuffer;
}

// ✅ Handle HTTP requests
serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Only POST requests allowed" }, 405);
    }

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return jsonResponse({ error: "Expected multipart/form-data" }, 400);
    }

    // Parse form data
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const videoUrl = form.get("videoUrl") as string | null;

    if (!file) {
      return jsonResponse({ error: "Missing image file" }, 400);
    }

    if (!videoUrl) {
      return jsonResponse({ error: "Missing video URL" }, 400);
    }

    // Read file into buffer
    const arrayBuffer = await file.arrayBuffer();
    const imageBuffer = new Uint8Array(arrayBuffer);
    const fileExt = file.name.split(".").pop() ?? "jpg";

    // 1️⃣ Upload original image
    const imageFileName = `targets/${crypto.randomUUID()}.${fileExt}`;
    const { data: imageUpload, error: imageError } = await supabase.storage
      .from("mindar-targets")
      .upload(imageFileName, imageBuffer, {
        contentType: file.type,
      });

    if (imageError) {
      console.error("❌ Error uploading image:", imageError.message);
      return jsonResponse({ error: "Failed to upload image" }, 500);
    }

    const imagePublicUrl = `${SUPABASE_URL}/storage/v1/object/public/mindar-targets/${imageFileName}`;

    // 2️⃣ Convert to .mind file
    const mindBuffer = await convertToMindFile(imageBuffer);

    // 3️⃣ Upload .mind file
    const mindFileName = imageFileName.replace(/\.[^/.]+$/, ".mind");
    const { error: mindError } = await supabase.storage
      .from("mindar-targets")
      .upload(mindFileName, mindBuffer, {
        contentType: "application/octet-stream",
      });

    if (mindError) {
      console.error("❌ Error uploading .mind file:", mindError.message);
      return jsonResponse({ error: "Failed to upload .mind file" }, 500);
    }

    const mindPublicUrl = `${SUPABASE_URL}/storage/v1/object/public/mindar-targets/${mindFileName}`;

    // 4️⃣ Save record to database
    const { error: dbError } = await supabase.from("targets").insert([
      {
        mindUrl: mindPublicUrl,
        videoUrl,
        imageUrl: imagePublicUrl,
        created_at: new Date().toISOString(),
      },
    ]);

    if (dbError) {
      console.error("❌ Error saving to database:", dbError.message);
      return jsonResponse({ error: "Database insert failed" }, 500);
    }

    // ✅ All done
    console.log("✅ Upload + save successful!");
    return jsonResponse({
      success: true,
      message: "Target successfully uploaded and converted",
      mindUrl: mindPublicUrl,
      imageUrl: imagePublicUrl,
    });
  } catch (err: unknown) {
    console.error("🔥 Unexpected error:", err);
    if (err instanceof Error) {
      return jsonResponse({ error: err.message }, 500);
    }
    return jsonResponse({ error: "Unknown server error" }, 500);
  }
});
