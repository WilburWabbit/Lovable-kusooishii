// ============================================================
// Queue eBay Quantity Sync
// ------------------------------------------------------------
// Lightweight wrapper around the shared eBay inventory sync
// helper. Lets the admin UI (write-off, ship, return dialogs)
// queue a listing outbox command after mutating stock_unit /
// sales_order_line directly via PostgREST.
//
// Body: { skuIds?: string[]; skuCodes?: string[] }
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { verifyServiceRoleJWT } from "../_shared/auth.ts";
import { pushEbayQuantityForSkus } from "../_shared/ebay-inventory-sync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Auth: admin/staff or service-role
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    if (!verifyServiceRoleJWT(token, supabaseUrl)) {
      const { data: { user }, error: authErr } = await admin.auth.getUser(token);
      if (authErr || !user) return json({ error: "Unauthorized" }, 401);
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
      const hasAccess = (roles ?? []).some(
        (r: { role: string }) => r.role === "admin" || r.role === "staff",
      );
      if (!hasAccess) return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const skuIds: string[] = Array.isArray(body.skuIds) ? body.skuIds.filter(Boolean) : [];
    const skuCodes: string[] = Array.isArray(body.skuCodes) ? body.skuCodes.filter(Boolean) : [];

    // Resolve sku_codes → sku_ids if the caller passed codes instead.
    if (skuCodes.length > 0) {
      const { data: rows } = await admin
        .from("sku")
        .select("id")
        .in("sku_code", skuCodes);
      for (const r of (rows ?? []) as { id: string }[]) skuIds.push(r.id);
    }

    const unique = new Set(skuIds);
    if (unique.size === 0) {
      return json({ success: true, queued: 0, withdrawn: 0, failed: 0, note: "no skus" });
    }

    const result = await pushEbayQuantityForSkus(admin, unique, {
      source: "sync-ebay-quantity",
      orderId: body.orderId,
    });

    return json({ success: true, queued: result.pushed + result.withdrawn, withdrawn: result.withdrawn, failed: result.failed, skusProcessed: unique.size });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("sync-ebay-quantity failed:", msg);
    return json({ error: msg }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
