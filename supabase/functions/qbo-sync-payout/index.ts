// Redeployed: 2026-04-01
// ============================================================
// QBO Sync Payout
// Creates a QBO Deposit (linking SalesReceipts from matched
// orders) and a Purchase/Expense (fees by category) when a
// payout is reconciled.
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
  ensureAccountMapping,
  ensureEbayVendor,
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
    const externalPayoutId = p.external_payout_id as string;
    const payoutDate = (p.payout_date as string)?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

    // Idempotency: skip if already synced
    if (p.qbo_deposit_id) {
      return jsonResponse({
        success: true,
        message: "Already synced",
        qbo_deposit_id: p.qbo_deposit_id,
        qbo_expense_id: p.qbo_expense_id,
      });
    }

    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = qboBaseUrl(realmId);

    // ─── 2. Ensure QBO accounts are mapped ──────────────────
    const accountMap = await ensureAccountMapping(admin, accessToken, realmId);
    const bankAccountId = accountMap["bank_account"];
    if (!bankAccountId) throw new Error("Bank account not mapped in QBO");

    // ─── 3. Fetch transactions for this payout ──────────────
    const { data: txnRows } = await admin
      .from("ebay_payout_transactions" as never)
      .select("*")
      .eq("payout_id", externalPayoutId);

    const transactions = (txnRows ?? []) as Record<string, unknown>[];

    // ─── 4. Reconciliation validation ───────────────────────
    let saleTotal = 0;
    let refundTotal = 0;
    let shippingTotal = 0;
    let creditTotal = 0;
    let transferTotal = 0;

    for (const txn of transactions) {
      const grossAmt = txn.gross_amount as number;
      switch (txn.transaction_type) {
        case "SALE":
          saleTotal += grossAmt;
          break;
        case "REFUND":
          refundTotal += Math.abs(grossAmt);
          break;
        case "SHIPPING_LABEL":
          shippingTotal += Math.abs(grossAmt);
          break;
        case "CREDIT":
          creditTotal += grossAmt;
          break;
        case "TRANSFER":
          transferTotal += Math.abs(grossAmt);
          break;
      }
    }

    // Validate: gross amounts should reconcile (±£0.02 tolerance for rounding)
    const computedGross = Math.round((saleTotal + creditTotal - refundTotal - shippingTotal - transferTotal) * 100) / 100;
    const payoutGross = p.gross_amount as number;
    if (transactions.length > 0 && Math.abs(computedGross - payoutGross) > 0.02) {
      const errorMsg = `Reconciliation mismatch: computed gross £${computedGross} vs payout gross £${payoutGross}`;
      console.error(errorMsg);
      await admin
        .from("payouts" as never)
        .update({
          qbo_sync_status: "error",
          qbo_sync_error: errorMsg,
          sync_attempted_at: new Date().toISOString(),
        } as never)
        .eq("id", payoutId);
      return jsonResponse({ success: false, error: errorMsg }, 400);
    }

    // ─── 5. Build Deposit payload ───────────────────────────
    const depositLines: Record<string, unknown>[] = [];

    // Link matched SALE transactions to their SalesReceipts
    for (const txn of transactions) {
      if (txn.transaction_type === "SALE" && txn.matched && txn.qbo_sales_receipt_id) {
        depositLines.push({
          Amount: txn.gross_amount as number,
          LinkedTxn: [
            {
              TxnId: txn.qbo_sales_receipt_id as string,
              TxnType: "SalesReceipt",
            },
          ],
        });
      }
    }

    // If no linked SalesReceipts available, fall back to single line (legacy behaviour)
    if (depositLines.length === 0) {
      const undepositedId = accountMap["undeposited_funds"];
      depositLines.push({
        Amount: netAmount,
        DetailType: "DepositLineDetail",
        DepositLineDetail: {
          AccountRef: { value: undepositedId ?? bankAccountId },
        },
      });
    }

    const depositPayload = {
      TxnDate: payoutDate,
      DepositToAccountRef: { value: bankAccountId },
      Line: depositLines,
      PrivateNote: `${channel} payout ${externalPayoutId ?? ""} — ${p.order_count ?? 0} orders`,
    };

    // ─── 6. Create QBO Deposit ──────────────────────────────
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
      const errText = await depositRes.text();
      console.error(`QBO Deposit creation failed [${depositRes.status}]:`, errText);
    }

    // ─── 7. Build Purchase (fees) payload ───────────────────
    let qboExpenseId: string | null = null;

    if (totalFees > 0) {
      // Aggregate fees from transactions by QBO account purpose
      const feesByPurpose: Record<string, number> = {};
      for (const txn of transactions) {
        const feeDetails = (txn.fee_details as Array<{ feeType: string; amount: number }>) ?? [];
        for (const fee of feeDetails) {
          const { FEE_ACCOUNT_MAP } = await import("../_shared/ebay-finances.ts");
          const purpose = FEE_ACCOUNT_MAP[fee.feeType] ?? "ebay_other_costs";
          feesByPurpose[purpose] = (feesByPurpose[purpose] ?? 0) + fee.amount;
        }
        // SHIPPING_LABEL amounts
        if ((txn.transaction_type as string) === "SHIPPING_LABEL") {
          const amt = Math.abs(txn.gross_amount as number);
          feesByPurpose["ebay_shipping_labels"] = (feesByPurpose["ebay_shipping_labels"] ?? 0) + amt;
        }
      }

      // Build expense lines with proper QBO account refs
      const expenseLines: Record<string, unknown>[] = [];
      const purposeLabels: Record<string, string> = {
        ebay_selling_fees: "eBay Final Value Fees",
        ebay_advertising: "eBay Promoted Listings fees",
        ebay_international_fees: "eBay International fees",
        ebay_regulatory_fees: "eBay Regulatory fees",
        ebay_shipping_labels: "eBay shipping labels",
        ebay_other_costs: "eBay other fees",
      };

      for (const [purpose, amount] of Object.entries(feesByPurpose)) {
        const rounded = Math.round(amount * 100) / 100;
        if (rounded <= 0) continue;
        const acctId = accountMap[purpose];
        if (!acctId) continue;

        expenseLines.push({
          Amount: rounded,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: acctId },
          },
          Description: purposeLabels[purpose] ?? `${channel} fees`,
        });
      }

      // Catch-all: if fee breakdown doesn't sum to totalFees, add remainder
      const breakdownTotal = expenseLines.reduce((s, l) => s + (l.Amount as number), 0);
      const remainder = Math.round((totalFees - breakdownTotal) * 100) / 100;
      if (remainder > 0.01) {
        const otherAcctId = accountMap["ebay_other_costs"] ?? accountMap["ebay_selling_fees"];
        if (otherAcctId) {
          expenseLines.push({
            Amount: remainder,
            DetailType: "AccountBasedExpenseLineDetail",
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: otherAcctId },
            },
            Description: `${channel} other fees`,
          });
        }
      }

      // Fall back to legacy fee_breakdown if no transaction-level fees
      if (expenseLines.length === 0) {
        const fb = (p.fee_breakdown as Record<string, number>) ?? {};
        const fallbackPairs: [string, string, string][] = [
          ["fvf", "ebay_selling_fees", "Final Value Fee"],
          ["promoted_listings", "ebay_advertising", "Promoted Listings fee"],
          ["international", "ebay_international_fees", "International fee"],
          ["processing", "ebay_other_costs", "Processing fee"],
        ];
        for (const [key, purpose, label] of fallbackPairs) {
          if (fb[key] && fb[key] > 0) {
            const acctId = accountMap[purpose];
            if (acctId) {
              expenseLines.push({
                Amount: fb[key],
                DetailType: "AccountBasedExpenseLineDetail",
                AccountBasedExpenseLineDetail: {
                  AccountRef: { value: acctId },
                },
                Description: `${channel} ${label}`,
              });
            }
          }
        }
      }

      if (expenseLines.length > 0) {
        // Get or create eBay vendor
        let vendorRef: Record<string, unknown> | undefined;
        try {
          const vendorId = await ensureEbayVendor(admin, accessToken, realmId);
          vendorRef = { value: vendorId, type: "Vendor" };
        } catch (e) {
          console.warn("Could not ensure eBay vendor:", e);
        }

        const expensePayload: Record<string, unknown> = {
          TxnDate: payoutDate,
          PaymentType: "Cash",
          AccountRef: { value: bankAccountId },
          Line: expenseLines,
          PrivateNote: `${channel} payout fees${externalPayoutId ? ` — ${externalPayoutId}` : ""}`,
        };
        if (vendorRef) {
          expensePayload.EntityRef = vendorRef;
        }

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

    // ─── 8. Update payout record ────────────────────────────
    const updateData: Record<string, unknown> = {
      qbo_sync_status: qboDepositId ? "synced" : "error",
      qbo_sync_error: qboDepositId ? null : "Deposit creation failed",
      sync_attempted_at: new Date().toISOString(),
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
