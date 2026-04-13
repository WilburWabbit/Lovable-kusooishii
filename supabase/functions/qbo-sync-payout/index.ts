// Redeployed: 2026-04-13
// ============================================================
// QBO Sync Payout
// Creates a QBO Deposit (net amount) and Expense (fees) when
// a payout is recorded from eBay or Stripe.
// Uses qbo_account_mapping for account refs; persists errors.
// ============================================================

import {
  corsHeaders,
  createAdminClient,
  authenticateRequest,
  getQBOConfig,
  qboBaseUrl,
  ensureValidToken,
  fetchWithTimeout,
  jsonResponse,
  errorResponse,
} from "../_shared/qbo-helpers.ts";

// ─── Account mapping helper ──────────────────────────────────

async function getAccountRef(
  admin: ReturnType<typeof createAdminClient>,
  purpose: string,
  fallback: string,
): Promise<string> {
  const { data } = await admin
    .from("qbo_account_mapping" as never)
    .select("qbo_account_id")
    .eq("purpose" as never, purpose)
    .maybeSingle();

  return (data as Record<string, unknown> | null)?.qbo_account_id as string ?? fallback;
}

// ─── Normalize fee breakdown keys ────────────────────────────

function normalizeFeeBreakdown(raw: Record<string, number>): {
  selling_fees: number;
  shipping_fees: number;
  processing_fees: number;
  other_fees: number;
} {
  const result = { selling_fees: 0, shipping_fees: 0, processing_fees: 0, other_fees: 0 };

  for (const [key, val] of Object.entries(raw)) {
    if (!val || val <= 0) continue;
    const k = key.toLowerCase();

    if (k.includes("selling") || k.includes("fvf") || k.includes("final_value")) {
      result.selling_fees += val;
    } else if (k.includes("shipping") || k.includes("postage")) {
      result.shipping_fees += val;
    } else if (k.includes("processing") || k.includes("stripe") || k.includes("payment")) {
      result.processing_fees += val;
    } else if (k.includes("promoted") || k.includes("advertising")) {
      result.selling_fees += val; // promoted listings = selling cost
    } else if (k.includes("international") || k.includes("intl")) {
      result.other_fees += val;
    } else {
      result.other_fees += val;
    }
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);
    const { clientId, clientSecret, realmId } = getQBOConfig();

    const { payoutId } = await req.json();
    if (!payoutId) throw new Error("payoutId is required");

    // ─── 1. Fetch payout ────────────────────────────────────
    const { data: payout, error: payoutErr } = await admin
      .from("payouts" as never)
      .select("*")
      .eq("id", payoutId)
      .single();

    if (payoutErr || !payout) throw new Error(`Payout not found: ${payoutId}`);

    const p = payout as Record<string, unknown>;
    const netAmount = p.net_amount as number;
    const totalFees = p.total_fees as number;
    const channel = p.channel as string;
    const payoutDate = (p.payout_date as string)?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    const feeBreakdown = (p.fee_breakdown as Record<string, number>) ?? {};

    // Skip if already synced (idempotent)
    if ((p.qbo_deposit_id as string)) {
      return jsonResponse({
        success: true,
        qbo_deposit_id: p.qbo_deposit_id,
        qbo_expense_id: p.qbo_expense_id,
        payoutId,
        message: "Already synced",
      });
    }

    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = qboBaseUrl(realmId);

    // ─── 2. Resolve account mappings ────────────────────────
    const bankAccountRef = await getAccountRef(admin, "payout_bank", "1");
    const undepositedFundsRef = await getAccountRef(admin, "undeposited_funds", "1");
    const sellingFeesRef = await getAccountRef(admin, "selling_fees", "2");

    // ─── 3. Create QBO Deposit (net amount) ─────────────────
    const depositPayload = {
      TxnDate: payoutDate,
      DepositToAccountRef: { value: bankAccountRef },
      Line: [
        {
          Amount: netAmount,
          DetailType: "DepositLineDetail",
          DepositLineDetail: {
            AccountRef: { value: undepositedFundsRef },
          },
        },
      ],
      PrivateNote: `${channel} payout — ${p.order_count ?? 0} orders, ${p.unit_count ?? 0} units`,
    };

    const depositRes = await fetchWithTimeout(`${baseUrl}/deposit?minorversion=65`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(depositPayload),
    });

    let qboDepositId: string | null = null;
    let syncError: string | null = null;

    if (depositRes.ok) {
      const depositResult = await depositRes.json();
      qboDepositId = String(depositResult.Deposit.Id);
    } else {
      const errBody = await depositRes.text();
      syncError = `Deposit creation failed [${depositRes.status}]: ${errBody.substring(0, 500)}`;
      console.error(`QBO Deposit creation failed:`, syncError);
    }

    // ─── 4. Create QBO Expense (fees) ───────────────────────
    let qboExpenseId: string | null = null;

    if (totalFees > 0 && qboDepositId) {
      const normalized = normalizeFeeBreakdown(feeBreakdown);
      const expenseLines = [];

      if (normalized.selling_fees > 0) {
        expenseLines.push({
          Amount: normalized.selling_fees,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: sellingFeesRef } },
          Description: `${channel} Selling fees`,
        });
      }
      if (normalized.shipping_fees > 0) {
        expenseLines.push({
          Amount: normalized.shipping_fees,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: sellingFeesRef } },
          Description: `${channel} Shipping fees`,
        });
      }
      if (normalized.processing_fees > 0) {
        expenseLines.push({
          Amount: normalized.processing_fees,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: sellingFeesRef } },
          Description: `${channel} Payment processing fees`,
        });
      }
      if (normalized.other_fees > 0) {
        expenseLines.push({
          Amount: normalized.other_fees,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: sellingFeesRef } },
          Description: `${channel} Other fees`,
        });
      }

      // Catch-all remainder
      const breakdownTotal = normalized.selling_fees + normalized.shipping_fees + normalized.processing_fees + normalized.other_fees;
      const remainder = Math.round((totalFees - breakdownTotal) * 100) / 100;
      if (remainder > 0.01) {
        expenseLines.push({
          Amount: remainder,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: sellingFeesRef } },
          Description: `${channel} Unclassified fees`,
        });
      }

      if (expenseLines.length > 0) {
        const expensePayload = {
          TxnDate: payoutDate,
          PaymentType: "Cash",
          AccountRef: { value: bankAccountRef },
          Line: expenseLines,
          PrivateNote: `${channel} payout fees`,
        };

        const expenseRes = await fetchWithTimeout(`${baseUrl}/purchase?minorversion=65`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(expensePayload),
        });

        if (expenseRes.ok) {
          const expenseResult = await expenseRes.json();
          qboExpenseId = String(expenseResult.Purchase.Id);
        } else {
          const errBody = await expenseRes.text();
          const expenseError = `Expense creation failed [${expenseRes.status}]: ${errBody.substring(0, 500)}`;
          console.error(`QBO Expense creation failed:`, expenseError);
          syncError = syncError ? `${syncError}; ${expenseError}` : expenseError;
        }
      }
    }

    // ─── 5. Update payout record ────────────────────────────
    const updateData: Record<string, unknown> = {
      qbo_sync_status: qboDepositId ? "synced" : "error",
      qbo_sync_error: syncError,
      sync_attempted_at: new Date().toISOString(),
    };
    if (qboDepositId) updateData.qbo_deposit_id = qboDepositId;
    if (qboExpenseId) updateData.qbo_expense_id = qboExpenseId;

    await admin
      .from("payouts" as never)
      .update(updateData as never)
      .eq("id", payoutId);

    // If sync failed, return error so the UI knows
    if (!qboDepositId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: syncError,
          payoutId,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return jsonResponse({
      success: true,
      qbo_deposit_id: qboDepositId,
      qbo_expense_id: qboExpenseId,
      payoutId,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
