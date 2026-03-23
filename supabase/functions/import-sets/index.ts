// Redeployed: 2026-03-23
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // --- Auth guard: require admin or staff role ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const hasAccess = roles?.some((r: { role: string }) => r.role === "admin" || r.role === "staff");
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // --- End auth guard ---

    // Download CSV from storage
    const { data: fileData, error: dlError } = await supabase.storage
      .from("media")
      .download("imports/sets.csv");
    if (dlError) throw new Error(`Download error: ${dlError.message}`);

    const csvText = await fileData.text();
    const lines = csvText.split("\n").filter((l) => l.trim());
    const dataLines = lines.slice(1);

    // Extract unique theme names
    const themeNames = new Set<string>();
    for (const line of dataLines) {
      const cols = parseCSVLine(line);
      if (cols[4]) themeNames.add(cols[4]);
    }

    // Upsert themes
    const themeRows = Array.from(themeNames).map((name) => ({
      name,
      slug: slugify(name),
    }));

    const THEME_BATCH = 200;
    for (let i = 0; i < themeRows.length; i += THEME_BATCH) {
      const batch = themeRows.slice(i, i + THEME_BATCH);
      const { error } = await supabase.from("theme").upsert(batch, {
        onConflict: "slug",
        ignoreDuplicates: true,
      });
      if (error) console.error("Theme upsert error:", error.message);
    }

    // Fetch all themes for ID mapping
    const { data: allThemes } = await supabase.from("theme").select("id, name");
    const themeMap = new Map<string, string>();
    for (const t of allThemes || []) {
      themeMap.set(t.name, t.id);
    }

    // Parse products — now with img_url and subtheme_name
    const rawProducts = dataLines.map((line) => {
      const cols = parseCSVLine(line);
      return {
        mpn: cols[0],
        name: cols[1],
        release_year: cols[2] ? parseInt(cols[2], 10) || null : null,
        img_url: cols[3] || null,
        theme_id: cols[4] ? themeMap.get(cols[4]) || null : null,
        subtheme_name: cols[5] || null,
        retired_flag: false,
        status: "active",
        product_type: "set",
      };
    }).filter((p) => p.mpn && p.name);

    // Deduplicate by MPN — keep last occurrence
    const deduped = new Map<string, typeof rawProducts[0]>();
    for (const p of rawProducts) {
      deduped.set(p.mpn, p);
    }
    const products = Array.from(deduped.values());

    // Upsert products by mpn to preserve manually added products
    const BATCH = 500;
    let upserted = 0;
    let errors = 0;
    for (let i = 0; i < products.length; i += BATCH) {
      const batch = products.slice(i, i + BATCH);
      const { error } = await supabase.from("lego_catalog").upsert(batch, {
        onConflict: "mpn",
        ignoreDuplicates: false,
      });
      if (error) {
        console.error(`Batch ${i} error:`, error.message);
        errors++;
      } else {
        upserted += batch.length;
      }
    }

    return new Response(
      JSON.stringify({
        themes: themeRows.length,
        products_parsed: products.length,
        products_upserted: upserted,
        batch_errors: errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
