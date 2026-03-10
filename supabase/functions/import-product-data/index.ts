import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ---------- Semicolon-delimited CSV parser (handles quoted multi-line) ---------- */

function parseSemicolonCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ';') { row.push(cell.trim()); cell = ""; }
      else if (ch === '\n') { row.push(cell.trim()); cell = ""; rows.push(row); row = []; }
      else if (ch === '\r') { /* skip */ }
      else { cell += ch; }
    }
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    const hasAccess = (roles ?? []).some((r: { role: string }) => r.role === "admin" || r.role === "staff");
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Download CSV from storage
    const { data: fileData, error: dlError } = await admin.storage
      .from("media")
      .download("imports/products-export.csv");
    if (dlError) throw new Error(`Download error: ${dlError.message}`);

    const csvText = await fileData.text();
    const allRows = parseSemicolonCSV(csvText);
    if (allRows.length < 2) throw new Error("CSV has no data rows");

    const headers = allRows[0];
    const dataRows = allRows.slice(1).filter(r => r.length > 1);

    // Build header index
    const colIdx: Record<string, number> = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    const get = (row: string[], col: string): string | null => {
      const idx = colIdx[col];
      if (idx === undefined) return null;
      const v = row[idx];
      return v && v !== "" ? v : null;
    };

    // Fetch all existing products keyed by id
    const { data: existingProducts, error: epErr } = await admin
      .from("product")
      .select("id, mpn, name, description, piece_count, release_year, retired_flag, subtheme_name, product_hook, highlights, call_to_action, seo_title, seo_description, product_type, age_range, length_cm, width_cm, height_cm, weight_kg")
      .limit(5000);
    if (epErr) throw epErr;

    const productById = new Map<string, any>();
    const productByMpn = new Map<string, any>();
    for (const p of existingProducts ?? []) {
      productById.set(p.id, p);
      productByMpn.set(p.mpn, p);
    }

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of dataRows) {
      const csvId = get(row, "id");
      const csvMpn = get(row, "mpn");
      if (!csvId && !csvMpn) { skipped++; continue; }

      // Find existing product by ID first, then MPN
      let existing = csvId ? productById.get(csvId) : null;
      if (!existing && csvMpn) existing = productByMpn.get(csvMpn);
      if (!existing) { skipped++; continue; }

      const updates: Record<string, any> = {};

      // Only set fields that are currently NULL in the database and non-null in CSV
      const textFields: [string, string][] = [
        ["name", "name"],
        ["description", "description"],
        ["subtheme_name", "subtheme"],
        ["product_hook", "product_hook"],
        ["highlights", "highlights"],
        ["call_to_action", "call_to_action"],
        ["seo_title", "seo_title"],
        ["seo_description", "seo_description"],
        ["age_range", "age_range"],
      ];

      for (const [dbCol, csvCol] of textFields) {
        if (existing[dbCol] == null) {
          const val = get(row, csvCol);
          if (val) updates[dbCol] = val;
        }
      }

      // Numeric fields
      const numFields: [string, string][] = [
        ["piece_count", "piece_count"],
        ["release_year", "year_released"],
        ["length_cm", "length_cm"],
        ["width_cm", "width_cm"],
        ["height_cm", "height_cm"],
        ["weight_kg", "weight_kg"],
      ];

      for (const [dbCol, csvCol] of numFields) {
        if (existing[dbCol] == null) {
          const val = get(row, csvCol);
          if (val) {
            const num = parseFloat(val);
            if (!isNaN(num)) updates[dbCol] = num;
          }
        }
      }

      // retired_flag - only update if currently false and CSV says retired
      if (!existing.retired_flag) {
        const retStatus = get(row, "retirement_status");
        if (retStatus === "retired") updates["retired_flag"] = true;
      }

      // product_type - only update if default
      if (existing.product_type === "set" || existing.product_type == null) {
        const csvType = get(row, "type");
        if (csvType) {
          const mapped = csvType === "Set" ? "set" : csvType === "Minifig" ? "minifig" : csvType.toLowerCase();
          if (mapped !== existing.product_type) updates["product_type"] = mapped;
        }
      }

      if (Object.keys(updates).length === 0) { skipped++; continue; }

      const { error: upErr } = await admin
        .from("product")
        .update(updates)
        .eq("id", existing.id);

      if (upErr) {
        console.error(`Error updating ${existing.mpn}:`, upErr.message);
        errors++;
      } else {
        updated++;
      }
    }

    return new Response(
      JSON.stringify({ csv_rows: dataRows.length, updated, skipped, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
