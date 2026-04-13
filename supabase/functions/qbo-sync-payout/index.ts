// Redeployed: 2026-04-13
// ============================================================
// QBO Sync Payout
// Creates per-transaction QBO Purchases (expenses) and a QBO
// Deposit when a payout is recorded from eBay.
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

// ─── Types ───────────────────────────────────────────────────

type AccountMapping = {
  purpose: string;
  id: string;
  name: string | null;
  accountType: string | null;
};

type QBOAccount = {
  id: string;
  name: string | null;
  fullyQualifiedName: string | null;
  accountType: string | null;
  accountSubType: string | null;
  active: boolean | null;
};

type EbayTransaction = {
  id: string;
  transaction_id: string;
  transaction_type: string;
  order_id: string | null;
  gross_amount: number;
  total_fees: number;
  net_amount: number;
  fee_details: Array<{ feeType?: string; amount?: number | { value?: string }; currency?: string }>;
  matched_order_id: string | null;
  qbo_purchase_id: string | null;
  memo: string | null;
  buyer_username: string | null;
};

// ─── Constants ───────────────────────────────────────────────

const EBAY_VENDOR_REF = { value: "4", name: "eBay" };
const VAT_RATE = 0.2;
const VAT_DIVISOR = 1 + VAT_RATE;
const QBO_TAX_CODE_REF = "6"; // 20% S

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Account mapping helper ──────────────────────────────────

async function getAccountMapping(
  admin: ReturnType<typeof createAdminClient>,
  purpose: string,
): Promise<AccountMapping | null> {
  const { data } = await admin
    .from("qbo_account_mapping" as never)
    .select("qbo_account_id, qbo_account_name, account_type")
    .eq("purpose" as never, purpose)
    .maybeSingle();

  const row = data as Record<string, unknown> | null;
  const accountId = row?.qbo_account_id;

  if (typeof accountId !== "string" || accountId.length === 0) {
    return null;
  }

  return {
    purpose,
    id: accountId,
    name: typeof row?.qbo_account_name === "string" ? row.qbo_account_name : null,
    accountType: typeof row?.account_type === "string" ? row.account_type : null,
  };
}

function buildAccountRef(account: { id: string; name: string | null }) {
  return account.name
    ? { value: String(account.id), name: account.name }
    : { value: String(account.id) };
}

