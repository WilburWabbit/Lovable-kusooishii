// ============================================================
// eBay Fetch Non-Sale Charges
// Fetches NON_SALE_CHARGE transactions (subscription fees,
// one-time charges) that are billed separately from payouts.
// Creates standalone QBO Expense entries for each.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { getEbayAccessToken } from "../_shared/ebay-auth.ts";
import { EbayFinancesClient, extractFeeDetails } from "../_shared/ebay-finances.ts";
import {
  corsHeaders,
  getQBOConfig,
  qboBaseUrl,
  ensureValidToken,
  fetchWithTimeout,
  ensureAccountMapping,
  ensureEbayVendor,
} from "../_shared/qbo-helpers.ts";

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

    if (token !== serviceRoleKey) {
      const { data: { user }, error: userError } = await admin.auth.getUser(token);
      if (userError || !user) throw new Error("Unauthorized");
    }

    const body = await req.json().catch(() => ({}));
    const dateFrom = (body as Record<string, unknown>).dateFrom as string | undefined;
    const dateTo = (body as Record<string, unknown>).dateTo as string | undefined;

    const accessToken = await getEbayAccessToken(admin);
    const client = new EbayFinancesClient(accessToken);

    // Default to last 30 days
    const now = new Date();
    const startDate = dateFrom ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = dateTo ?? now.toISOString();

    // Fetch NON_SALE_CHARGE transactions
    const response = await client.getTransactions({
      transactionType: "NON_SALE_CHARGE",
      startDate,
      endDate,
      limit: 1000,
    });

    const charges = response.transactions ?? [];
    let imported = 0;
    let skipped = 0;

    for (const txn of charges) {
      // Check for duplicate
      const { data: existing } = await admin
        .from("ebay_payout_transactions" as never)
        .select("id")
        .eq("transaction_id", txn.transactionId)
        .eq("transaction_type", "NON_SALE_CHARGE")
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      // Store transaction
      await admin
        .from("ebay_payout_transactions" as never)
        .upsert({
          payout_id: txn.payoutId ?? "NON_PAYOUT",
          transaction_id: txn.transactionId,
          transaction_type: txn.transactionType,
          transaction_status: txn.transactionStatus,
          transaction_date: txn.transactionDate,
          order_id: txn.orderId ?? null,
          buyer_username: txn.buyer?.username ?? null,
          gross_amount: parseFloat(txn.amount?.value ?? "0"),
          total_fees: 0,
          net_amount: parseFloat(txn.netAmount?.value ?? txn.amount?.value ?? "0"),
          currency: txn.amount?.currency ?? "GBP",
          fee_details: extractFeeDetails(txn),
          memo: txn.transactionMemo ?? null,
          matched: false,
        } as never, { onConflict: "transaction_id,transaction_type" as never });

      imported++;
    }

    // Create QBO expenses for new charges if QBO is configured
    let qboCreated = 0;
    try {
      const { clientId, clientSecret, realmId } = getQBOConfig();
      const qboToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
      const accountMap = await ensureAccountMapping(admin, qboToken, realmId);
      const bankAccountId = accountMap["bank_account"];
      const otherCostsId = accountMap["ebay_other_costs"];
      let vendorId: string | undefined;
      try {
        vendorId = await ensureEbayVendor(admin, qboToken, realmId);
      } catch { /* vendor is optional */ }

      if (bankAccountId && otherCostsId) {
        // Get unprocessed charges (those just imported)
        const { data: newCharges } = await admin
          .from("ebay_payout_transactions" as never)
          .select("*")
          .eq("transaction_type", "NON_SALE_CHARGE")
          .eq("matched", false)
          .is("qbo_sales_receipt_id" as never, null);

        for (const charge of (newCharges ?? []) as Record<string, unknown>[]) {
          const amount = Math.abs(charge.gross_amount as number);
          if (amount <= 0) continue;

          const expensePayload: Record<string, unknown> = {
            TxnDate: (charge.transaction_date as string)?.slice(0, 10),
            PaymentType: "Cash",
            AccountRef: { value: bankAccountId },
            Line: [{
              Amount: amount,
              DetailType: "AccountBasedExpenseLineDetail",
              AccountBasedExpenseLineDetail: {
                AccountRef: { value: otherCostsId },
              },
              Description: `eBay non-sale charge: ${(charge.memo as string) || charge.transaction_id}`,
            }],
            PrivateNote: `eBay charge ${charge.transaction_id}`,
          };
          if (vendorId) {
            expensePayload.EntityRef = { value: vendorId, type: "Vendor" };
          }

          const baseUrl = qboBaseUrl(realmId);
          const res = await fetchWithTimeout(`${baseUrl}/purchase?minorversion=65`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${qboToken}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(expensePayload),
          });

          if (res.ok) {
            const result = await res.json();
            const purchaseId = String(result.Purchase.Id);
            await admin
              .from("ebay_payout_transactions" as never)
              .update({ qbo_sales_receipt_id: purchaseId, matched: true, match_method: "auto_non_sale" } as never)
              .eq("id", charge.id);
            qboCreated++;
          }
        }
      }
    } catch (qboErr) {
      console.warn("QBO expense creation for non-sale charges skipped:", qboErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        imported,
        skipped,
        qboCreated,
        total: charges.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("ebay-fetch-non-sale-charges error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
