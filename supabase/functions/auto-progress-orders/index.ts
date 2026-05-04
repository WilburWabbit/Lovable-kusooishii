// Redeployed: 2026-03-23
// ============================================================
// Auto-Progress Orders
// Cron job: Progresses orders from 'shipped' → 'delivered'
// after max shipping time (7 days default).
// Called by pg_cron daily — no user auth required.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { verifyServiceRoleJWT } from "../_shared/auth.ts";

const MAX_SHIPPING_DAYS = 7;

Deno.serve(async (req) => {
  // Only allow POST (from cron) or OPTIONS (CORS preflight)
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Verify this is called with service role (from cron or admin)
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "") ?? "";
    if (!verifyServiceRoleJWT(token, supabaseUrl)) {
      // Also accept if called by an authenticated admin/staff user
      if (authHeader?.startsWith("Bearer ")) {
        const { data: { user }, error } = await admin.auth.getUser(token);
        if (error || !user) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }
        // Enforce admin/staff role
        const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
        const hasAccess = (roles ?? []).some((r: { role: string }) => r.role === "admin" || r.role === "staff");
        if (!hasAccess) {
          return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
        }
      } else {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
    }

    const now = new Date();
    const cutoff = new Date(now.getTime() - MAX_SHIPPING_DAYS * 24 * 60 * 60 * 1000);
    const cutoffDate = cutoff.toISOString().slice(0, 10); // shipped_date is a date column
    const nowISO = now.toISOString();

    // Find orders shipped more than MAX_SHIPPING_DAYS ago
    // shipped_date is a 'date' column, compare as date string
    const { data: orders, error: queryErr } = await admin
      .from("sales_order")
      .select("id")
      .eq("v2_status" as never, "shipped")
      .lt("shipped_date" as never, cutoffDate);

    if (queryErr) throw new Error(`Query failed: ${queryErr.message}`);

    const orderIds = (orders ?? []).map((o: { id: string }) => o.id);

    if (orderIds.length === 0) {
      console.log("No orders to auto-progress");
      return new Response(
        JSON.stringify({ success: true, progressedCount: 0 }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // Update orders to delivered
    const { error: orderUpdateErr } = await admin
      .from("sales_order")
      .update({
        v2_status: "delivered",
        delivered_at: nowISO,
      } as never)
      .in("id", orderIds);

    if (orderUpdateErr) {
      console.error("Failed to update orders:", orderUpdateErr);
      throw new Error(`Order update failed: ${orderUpdateErr.message}`);
    }

    // Update associated stock units
    const { error: unitUpdateErr } = await admin
      .from("stock_unit")
      .update({
        v2_status: "delivered",
        delivered_at: nowISO,
      } as never)
      .in("order_id" as never, orderIds)
      .eq("v2_status" as never, "shipped");

    if (unitUpdateErr) {
      console.error("Failed to update stock units:", unitUpdateErr);
    }

    console.log(`Auto-progressed ${orderIds.length} orders to delivered`);

    return new Response(
      JSON.stringify({
        success: true,
        progressedCount: orderIds.length,
        orderIds,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("auto-progress-orders error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