async function fetchQBOAccount(
  baseUrl: string,
  accessToken: string,
  accountId: string,
): Promise<QBOAccount> {
  // First try direct lookup by ID
  const res = await fetchWithTimeout(`${baseUrl}/account/${encodeURIComponent(accountId)}?minorversion=65`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (res.ok) {
    const payload = await res.json();
    const account = (payload?.Account ?? {}) as Record<string, unknown>;
    return {
      id: String(account.Id ?? accountId),
      name: typeof account.Name === "string" ? account.Name : null,
      fullyQualifiedName:
        typeof account.FullyQualifiedName === "string" ? account.FullyQualifiedName : null,
      accountType: typeof account.AccountType === "string" ? account.AccountType : null,
      accountSubType: typeof account.AccountSubType === "string" ? account.AccountSubType : null,
      active: typeof account.Active === "boolean" ? account.Active : null,
    };
  }

  // If direct lookup fails, try query by name or AcctNum
  const queryRes = await fetchWithTimeout(
    `${baseUrl}/query?query=${encodeURIComponent(`SELECT * FROM Account WHERE Id = '${accountId}' OR AcctNum = '${accountId}'`)}&minorversion=65`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );

  if (queryRes.ok) {
    const queryPayload = await queryRes.json();
    const accounts = (queryPayload?.QueryResponse?.Account ?? []) as Record<string, unknown>[];
    if (accounts.length > 0) {
      const account = accounts[0];
      console.log(`Resolved account ${accountId} → QBO Id ${account.Id}`);
      return {
        id: String(account.Id),
        name: typeof account.Name === "string" ? account.Name : null,
        fullyQualifiedName:
          typeof account.FullyQualifiedName === "string" ? account.FullyQualifiedName : null,
        accountType: typeof account.AccountType === "string" ? account.AccountType : null,
        accountSubType: typeof account.AccountSubType === "string" ? account.AccountSubType : null,
        active: typeof account.Active === "boolean" ? account.Active : null,
      };
    }
  }

  const errBody = await res.text();
  throw new Error(
    `Unable to validate QBO account ${accountId} [${res.status}]: ${errBody.substring(0, 500)}`,
  );
}

function assertValidDepositBankAccount(account: QBOAccount): void {
  const label = account.fullyQualifiedName ?? account.name ?? account.id;

  if (account.active === false) {
    throw new Error(
      `QBO payout_bank mapping points to inactive account "${label}" (${account.id}). Select an active bank account for deposits.`,
    );
  }

  if (account.accountType !== "Bank") {
    throw new Error(
      `QBO payout_bank mapping points to "${label}" (${account.id}), which is ${account.accountType ?? "not a bank account"}. Deposits require a bank account.`,
    );
  }

  if (account.accountSubType === "CashOnHand") {
    throw new Error(
      `QBO payout_bank mapping points to "${label}" (${account.id}), which is a Cash on hand account. QuickBooks deposits require a real bank/current account.`,
    );
  }
}

async function persistSyncFailure(
  admin: ReturnType<typeof createAdminClient>,
  payoutId: string,
  message: string,
): Promise<void> {
  await admin
    .from("payouts" as never)
    .update({
      qbo_sync_status: "error",
      qbo_sync_error: message,
      sync_attempted_at: new Date().toISOString(),
    } as never)
    .eq("id", payoutId);
}

// ─── Create a QBO Purchase (Expense) ────────────────────────

interface ExpenseLineInput {
  amount: number;
  accountRef: { value: string; name?: string };
  description: string;
  taxCodeRef?: string;
}

async function createQBOPurchase(
  baseUrl: string,
  accessToken: string,
  opts: {
    txnDate: string;
    bankAccountRef: { value: string; name?: string };
    vendorRef: { value: string; name?: string };
    lines: ExpenseLineInput[];
    privateNote: string;
  },
): Promise<{ id: string } | { error: string }> {
  const qboLines = opts.lines.map((line) => {
    const exVat = round2(line.amount / VAT_DIVISOR);
    const vat = round2(line.amount - exVat);

    return {
      Amount: exVat,
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: {
        AccountRef: line.accountRef,
        TaxCodeRef: { value: line.taxCodeRef ?? QBO_TAX_CODE_REF },
        TaxAmount: vat,
      },
      Description: line.description,
    };
  });

  const payload = {
    TxnDate: opts.txnDate,
    PaymentType: "Cash",
    AccountRef: opts.bankAccountRef,
    EntityRef: { ...opts.vendorRef, type: "Vendor" },
    GlobalTaxCalculation: "TaxExcluded",
    Line: qboLines,
    PrivateNote: opts.privateNote,
  };

  console.log("QBO Purchase payload:", JSON.stringify(payload));

  const res = await fetchWithTimeout(`${baseUrl}/purchase?minorversion=65`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    const result = await res.json();
    return { id: String(result.Purchase.Id) };
  }

  const errBody = await res.text();
  return { error: `Purchase creation failed [${res.status}]: ${errBody.substring(0, 500)}` };
}

// ─── Main handler ────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let admin: ReturnType<typeof createAdminClient> | null = null;
  let payoutId: string | null = null;

  try {
    admin = createAdminClient();
    await authenticateRequest(req, admin);
    const { clientId, clientSecret, realmId } = getQBOConfig();

    ({ payoutId } = await req.json());
    if (!payoutId) throw new Error("payoutId is required");

    // ─── 1. Fetch payout ────────────────────────────────────
    const { data: payout, error: payoutErr } = await admin
      .from("payouts" as never)
      .select("*")
      .eq("id", payoutId)
      .single();

    if (payoutErr || !payout) throw new Error(`Payout not found: ${payoutId}`);

    const p = payout as Record<string, unknown>;
    const channel = p.channel as string;
    const payoutDate = (p.payout_date as string)?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    const externalPayoutId = p.external_payout_id as string | null;

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

    // ─── 2. Fetch all non-TRANSFER transactions ─────────────
    if (!externalPayoutId) {
      throw new Error("Payout has no external_payout_id — cannot look up transactions");
    }

    const { data: txData, error: txErr } = await admin
      .from("ebay_payout_transactions" as never)
      .select("id, transaction_id, transaction_type, order_id, gross_amount, total_fees, net_amount, fee_details, matched_order_id, qbo_purchase_id, memo, buyer_username")
      .eq("payout_id" as never, externalPayoutId)
      .neq("transaction_type" as never, "TRANSFER");

    if (txErr) throw new Error(`Failed to fetch transactions: ${txErr.message}`);

    const transactions = ((txData ?? []) as unknown as EbayTransaction[]);

    // ─── 3. Pre-flight: Verify SALE transactions are synced ─
    const saleTxs = transactions.filter((t) => t.transaction_type === "SALE");
    const expenseTxs = transactions; // all non-TRANSFER need expenses

    // Build order → QBO SalesReceipt map for deposit lines
    var orderQboMap = new Map<string, { qboId: string; gross: number }>();

    if (saleTxs.length > 0) {
      // Step A: Resolve orders by matched_order_id
      const directMatchedIds = saleTxs
        .map((t) => t.matched_order_id)
        .filter(Boolean) as string[];

      const soById = new Map<string, Record<string, unknown>>();
      if (directMatchedIds.length > 0) {
        const { data: salesOrders, error: soErr } = await admin
          .from("sales_order" as never)
          .select("id, origin_reference, qbo_sales_receipt_id, qbo_sync_status")
          .in("id" as never, directMatchedIds);

        if (soErr) throw new Error(`Failed to fetch sales orders: ${soErr.message}`);
        for (const so of ((salesOrders ?? []) as Record<string, unknown>[])) {
          soById.set(so.id as string, so);
        }
      }

      // Step B: Fallback — resolve unmatched SALE txns by order_id → origin_reference
      const unmatchedWithOrderId = saleTxs.filter((t) => !t.matched_order_id && t.order_id);
      const orderRefs = unmatchedWithOrderId.map((t) => t.order_id!);

      const soByRef = new Map<string, Record<string, unknown>>();
      if (orderRefs.length > 0) {
        const { data: refOrders } = await admin
          .from("sales_order" as never)
          .select("id, origin_reference, qbo_sales_receipt_id, qbo_sync_status")
          .in("origin_reference" as never, orderRefs);

        for (const so of ((refOrders ?? []) as Record<string, unknown>[])) {
          soByRef.set(so.origin_reference as string, so);
        }
      }

      // Step C: Check all SALE transactions have a synced SalesReceipt
      const unsyncedRefs: string[] = [];
      const unmatchedRefs: string[] = [];

      for (const tx of saleTxs) {
        let so: Record<string, unknown> | undefined;
        if (tx.matched_order_id) {
          so = soById.get(tx.matched_order_id);
        } else if (tx.order_id) {
          so = soByRef.get(tx.order_id);
        }

        if (!so) {
          unmatchedRefs.push(tx.order_id ?? tx.transaction_id);
          continue;
        }

        if (!so.qbo_sales_receipt_id || so.qbo_sales_receipt_id === "") {
          unsyncedRefs.push((so.origin_reference as string) ?? (so.id as string));
          continue;
        }

        // Good — add to deposit map
        orderQboMap.set(so.id as string, {
          qboId: so.qbo_sales_receipt_id as string,
          gross: tx.gross_amount,
        });
      }

      if (unmatchedRefs.length > 0) {
        const message = `Cannot create deposit: ${unmatchedRefs.length} SALE transaction(s) not matched to app orders: ${unmatchedRefs.join(", ")}`;
        await persistSyncFailure(admin, payoutId, message);
        return new Response(
          JSON.stringify({ success: false, error: message, payoutId }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (unsyncedRefs.length > 0) {
        const message = `Cannot create deposit: ${unsyncedRefs.length} linked order(s) not yet synced to QBO: ${unsyncedRefs.join(", ")}`;
        await persistSyncFailure(admin, payoutId, message);
        return new Response(
          JSON.stringify({ success: false, error: message, payoutId, unsyncedOrders: unsyncedRefs }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ─── 4. Get QBO token + account mappings ────────────────
    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = qboBaseUrl(realmId);

    const bankAccount = await getAccountMapping(admin, "payout_bank");
    const undepositedFundsAccount = await getAccountMapping(admin, "undeposited_funds");
    const sellingFeesAccount = await getAccountMapping(admin, "selling_fees");
    const subscriptionFeesAccount = await getAccountMapping(admin, "subscription_fees");

    // subscription_fees falls back to selling_fees
    const subscriptionAccount = subscriptionFeesAccount ?? sellingFeesAccount;

    if (!bankAccount || !undepositedFundsAccount || !sellingFeesAccount) {
      const missing = [
        !bankAccount && "payout_bank",
        !undepositedFundsAccount && "undeposited_funds",
        !sellingFeesAccount && "selling_fees",
      ].filter(Boolean).join(", ");
      throw new Error(`QBO account mapping not configured for: ${missing}. Add rows to qbo_account_mapping.`);
    }

    const validatedBankAccount = await fetchQBOAccount(baseUrl, accessToken, bankAccount.id);
    assertValidDepositBankAccount(validatedBankAccount);
    const payoutBankRef = {
      id: validatedBankAccount.id,
      name: validatedBankAccount.fullyQualifiedName ?? validatedBankAccount.name ?? bankAccount.name,
    };

    console.log(
      `QBO payout sync: ${transactions.length} transactions (${saleTxs.length} sales, ${expenseTxs.length} expenses)`,
    );

    // ─── 5. Create per-transaction QBO Purchases (expenses) ─
    let syncError: string | null = null;
    const expenseResults: { txId: string; qboPurchaseId: string; amount: number; accountRef: { value: string; name?: string } }[] = [];

    for (const tx of expenseTxs) {
      // Skip if already has a QBO Purchase
      if (tx.qbo_purchase_id) {
        // Sum up the expense lines to get the total amount for deposit
        const totalAmount = txType === "SALE" ? tx.total_fees : Math.abs(tx.gross_amount);
        const acctRef = txType === "NON_SALE_CHARGE"
          ? buildAccountRef(subscriptionAccount!)
          : buildAccountRef(sellingFeesAccount);
        expenseResults.push({ txId: tx.id, qboPurchaseId: tx.qbo_purchase_id, amount: totalAmount, accountRef: acctRef });
        continue;
      }

      // Determine expense lines based on transaction type
      const expenseLines: ExpenseLineInput[] = [];
      const txType = tx.transaction_type;

      if (txType === "SALE") {
        // SALE: create expense for the fees on this sale
        if (tx.total_fees > 0) {
          // Use itemized fee_details if available
          const feeDetails = tx.fee_details ?? [];
          if (feeDetails.length > 0) {
            for (const fee of feeDetails) {
              const amt = typeof fee.amount === "number"
                ? fee.amount
                : parseFloat((fee.amount as { value?: string })?.value ?? "0");
              if (amt > 0) {
                expenseLines.push({
                  amount: amt,
                  accountRef: buildAccountRef(sellingFeesAccount),
                  description: `${channel} ${(fee.feeType ?? "Fee").replace(/_/g, " ")} — order ${tx.order_id ?? tx.transaction_id}`,
                });
              }
            }
          }
          // If no fee details or they don't sum up, add remainder as lump
          const feeDetailSum = expenseLines.reduce((s, l) => s + l.amount, 0);
          const remainder = round2(tx.total_fees - feeDetailSum);
          if (remainder > 0.01) {
            expenseLines.push({
              amount: remainder,
              accountRef: buildAccountRef(sellingFeesAccount),
              description: `${channel} fees — order ${tx.order_id ?? tx.transaction_id}`,
            });
          }
        }
      } else if (txType === "SHIPPING_LABEL") {
        // Shipping label: the gross amount is the shipping cost
        const shippingAmount = Math.abs(tx.gross_amount);
        if (shippingAmount > 0) {
          expenseLines.push({
            amount: shippingAmount,
            accountRef: buildAccountRef(sellingFeesAccount),
            description: `${channel} Shipping label — order ${tx.order_id ?? tx.transaction_id}`,
          });
        }
      } else if (txType === "NON_SALE_CHARGE") {
        // Non-sale charge: subscription/account-level expense
        const chargeAmount = Math.abs(tx.gross_amount);
        if (chargeAmount > 0) {
          expenseLines.push({
            amount: chargeAmount,
            accountRef: buildAccountRef(subscriptionAccount!),
            description: `${channel} ${tx.memo ?? "Account charge"} — ${tx.transaction_id}`,
          });
        }
      } else {
        // REFUND, CREDIT, DISPUTE, etc. — create as expense with selling_fees
        const amount = Math.abs(tx.gross_amount);
        if (amount > 0) {
          expenseLines.push({
            amount,
            accountRef: buildAccountRef(sellingFeesAccount),
            description: `${channel} ${txType.replace(/_/g, " ")} — ${tx.transaction_id}`,
          });
        }
      }

      // Skip if no expense lines (e.g., zero-fee SALE)
      if (expenseLines.length === 0) {
        // Mark as "no expense needed" by setting a placeholder
        await admin
          .from("ebay_payout_transactions" as never)
          .update({ qbo_purchase_id: "N/A" } as never)
          .eq("id" as never, tx.id);
        continue;
      }

      const purchaseResult = await createQBOPurchase(baseUrl, accessToken, {
        txnDate: payoutDate,
        bankAccountRef: buildAccountRef(undepositedFundsAccount),
        vendorRef: EBAY_VENDOR_REF,
        lines: expenseLines,
        privateNote: `${channel} payout ${externalPayoutId} — ${txType} ${tx.order_id ?? tx.memo ?? tx.transaction_id}`,
      });

      if ("error" in purchaseResult) {
        console.error(`QBO Purchase failed for tx ${tx.transaction_id}:`, purchaseResult.error);
        syncError = syncError
          ? `${syncError}; ${purchaseResult.error}`
          : purchaseResult.error;
        // Continue to next transaction — don't block all expenses on one failure
        continue;
      }

      // Update the transaction with the QBO Purchase ID
      await admin
        .from("ebay_payout_transactions" as never)
        .update({ qbo_purchase_id: purchaseResult.id } as never)
        .eq("id" as never, tx.id);

      const totalExpenseAmount = expenseLines.reduce((s, l) => s + l.amount, 0);
      const primaryAccountRef = expenseLines[0].accountRef;
      expenseResults.push({ txId: tx.id, qboPurchaseId: purchaseResult.id, amount: totalExpenseAmount, accountRef: primaryAccountRef });
    }

    // If any expense creation failed, persist error and return
    if (syncError) {
      await persistSyncFailure(admin, payoutId, syncError);
      return new Response(
        JSON.stringify({ success: false, error: syncError, payoutId, expensesCreated: expenseResults.length }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ─── 6. Create QBO Deposit ──────────────────────────────
    let depositLines: unknown[];
    if (typeof orderQboMap !== "undefined" && orderQboMap.size > 0) {
      depositLines = Array.from(orderQboMap.values()).map((entry) => ({
        Amount: entry.gross,
        DetailType: "DepositLineDetail",
        DepositLineDetail: {
          AccountRef: buildAccountRef(undepositedFundsAccount),
        },
        LinkedTxn: [
          {
            TxnId: entry.qboId,
            TxnType: "SalesReceipt",
          },
        ],
      }));
    } else {
      // Fallback: single lump-sum line if no sales
      const netAmount = p.net_amount as number;
      depositLines = [
        {
          Amount: netAmount,
          DetailType: "DepositLineDetail",
          DepositLineDetail: {
            AccountRef: buildAccountRef(undepositedFundsAccount),
          },
        },
      ];
    }

    const depositPayload = {
      TxnDate: payoutDate,
      DepositToAccountRef: buildAccountRef(payoutBankRef),
      Line: depositLines,
      PrivateNote: `${channel} payout ${externalPayoutId} — ${saleTxs.length} orders, ${expenseResults.length} expenses`,
    };
    console.log("QBO deposit payload:", JSON.stringify(depositPayload));

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
      const errBody = await depositRes.text();
      syncError = `Deposit creation failed [${depositRes.status}]: ${errBody.substring(0, 500)}`;
      console.error(`QBO Deposit creation failed:`, syncError);
    }

    // ─── 7. Update payout record ────────────────────────────
    const updateData: Record<string, unknown> = {
      qbo_sync_status: qboDepositId ? "synced" : "error",
      qbo_sync_error: syncError,
      sync_attempted_at: new Date().toISOString(),
    };
    if (qboDepositId) updateData.qbo_deposit_id = qboDepositId;

    await admin
      .from("payouts" as never)
      .update(updateData as never)
      .eq("id", payoutId);

    if (!qboDepositId) {
      return new Response(
        JSON.stringify({ success: false, error: syncError, payoutId }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return jsonResponse({
      success: true,
      qbo_deposit_id: qboDepositId,
      expenses_created: expenseResults.length,
      payoutId,
    });
  } catch (err) {
    if (admin && payoutId) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await persistSyncFailure(admin, payoutId, message);
    }
    return errorResponse(err);
  }
});
