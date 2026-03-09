import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Download CSV from storage
    const { data: fileData, error: dlError } = await supabase.storage
      .from("media")
      .download("imports/sets.csv");
    if (dlError) throw new Error(`Download error: ${dlError.message}`);

    const csvText = await fileData.text();
    const lines = csvText.split("\n").filter((l) => l.trim());
    // Skip header
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

    // Insert themes in batches, on conflict do nothing
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

    // Parse products
    const products = dataLines.map((line) => {
      const cols = parseCSVLine(line);
      return {
        mpn: cols[0],
        name: cols[1],
        release_year: cols[2] ? parseInt(cols[2], 10) || null : null,
        theme_id: cols[4] ? themeMap.get(cols[4]) || null : null,
        retired_flag: false,
        status: "active",
        product_type: "set",
      };
    }).filter((p) => p.mpn && p.name);

    // Clear existing catalog_product data
    const { error: delError } = await supabase
      .from("catalog_product")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000"); // delete all
    if (delError) console.error("Delete error:", delError.message);

    // Insert products in batches
    const BATCH = 500;
    let inserted = 0;
    let errors = 0;
    for (let i = 0; i < products.length; i += BATCH) {
      const batch = products.slice(i, i + BATCH);
      const { error } = await supabase.from("catalog_product").insert(batch);
      if (error) {
        console.error(`Batch ${i} error:`, error.message);
        errors++;
      } else {
        inserted += batch.length;
      }
    }

    return new Response(
      JSON.stringify({
        themes: themeRows.length,
        products_parsed: products.length,
        products_inserted: inserted,
        batch_errors: errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
