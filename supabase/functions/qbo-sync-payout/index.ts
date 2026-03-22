// ============================================================
// QBO Sync Payout
// Creates a QBO Deposit (net amount) and Expense (fees) when
// a payout is recorded from eBay or Stripe.
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

    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = qboBaseUrl(realmId);

    // ─── 2. Create QBO Deposit (net amount) ─────────────────
    const depositPayload = {
      TxnDate: payoutDate,
      DepositToAccountRef: { value: "1" }, // Bank account — configure via env/settings
      Line: [
        {
          Amount: netAmount,
          DetailType: "DepositLineDetail",
          DepositLineDetail: {
            AccountRef: { value: "1" }, // Undeposited funds — configure
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
    if (depositRes.ok) {
      const depositResult = await depositRes.json();
      qboDepositId = String(depositResult.Deposit.Id);
    } else {
      console.error(`QBO Deposit creation failed [${depositRes.status}]:`, await depositRes.text());
    }

    // ─── 3. Create QBO Expense (fees) ───────────────────────
    let qboExpenseId: string | null = null;

    if (totalFees > 0) {
      const expenseLines = [];

      if (feeBreakdown.fvf && feeBreakdown.fvf > 0) {
        expenseLines.push({
          Amount: feeBreakdown.fvf,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: "2" }, // Selling fees account — configure
          },
          Description: `${channel} Final Value Fee`,
        });
      }
      if (feeBreakdown.promoted_listings && feeBreakdown.promoted_listings > 0) {
        expenseLines.push({
          Amount: feeBreakdown.promoted_listings,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: "2" },
          },
          Description: `${channel} Promoted Listings fee`,
        });
      }
      if (feeBreakdown.international && feeBreakdown.international > 0) {
        expenseLines.push({
          Amount: feeBreakdown.international,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: "2" },
          },
          Description: `${channel} International fee`,
        });
      }
      if (feeBreakdown.processing && feeBreakdown.processing > 0) {
        expenseLines.push({
          Amount: feeBreakdown.processing,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: "2" },
          },
          Description: `${channel} Payment processing fee`,
        });
      }

      // Catch-all for any remaining fees not in breakdown
      const breakdownTotal = Object.values(feeBreakdown).reduce((s, v) => s + (v ?? 0), 0);
      const remainder = Math.round((totalFees - breakdownTotal) * 100) / 100;
      if (remainder > 0) {
        expenseLines.push({
          Amount: remainder,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: "2" },
          },
          Description: `${channel} Other fees`,
        });
      }

      if (expenseLines.length > 0) {
        const expensePayload = {
          TxnDate: payoutDate,
          PaymentType: "Cash",
          AccountRef: { value: "1" }, // Bank account
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
          console.error(`QBO Expense creation failed [${expenseRes.status}]:`, await expenseRes.text());
        }
      }
    }

    // ─── 4. Update payout record ────────────────────────────
    const updateData: Record<string, unknown> = {
      qbo_sync_status: qboDepositId ? "synced" : "error",
    };
    if (qboDepositId) updateData.qbo_deposit_id = qboDepositId;
    if (qboExpenseId) updateData.qbo_expense_id = qboExpenseId;

    await admin
      .from("payouts" as never)
      .update(updateData as never)
      .eq("id", payoutId);

    return jsonResponse({
      success: !!qboDepositId,
      qbo_deposit_id: qboDepositId,
      qbo_expense_id: qboExpenseId,
      payoutId,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
