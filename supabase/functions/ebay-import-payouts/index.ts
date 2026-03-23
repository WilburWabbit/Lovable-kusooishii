// Redeployed: 2026-03-23
// ============================================================
// eBay Import Payouts
// Fetches payouts from eBay Finances API, extracts fee breakdowns,
// creates payout records, and triggers reconciliation.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EBAY_API = "https://api.ebay.com";

// Fee type mapping from eBay to our standard breakdown
const FEE_TYPE_MAP: Record<string, keyof typeof DEFAULT_FEE_BREAKDOWN> = {
  FINAL_VALUE_FEE: "fvf",
  FINAL_VALUE_FEE_FIXED_PER_ORDER: "fvf",
  AD_FEE: "promoted_listings",
  PROMOTED_LISTING_FEE: "promoted_listings",
  INTERNATIONAL_FEE: "international",
};

const DEFAULT_FEE_BREAKDOWN = { fvf: 0, promoted_listings: 0, international: 0, processing: 0 };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
    const token = authHeader.replace("Bearer ", "");

    // Allow service role or authenticated user
    if (token !== serviceRoleKey) {
      const { data: { user }, error: userError } = await admin.auth.getUser(token);
      if (userError || !user) throw new Error("Unauthorized");
    }

    const body = await req.json().catch(() => ({}));
    const dateFrom = (body as Record<string, unknown>).dateFrom as string | undefined;
    const dateTo = (body as Record<string, unknown>).dateTo as string | undefined;

    // Get eBay access token
    const { data: ebayAuth } = await admin
      .from("ebay_auth_tokens" as never)
      .select("access_token, expires_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!ebayAuth) throw new Error("No eBay auth token found. Connect eBay first.");

    const accessToken = (ebayAuth as Record<string, unknown>).access_token as string;

    // Build date filter
    const now = new Date();
    const fromDate = dateFrom ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const toDate = dateTo ?? now.toISOString();

    // Fetch payouts from eBay Finances API
    const payoutsUrl = `${EBAY_API}/sell/finances/v1/payout?filter=payoutDate:[${fromDate}..${toDate}]&limit=50&sort=payoutDate`;

    const payoutsRes = await fetch(payoutsUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!payoutsRes.ok) {
      const errorText = await payoutsRes.text();
      throw new Error(`eBay Finances API error [${payoutsRes.status}]: ${errorText}`);
    }

    const payoutsData = await payoutsRes.json();
    const ebayPayouts = (payoutsData.payouts ?? []) as Record<string, unknown>[];

    let imported = 0;
    let skipped = 0;

    for (const ep of ebayPayouts) {
      const externalId = ep.payoutId as string;
      if (!externalId) continue;

      // Check for duplicate
      const { data: existing } = await admin
        .from("payouts")
        .select("id")
        .eq("external_payout_id", externalId)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      // Extract amounts (eBay returns amounts as { value, currency })
      const payoutAmount = ep.amount as Record<string, unknown> | null;
      const netAmount = parseFloat((payoutAmount?.value as string) ?? "0");
      const payoutDate = (ep.payoutDate as string)?.slice(0, 10) ?? now.toISOString().slice(0, 10);

      // Fetch transactions for this payout to get fee breakdown
      const feeBreakdown = { ...DEFAULT_FEE_BREAKDOWN };
      let grossAmount = netAmount;
      let totalFees = 0;
      const orderRefs: string[] = [];

      try {
        const txnUrl = `${EBAY_API}/sell/finances/v1/transaction?filter=payoutId:{${externalId}}&limit=100`;
        const txnRes = await fetch(txnUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        });

        if (txnRes.ok) {
          const txnData = await txnRes.json();
          const transactions = (txnData.transactions ?? []) as Record<string, unknown>[];

          for (const txn of transactions) {
            // Collect order references
            const orderId = txn.orderId as string;
            if (orderId && !orderRefs.includes(orderId)) {
              orderRefs.push(orderId);
            }

            // Aggregate fees by type
            const orderLineItems = (txn.orderLineItems ?? []) as Record<string, unknown>[];
            for (const oli of orderLineItems) {
              const fees = (oli.feeBasisAmount ?? oli.fees) as Record<string, unknown>[] | undefined;
              if (!fees) continue;

              for (const fee of (Array.isArray(fees) ? fees : [])) {
                const feeType = fee.feeType as string;
                const feeAmount = parseFloat(((fee.amount as Record<string, unknown>)?.value as string) ?? "0");
                const mappedKey = FEE_TYPE_MAP[feeType] ?? "processing";
                feeBreakdown[mappedKey] += Math.abs(feeAmount);
                totalFees += Math.abs(feeAmount);
              }
            }
          }

          grossAmount = netAmount + totalFees;
        }
      } catch (txnErr) {
        console.warn(`Failed to fetch transactions for payout ${externalId}:`, txnErr);
      }

      // Round fee values
      feeBreakdown.fvf = Math.round(feeBreakdown.fvf * 100) / 100;
      feeBreakdown.promoted_listings = Math.round(feeBreakdown.promoted_listings * 100) / 100;
      feeBreakdown.international = Math.round(feeBreakdown.international * 100) / 100;
      feeBreakdown.processing = Math.round(feeBreakdown.processing * 100) / 100;
      totalFees = Math.round(totalFees * 100) / 100;
      grossAmount = Math.round(grossAmount * 100) / 100;

      // Land raw payload
      await admin
        .from("landing_raw_ebay_payout")
        .upsert({
          external_id: externalId,
          raw_payload: ep,
          status: "pending",
          correlation_id: crypto.randomUUID(),
          received_at: new Date().toISOString(),
        } as never, { onConflict: "external_id" as never });

      // Create payout record
      const { data: payoutRecord, error: insertErr } = await admin
        .from("payouts")
        .insert({
          channel: "ebay",
          payout_date: payoutDate,
          gross_amount: grossAmount,
          total_fees: totalFees,
          net_amount: Math.round(netAmount * 100) / 100,
          fee_breakdown: feeBreakdown,
          order_count: orderRefs.length,
          unit_count: 0,
          qbo_sync_status: "pending",
          external_payout_id: externalId,
        })
        .select()
        .single();

      if (insertErr) {
        console.error(`Failed to insert eBay payout ${externalId}:`, insertErr);
        continue;
      }

      // Link eBay orders to payout
      const localPayoutId = (payoutRecord as Record<string, unknown>)?.id as string;
      if (localPayoutId && orderRefs.length > 0) {
        // Match eBay order IDs to local orders
        const { data: matchedOrders } = await admin
          .from("sales_order")
          .select("id")
          .in("external_order_id", orderRefs);

        if (matchedOrders && (matchedOrders as unknown[]).length > 0) {
          const links = (matchedOrders as { id: string }[]).map((o) => ({
            payout_id: localPayoutId,
            sales_order_id: o.id,
          }));

          await admin
            .from("payout_orders")
            .upsert(links as never, { onConflict: "payout_id,sales_order_id" as never });
        }
      }

      // Trigger reconciliation
      if (localPayoutId) {
        fetch(`${supabaseUrl}/functions/v1/v2-reconcile-payout`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ payoutId: localPayoutId }),
        }).catch(() => {});
      }

      // Update landing status
      await admin
        .from("landing_raw_ebay_payout")
        .update({ status: "committed", processed_at: new Date().toISOString() } as never)
        .eq("external_id", externalId);

      imported++;
    }

    console.log(`eBay payout import: ${imported} imported, ${skipped} skipped (duplicates)`);

    return new Response(
      JSON.stringify({
        success: true,
        imported,
        skipped,
        total: ebayPayouts.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("ebay-import-payouts error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
