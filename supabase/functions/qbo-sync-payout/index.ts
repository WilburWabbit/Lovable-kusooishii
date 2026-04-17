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
import {
  toPence,
  fromPence,
  assertQBOTotalMatches,
  QBOTotalMismatchError,
} from "../_shared/vat.ts";
import {
  buildBalancedQBOLines,
  growRoundingLine,
  assertQBOPayloadBalances,
  QBOPayloadImbalanceError,
  QBO_TAX_CODE_STANDARD_20,
  QBO_TAX_CODE_NO_VAT,
  type QBOStableLine,
} from "../_shared/qbo-tax.ts";

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
  ebay_item_id: string | null;
};

// ─── Constants ───────────────────────────────────────────────

const EBAY_VENDOR_REF = { value: "4", name: "eBay" };
const VAT_RATE = 0.2;
const VAT_DIVISOR = 1 + VAT_RATE;
// Default TaxCodeRef for non-rounding lines. The QBO-stable distributor in
// _shared/qbo-tax.ts attaches QBO_TAX_CODE_NO_VAT ("10") to balancer lines.
const QBO_TAX_CODE_REF = QBO_TAX_CODE_STANDARD_20;

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
  accountName?: string | null,
): Promise<QBOAccount> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };

  // First try direct lookup by ID
  const res = await fetchWithTimeout(`${baseUrl}/account/${encodeURIComponent(accountId)}?minorversion=65`, {
    method: "GET",
    headers,
  });

  if (res.ok) {
    const payload = await res.json();
    const account = (payload?.Account ?? {}) as Record<string, unknown>;
    console.log(`Direct account lookup resolved: input=${accountId}, QBO Id=${account.Id}, Name=${account.Name}, Type=${account.AccountType}`);
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

  // Fallback: query by Id, AcctNum, or Name
  const conditions = [`Id = '${accountId}'`, `AcctNum = '${accountId}'`];
  if (accountName) {
    conditions.push(`Name = '${accountName}'`);
  }
  const queryStr = `SELECT * FROM Account WHERE ${conditions.join(" OR ")}`;
  console.log(`Account fallback query: ${queryStr}`);

  const queryRes = await fetchWithTimeout(
    `${baseUrl}/query?query=${encodeURIComponent(queryStr)}&minorversion=65`,
    { method: "GET", headers },
  );

  if (queryRes.ok) {
    const queryPayload = await queryRes.json();
    const accounts = (queryPayload?.QueryResponse?.Account ?? []) as Record<string, unknown>[];
    if (accounts.length > 0) {
      const account = accounts[0];
      console.log(`Fallback resolved account ${accountId} → QBO Id=${account.Id}, Name=${account.Name}`);
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

  throw new Error(
    `Unable to resolve QBO account: id=${accountId}, name=${accountName ?? "none"}. Check qbo_account_mapping.`,
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

/**
 * Fetch a QBO document's TotalAmt via the /query endpoint.
 * Used to verify cached Purchases and SalesReceipts before linking
 * them as deposit lines — guarantees the deposit math uses the
 * actual landed totals, not locally-computed values.
 */
async function fetchQBODocTotal(
  baseUrl: string,
  accessToken: string,
  docKind: "Purchase" | "SalesReceipt",
  qboId: string,
): Promise<number> {
  const url = `${baseUrl}/${docKind.toLowerCase()}/${encodeURIComponent(qboId)}?minorversion=65`;
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch QBO ${docKind} ${qboId}: HTTP ${res.status}`);
  }
  const json = await res.json();
  const doc = json[docKind] ?? {};
  return Number(doc.TotalAmt ?? 0);
}

// ─── Create a QBO Purchase (Expense) ────────────────────────

interface ExpenseLineInput {
  amount: number;
  accountRef: { value: string; name?: string };
  description: string;
  taxCodeRef?: string;
  customerRef?: { value: string; name?: string };
  itemRef?: { value: string; name?: string };
}

const MAX_PURCHASE_ATTEMPTS = 3;

/**
 * Build the QBO `Line[]` payload from a set of stable lines + the original
 * source ExpenseLineInput[]. Pure function — used by both the initial POST
 * and retry attempts (which call it with a `growRoundingLine`-adjusted
 * stableLines array).
 */
function buildQBOPurchaseLineArray(
  stableLines: QBOStableLine[],
  sourceLines: ExpenseLineInput[],
  bankAccountRef: { value: string; name?: string },
): Record<string, unknown>[] {
  return stableLines.map((s) => {
    const lineNet = fromPence(s.netPence);

    if (s.kind === "rounding") {
      const fallbackAccount = sourceLines[0]?.accountRef ?? bankAccountRef;
      return {
        Amount: lineNet,
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: {
          AccountRef: fallbackAccount,
          TaxCodeRef: { value: QBO_TAX_CODE_NO_VAT },
        },
        Description: "Rounding adjustment (per-line VAT recompute)",
      };
    }

    const sourceLine = sourceLines[s.sourceIndex!];
    const taxCode = sourceLine.taxCodeRef ?? s.taxCodeRef ?? QBO_TAX_CODE_REF;

    if (sourceLine.itemRef) {
      const detail: Record<string, unknown> = {
        ItemRef: sourceLine.itemRef,
        Qty: 1,
        UnitPrice: lineNet,
        TaxCodeRef: { value: taxCode },
      };
      if (sourceLine.customerRef) detail.CustomerRef = sourceLine.customerRef;
      return {
        Amount: lineNet,
        DetailType: "ItemBasedExpenseLineDetail",
        ItemBasedExpenseLineDetail: detail,
        Description: sourceLine.description,
      };
    }

    const detail: Record<string, unknown> = {
      AccountRef: sourceLine.accountRef,
      TaxCodeRef: { value: taxCode },
    };
    if (sourceLine.customerRef) {
      detail.CustomerRef = sourceLine.customerRef;
    }

    return {
      Amount: lineNet,
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: detail,
      Description: sourceLine.description,
    };
  });
}

/**
 * Best-effort delete a QBO Purchase. Used between retry attempts to avoid
 * leaving orphan over/under-totalled Purchases in QBO. Logs but does not
 * throw on failure — the retry loop continues regardless.
 */
async function deleteQBOPurchase(
  baseUrl: string,
  accessToken: string,
  purchaseId: string,
): Promise<void> {
  try {
    // QBO requires fetching the SyncToken before delete.
    const getRes = await fetchWithTimeout(
      `${baseUrl}/purchase/${encodeURIComponent(purchaseId)}?minorversion=65`,
      { method: "GET", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
    );
    if (!getRes.ok) {
      console.warn(`Could not fetch QBO Purchase ${purchaseId} for delete: HTTP ${getRes.status}`);
      return;
    }
    const getJson = await getRes.json();
    const syncToken = getJson?.Purchase?.SyncToken;
    if (syncToken === undefined) {
      console.warn(`QBO Purchase ${purchaseId} missing SyncToken; skipping delete`);
      return;
    }
    const delRes = await fetchWithTimeout(
      `${baseUrl}/purchase?operation=delete&minorversion=65`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ Id: purchaseId, SyncToken: String(syncToken) }),
      },
    );
    if (!delRes.ok) {
      const body = await delRes.text();
      console.warn(`QBO Purchase ${purchaseId} delete failed [${delRes.status}]: ${body.substring(0, 300)}`);
    } else {
      console.log(`Deleted bad QBO Purchase ${purchaseId}`);
    }
  } catch (e) {
    console.warn(`Exception deleting QBO Purchase ${purchaseId}:`, e);
  }
}

type CreateQBOPurchaseResult =
  | { id: string; totalAmt: number; expectedGross: number; attempts: number }
  | { error: string }
  | { skipped: true; reason: string; lastQboTotal: number; expected: number; attempts: number };

async function createQBOPurchase(
  baseUrl: string,
  accessToken: string,
  opts: {
    txnDate: string;
    bankAccountRef: { value: string; name?: string };
    vendorRef: { value: string; name?: string };
    lines: ExpenseLineInput[];
    privateNote: string;
    docNumber?: string;
  },
): Promise<CreateQBOPurchaseResult> {
  // ─── QBO-stable line distribution + reactive retry loop ────
  // QBO recomputes VAT *per-line* on Purchase documents using
  // `round(Amount × rate)` and ignores `TxnTaxDetail.TotalTax`. Our
  // pre-flight distributor predicts that recompute and, when it can't land
  // exactly, appends a zero-tax "rounding adjustment" line.
  //
  // Empirically QBO occasionally returns a TotalAmt that disagrees with
  // even our pre-flight simulation by ±1p. Rather than abort, we react to
  // QBO's actual result: read TotalAmt, compute the drift, delete the bad
  // Purchase, and re-POST with the rounding line grown by exactly that
  // drift. Because the rounding line uses TaxCodeRef "10" (No VAT) it is
  // excluded from QBO's tax recompute and shifts TotalAmt 1:1, so
  // convergence is mathematically guaranteed on attempt 2 (attempt 3 covers
  // any non-determinism).
  //
  // After 3 failed attempts we return { skipped: true } so the caller can
  // record the failure for the single transaction and continue with the
  // rest of the payout instead of aborting everything.
  const grossPenceLines = opts.lines.map((l) => toPence(l.amount));
  const totalGrossPence = grossPenceLines.reduce((s, g) => s + g, 0);
  const expectedGross = fromPence(totalGrossPence);

  let stableLines = buildBalancedQBOLines(grossPenceLines);

  // Pre-flight: confirm the simulated total balances under QBO's recompute.
  try {
    assertQBOPayloadBalances(stableLines, totalGrossPence);
  } catch (e) {
    if (e instanceof QBOPayloadImbalanceError) {
      return { error: e.message };
    }
    throw e;
  }

  let lastQboTotal = 0;
  let lastQboId: string | null = null;

  for (let attempt = 1; attempt <= MAX_PURCHASE_ATTEMPTS; attempt++) {
    const qboLines = buildQBOPurchaseLineArray(stableLines, opts.lines, opts.bankAccountRef);

    const payload: Record<string, unknown> = {
      TxnDate: opts.txnDate,
      PaymentType: "Cash",
      AccountRef: opts.bankAccountRef,
      EntityRef: { ...opts.vendorRef, type: "Vendor" },
      GlobalTaxCalculation: "TaxExcluded",
      Line: qboLines,
      PrivateNote: opts.privateNote,
    };
    if (opts.docNumber) {
      payload.DocNumber = opts.docNumber;
    }

    console.log(`QBO Purchase attempt ${attempt}/${MAX_PURCHASE_ATTEMPTS} (expected £${expectedGross.toFixed(2)}):`, JSON.stringify(payload));

    const res = await fetchWithTimeout(`${baseUrl}/purchase?minorversion=65`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text();
      // POST itself failed (validation, auth, etc.) — not a math drift.
      // Don't retry; surface the error to the caller.
      return { error: `Purchase creation failed [${res.status}] on attempt ${attempt}: ${errBody.substring(0, 500)}` };
    }

    const result = await res.json();
    const purchase = result.Purchase ?? {};
    const qboId = String(purchase.Id);
    const qboTotalAmt = Number(purchase.TotalAmt ?? 0);
    lastQboTotal = qboTotalAmt;
    lastQboId = qboId;

    const driftPence = toPence(expectedGross) - toPence(qboTotalAmt);
    if (driftPence === 0) {
      if (attempt > 1) {
        console.log(`QBO Purchase ${qboId} converged on attempt ${attempt} (expected £${expectedGross.toFixed(2)})`);
      }
      return { id: qboId, totalAmt: qboTotalAmt, expectedGross, attempts: attempt };
    }

    console.warn(
      `QBO Purchase ${qboId} attempt ${attempt}: expected £${expectedGross.toFixed(2)}, ` +
        `QBO returned £${qboTotalAmt.toFixed(2)}, drift=${driftPence}p. ` +
        (attempt < MAX_PURCHASE_ATTEMPTS ? "Deleting and retrying with grown rounding line." : "Max attempts reached."),
    );

    // Delete the bad Purchase so QBO doesn't keep an orphan.
    await deleteQBOPurchase(baseUrl, accessToken, qboId);

    if (attempt < MAX_PURCHASE_ATTEMPTS) {
      // Grow (or add) the rounding line by exactly `driftPence`. QBO's
      // recompute will not touch this line (TaxCodeRef "10" = No VAT),
      // so the next TotalAmt will be old TotalAmt + driftPence = expected.
      stableLines = growRoundingLine(stableLines, driftPence);
    }
  }

  return {
    skipped: true,
    reason: `QBO total drift unresolvable after ${MAX_PURCHASE_ATTEMPTS} attempts (last QBO TotalAmt £${lastQboTotal.toFixed(2)}, expected £${expectedGross.toFixed(2)})`,
    lastQboTotal,
    expected: expectedGross,
    attempts: MAX_PURCHASE_ATTEMPTS,
  };
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
      .select("id, transaction_id, transaction_type, order_id, gross_amount, total_fees, net_amount, fee_details, matched_order_id, qbo_purchase_id, memo, buyer_username, ebay_item_id")
      .eq("payout_id" as never, externalPayoutId);

    if (txErr) throw new Error(`Failed to fetch transactions: ${txErr.message}`);

    const allTransactions = ((txData ?? []) as unknown as EbayTransaction[]);
    // Exclude TRANSFER transactions from expense processing.
    // TRANSFER is informational only: it tells us the matching NON_SALE_CHARGE invoice
    // (same absolute gross_amount) was settled out-of-band by eBay and never debited
    // Undeposited Funds. We use these to flag "settled" NON_SALE_CHARGEs below — those
    // expenses are still booked as Purchases (P&L is real) but paid directly from the
    // bank account rather than UF, and excluded from the deposit lines.
    const transactions = allTransactions.filter((t) => t.transaction_type !== "TRANSFER");

    // Build a multiset of TRANSFER absolute amounts so we can match each settled
    // NON_SALE_CHARGE one-for-one (avoid double-matching when amounts repeat).
    const transferAmountCounts = new Map<string, number>();
    for (const t of allTransactions) {
      if (t.transaction_type === "TRANSFER") {
        const key = Math.abs(t.gross_amount).toFixed(2);
        transferAmountCounts.set(key, (transferAmountCounts.get(key) ?? 0) + 1);
      }
    }
    const settledTxIds = new Set<string>();
    for (const t of allTransactions) {
      if (t.transaction_type !== "NON_SALE_CHARGE") continue;
      const key = Math.abs(t.gross_amount).toFixed(2);
      const remaining = transferAmountCounts.get(key) ?? 0;
      if (remaining > 0) {
        settledTxIds.add(t.id);
        transferAmountCounts.set(key, remaining - 1);
      }
    }
    if (settledTxIds.size > 0) {
      console.log(`Detected ${settledTxIds.size} settled NON_SALE_CHARGE(s) with matching TRANSFER — booking direct to bank, excluding from deposit.`);
    }

    // ─── 3. Pre-flight: Verify SALE transactions are synced ─
    const saleTxs = transactions.filter((t) => t.transaction_type === "SALE");
    const expenseTxs = transactions; // all non-TRANSFER need expenses

    // Build order → QBO SalesReceipt map for deposit lines
    var orderQboMap = new Map<string, { qboId: string; gross: number; orderNumber: string | null; txId: string; transactionId: string }>();
    var orderNumberByTxId = new Map<string, string>();
    var customerRefByTxId = new Map<string, { value: string; name?: string }>();

    if (saleTxs.length > 0) {
      // Step A: Resolve orders by matched_order_id
      const directMatchedIds = saleTxs
        .map((t) => t.matched_order_id)
        .filter(Boolean) as string[];

      const soById = new Map<string, Record<string, unknown>>();
      if (directMatchedIds.length > 0) {
        const { data: salesOrders, error: soErr } = await admin
          .from("sales_order" as never)
          .select("id, origin_reference, order_number, customer_id, qbo_sales_receipt_id, qbo_sync_status")
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
          .select("id, origin_reference, order_number, customer_id, qbo_sales_receipt_id, qbo_sync_status")
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
        const orderNum = (so.order_number as string) ?? null;
        orderQboMap.set(so.id as string, {
          qboId: so.qbo_sales_receipt_id as string,
          gross: tx.gross_amount,
          orderNumber: orderNum,
          txId: tx.id,
          transactionId: tx.transaction_id,
        });
        // Map transaction ID → order number for expense DocNumber
        if (orderNum) {
          orderNumberByTxId.set(tx.id, orderNum);
        }
        // Collect customer_id for QBO customer ref resolution
        const customerId = so.customer_id as string | null;
        if (customerId) {
          // temporarily store customer_id keyed by tx.id — resolved below
          customerRefByTxId.set(tx.id, { value: customerId });
        }
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

    // ─── 3b. Resolve customer IDs to QBO CustomerRef ────────
    // customerRefByTxId currently holds { value: appCustomerId } — resolve to QBO refs
    const appCustomerIds = [...new Set(
      Array.from(customerRefByTxId.values()).map((r) => r.value)
    )];
    if (appCustomerIds.length > 0) {
      const { data: customers } = await admin
        .from("customer" as never)
        .select("id, qbo_customer_id, display_name")
        .in("id" as never, appCustomerIds);

      const qboRefByAppId = new Map<string, { value: string; name?: string }>();
      for (const c of ((customers ?? []) as Record<string, unknown>[])) {
        const qboId = c.qbo_customer_id as string | null;
        if (qboId) {
          qboRefByAppId.set(c.id as string, {
            value: qboId,
            name: (c.display_name as string) ?? undefined,
          });
        }
      }

      // Replace app customer IDs with QBO refs
      for (const [txId, placeholder] of customerRefByTxId.entries()) {
        const resolved = qboRefByAppId.get(placeholder.value);
        if (resolved) {
          customerRefByTxId.set(txId, resolved);
        } else {
          customerRefByTxId.delete(txId); // no QBO customer — skip
        }
      }
    }

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

    const validatedBankAccount = await fetchQBOAccount(baseUrl, accessToken, bankAccount.id, bankAccount.name);
    assertValidDepositBankAccount(validatedBankAccount);
    const payoutBankRef = {
      id: validatedBankAccount.id,
      name: validatedBankAccount.fullyQualifiedName ?? validatedBankAccount.name ?? bankAccount.name,
    };

    console.log(
      `QBO payout sync: ${transactions.length} transactions (${saleTxs.length} sales, ${expenseTxs.length} expenses)`,
    );

    // ─── 4b. Resolve QBO item IDs for insertion fee NON_SALE_CHARGE transactions ─
    // Lookup chain: tx.ebay_item_id → channel_listing.external_listing_id
    //               → channel_listing.sku_id → sku.qbo_item_id
    const insertionFeeItemIds = allTransactions
      .filter((t) => t.transaction_type === "NON_SALE_CHARGE" && t.ebay_item_id &&
        (t.memo ?? "").toLowerCase().includes("insertion fee"))
      .map((t) => t.ebay_item_id as string);

    const qboItemIdByEbayItemId = new Map<string, string>();

    if (insertionFeeItemIds.length > 0) {
      const { data: listings } = await admin
        .from("channel_listing" as never)
        .select("external_listing_id, sku_id")
        .in("external_listing_id" as never, insertionFeeItemIds);

      const listingRows = (listings ?? []) as { external_listing_id: string; sku_id: string | null }[];
      const skuIds = listingRows.map((l) => l.sku_id).filter(Boolean) as string[];

      if (skuIds.length > 0) {
        const { data: skus } = await admin
          .from("sku" as never)
          .select("id, qbo_item_id")
          .in("id" as never, skuIds);

        const qboIdBySkuId = new Map<string, string>();
        for (const s of ((skus ?? []) as { id: string; qbo_item_id: string | null }[])) {
          if (s.qbo_item_id) qboIdBySkuId.set(s.id, s.qbo_item_id);
        }
        for (const l of listingRows) {
          if (l.sku_id) {
            const qboId = qboIdBySkuId.get(l.sku_id);
            if (qboId) qboItemIdByEbayItemId.set(l.external_listing_id, qboId);
          }
        }
      }
      console.log(`Resolved ${qboItemIdByEbayItemId.size} QBO item IDs for ${insertionFeeItemIds.length} insertion fee transactions`);
    }

    // ─── 5. Create per-transaction QBO Purchases (expenses) ─
    let syncError: string | null = null;
    const expenseResults: { txId: string; qboPurchaseId: string; amount: number; qboTotalAmt: number; accountRef: { value: string; name?: string }; transactionType: string; settledViaTransfer: boolean }[] = [];
    // Per-transaction skips (QBO total drift unresolvable after MAX_PURCHASE_ATTEMPTS).
    // These do NOT abort the payout — the deposit is constructed from successfully
    // synced expenses and the payout is marked `partial` so the operator can follow up
    // on just the handful of edge cases.
    const skippedTransactions: { txId: string; transactionId: string; reason: string; lastQboTotal: number; expected: number; attempts: number; kind?: "expense" | "sales_receipt" }[] = [];


    for (const tx of expenseTxs) {
      const txType = tx.transaction_type;

      // Skip if already has a QBO Purchase — but verify its actual QBO TotalAmt
      // so the deposit links to the real landed value, not a locally-computed one.
      if (tx.qbo_purchase_id) {
        if (tx.qbo_purchase_id === "N/A") continue;
        const acctRef = txType === "NON_SALE_CHARGE"
          ? buildAccountRef(subscriptionAccount!)
          : buildAccountRef(sellingFeesAccount);
        let cachedTotal = 0;
        try {
          cachedTotal = await fetchQBODocTotal(baseUrl, accessToken, "Purchase", tx.qbo_purchase_id);
        } catch (e) {
          const msg = `Cannot verify cached QBO Purchase ${tx.qbo_purchase_id} for tx ${tx.transaction_id}: ${e instanceof Error ? e.message : String(e)}`;
          syncError = syncError ? `${syncError}; ${msg}` : msg;
          continue;
        }
        const expectedAmount = txType === "SALE" ? round2(tx.total_fees) : round2(Math.abs(tx.gross_amount));
        // Exact-balance safeguard for cached Purchase: must match source to the penny.
        if (toPence(cachedTotal) !== toPence(expectedAmount)) {
          const msg = `Cached QBO Purchase ${tx.qbo_purchase_id} for tx ${tx.transaction_id} has TotalAmt £${cachedTotal.toFixed(2)} but source expects £${expectedAmount.toFixed(2)}. Delete the QBO Purchase and re-run sync.`;
          syncError = syncError ? `${syncError}; ${msg}` : msg;
          continue;
        }
        expenseResults.push({ txId: tx.id, qboPurchaseId: tx.qbo_purchase_id, amount: expectedAmount, qboTotalAmt: cachedTotal, accountRef: acctRef, transactionType: txType, settledViaTransfer: settledTxIds.has(tx.id) });
        continue;
      }

      // Determine expense lines based on transaction type
      const expenseLines: ExpenseLineInput[] = [];

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
        // Attach customer ref to all SALE expense lines
        const custRef = customerRefByTxId.get(tx.id);
        if (custRef) {
          for (const line of expenseLines) {
            line.customerRef = custRef;
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
        // Insertion fees → selling_fees (COGS), linked to the QBO Item for the listing
        // Subscription fees → subscription_fees (explicit detection via memo)
        // Other charges → subscription_fees account as fallback
        const chargeAmount = Math.abs(tx.gross_amount);
        const memoLower = (tx.memo ?? "").toLowerCase();
        const isInsertionFee = memoLower.includes("insertion fee");
        const isSubscriptionFee = !isInsertionFee &&
          (memoLower.includes("subscription") || memoLower.includes("store subscription"));
        if (chargeAmount > 0) {
          let description: string;
          let accountRef = buildAccountRef(subscriptionAccount!);
          let itemRef: { value: string; name?: string } | undefined;

          if (isInsertionFee) {
            accountRef = buildAccountRef(sellingFeesAccount);
            description = tx.ebay_item_id
              ? `${channel} Insertion Fee — item ${tx.ebay_item_id} — ${tx.transaction_id}`
              : `${channel} Insertion Fee — ${tx.transaction_id}`;
            // Resolve QBO item ID via channel_listing → sku.qbo_item_id
            if (tx.ebay_item_id) {
              const qboId = qboItemIdByEbayItemId.get(tx.ebay_item_id);
              if (qboId) itemRef = { value: qboId };
            }
          } else if (isSubscriptionFee) {
            description = `${channel} Store Subscription — ${tx.transaction_id}`;
          } else {
            description = `${channel} ${tx.memo ?? "Account charge"} — ${tx.transaction_id}`;
          }

          expenseLines.push({ amount: chargeAmount, accountRef, description, itemRef });
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

      // DocNumber: order number for SALE, eBay item ID for insertion fees (makes them
      // queryable in QBO by listing reference)
      let expenseDocNumber: string | undefined;
      if (txType === "SALE") {
        expenseDocNumber = orderNumberByTxId.get(tx.id) ?? undefined;
      } else if (txType === "NON_SALE_CHARGE" && tx.ebay_item_id &&
        (tx.memo ?? "").toLowerCase().includes("insertion fee")) {
        expenseDocNumber = tx.ebay_item_id;
      }

      // Settled NON_SALE_CHARGEs (matched by a TRANSFER) were paid out-of-band by eBay
      // from separate funds — UF was never debited. Book the Purchase directly against
      // the bank account so the P&L hits but UF stays untouched.
      const isSettled = settledTxIds.has(tx.id);
      const purchaseBankRef = isSettled
        ? buildAccountRef(payoutBankRef)
        : buildAccountRef(undepositedFundsAccount);

      const purchaseResult = await createQBOPurchase(baseUrl, accessToken, {
        txnDate: payoutDate,
        bankAccountRef: purchaseBankRef,
        vendorRef: EBAY_VENDOR_REF,
        lines: expenseLines,
        privateNote: txType === "NON_SALE_CHARGE" && tx.ebay_item_id
          ? `${channel} payout ${externalPayoutId} — ${txType} item ${tx.ebay_item_id} — ${tx.transaction_id}`
          : `${channel} payout ${externalPayoutId} — ${txType} ${tx.order_id ?? tx.memo ?? tx.transaction_id}${isSettled ? " (settled via TRANSFER)" : ""}`,
        docNumber: expenseDocNumber,
      });

      if ("error" in purchaseResult) {
        console.error(`QBO Purchase failed for tx ${tx.transaction_id}:`, purchaseResult.error);
        syncError = syncError
          ? `${syncError}; ${purchaseResult.error}`
          : purchaseResult.error;
        // Continue to next transaction — don't block all expenses on one failure
        continue;
      }

      if ("skipped" in purchaseResult) {
        // Auto-adjust loop exhausted. Record the skip and move on.
        // The payout will complete as `partial` (not `error`) so the operator
        // can investigate just this transaction.
        console.warn(
          `Skipping tx ${tx.transaction_id} after ${purchaseResult.attempts} attempts: ${purchaseResult.reason}`,
        );
        skippedTransactions.push({
          txId: tx.id,
          transactionId: tx.transaction_id,
          reason: purchaseResult.reason,
          lastQboTotal: purchaseResult.lastQboTotal,
          expected: purchaseResult.expected,
          attempts: purchaseResult.attempts,
        });
        continue;
      }

      // Update the transaction with the QBO Purchase ID
      await admin
        .from("ebay_payout_transactions" as never)
        .update({ qbo_purchase_id: purchaseResult.id } as never)
        .eq("id" as never, tx.id);

      const totalExpenseAmount = expenseLines.reduce((s, l) => s + l.amount, 0);
      const primaryAccountRef = expenseLines[0].accountRef;
      // purchaseResult.totalAmt was already verified to equal expectedGross by
      // the post-POST drift check inside createQBOPurchase — safe to use directly.
      expenseResults.push({
        txId: tx.id,
        qboPurchaseId: purchaseResult.id,
        amount: round2(totalExpenseAmount),
        qboTotalAmt: purchaseResult.totalAmt,
        accountRef: primaryAccountRef,
        transactionType: txType,
        settledViaTransfer: isSettled,
      });
    }

    // Hard errors (non-drift POST failures, validation errors, etc.) still abort.
    // Drift-skipped transactions are tracked separately and do NOT abort.
    if (syncError) {
      await persistSyncFailure(admin, payoutId, syncError);
      return new Response(
        JSON.stringify({ success: false, error: syncError, payoutId, expensesCreated: expenseResults.length, skipped: skippedTransactions }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ─── 6. Create QBO Deposit ──────────────────────────────
    // CRITICAL: deposit lines must use the *actual* QBO TotalAmt for each
    // linked Purchase and SalesReceipt, not locally-computed values. If the
    // landed QBO total drifts by even 1p from source, the deposit will too.
    // We've already verified Purchases (above). Now verify SalesReceipts.
    let depositLines: unknown[] = [];

    if (typeof orderQboMap !== "undefined" && orderQboMap.size > 0) {
      // Fetch each linked SalesReceipt's actual TotalAmt and verify it matches
      // the source SALE gross_amount exactly. If a SalesReceipt has drifted
      // (typically by ±1p due to QBO's tax recompute on a previous sync), we
      // SKIP that single transaction rather than aborting the whole payout.
      // The skip is recorded so the operator can re-sync the order; the payout
      // completes as `partial`.
      for (const entry of orderQboMap.values()) {
        let qboReceiptTotal = 0;
        try {
          qboReceiptTotal = await fetchQBODocTotal(baseUrl, accessToken, "SalesReceipt", entry.qboId);
        } catch (e) {
          // Network/API failure fetching the receipt — skip this txn rather than abort.
          const reason = `Cannot verify QBO SalesReceipt ${entry.qboId}: ${e instanceof Error ? e.message : String(e)}`;
          console.warn(`Skipping SALE tx ${entry.transactionId}: ${reason}`);
          skippedTransactions.push({
            txId: entry.txId,
            transactionId: entry.transactionId,
            reason,
            lastQboTotal: 0,
            expected: round2(entry.gross),
            attempts: 1,
            kind: "sales_receipt",
          });
          await admin
            .from("ebay_payout_transactions" as never)
            .update({ qbo_sync_error: reason } as never)
            .eq("id" as never, entry.txId);
          continue;
        }
        if (toPence(qboReceiptTotal) !== toPence(round2(entry.gross))) {
          const reason = `QBO SalesReceipt ${entry.qboId} TotalAmt £${qboReceiptTotal.toFixed(2)} does not match source SALE gross £${round2(entry.gross).toFixed(2)}. Delete the SalesReceipt and re-sync the order.`;
          console.warn(`Skipping SALE tx ${entry.transactionId}: ${reason}`);
          skippedTransactions.push({
            txId: entry.txId,
            transactionId: entry.transactionId,
            reason,
            lastQboTotal: qboReceiptTotal,
            expected: round2(entry.gross),
            attempts: 1,
            kind: "sales_receipt",
          });
          await admin
            .from("ebay_payout_transactions" as never)
            .update({ qbo_sync_error: reason } as never)
            .eq("id" as never, entry.txId);
          continue;
        }
        depositLines.push({
          Amount: qboReceiptTotal,
          DepositLineDetail: { PaymentMethodRef: { value: "1" } },
          LinkedTxn: [{ TxnId: entry.qboId, TxnLineId: "0", TxnType: "SalesReceipt" }],
        });
      }
    } else {
      const msg = "Cannot create deposit: no SalesReceipt lines — all payout transactions must be linked to QBO records";
      await persistSyncFailure(admin, payoutId, msg);
      return new Response(
        JSON.stringify({ success: false, error: msg, payoutId, expensesCreated: expenseResults.length }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Expense (Purchase) lines — negative amounts net off the deposit.
    // SALE fees, SHIPPING_LABEL, and unsettled NON_SALE_CHARGE Purchases are booked
    // against Undeposited Funds and must appear here to clear that account.
    //
    // Skipped:
    //  - TRANSFER transactions (filtered out earlier) — informational only.
    //  - NON_SALE_CHARGEs flagged settledViaTransfer — these were paid by eBay
    //    out-of-band (matching TRANSFER) and booked directly to the bank, so they
    //    never debited Undeposited Funds and must not reduce this deposit.
    for (const exp of expenseResults) {
      if (exp.qboPurchaseId === "N/A" || exp.qboTotalAmt <= 0) continue;
      if (exp.settledViaTransfer) continue;

      depositLines.push({
        Amount: -exp.qboTotalAmt,
        DepositLineDetail: {
          PaymentMethodRef: { value: "1" },
        },
        LinkedTxn: [{ TxnId: exp.qboPurchaseId, TxnLineId: "0", TxnType: "Purchase" }],
      });
    }


    // Guard: ensure we have at least one deposit line
    if (depositLines.length === 0) {
      const msg = "Cannot create deposit: no deposit lines built — payout has no matched sales and no deductible expenses";
      await persistSyncFailure(admin, payoutId, msg);
      return new Response(JSON.stringify({ success: false, error: msg, payoutId }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Reconciliation guard: integer-pence exact match ───
    // All deposit-line amounts at this point are verified QBO TotalAmts.
    // Sum them in integer pence and compare to the source payout net.
    //
    // When transactions were skipped (drift unresolvable after retries), the
    // constructed total will legitimately differ from the payout net by the
    // sum of the skipped expense amounts. We tolerate that mismatch and mark
    // the payout `partial` further down — but only when the delta exactly
    // accounts for the skipped expenses (otherwise something else is wrong).
    const constructedPence = (depositLines as Array<{ Amount: number }>)
      .reduce((s, l) => s + toPence(l.Amount), 0);
    const expectedNet = p.net_amount as number;
    const expectedPence = toPence(expectedNet);
    const constructedTotal = fromPence(constructedPence);
    const skippedExpensePence = skippedTransactions.reduce(
      (s, t) => s + toPence(Math.abs(t.expected)),
      0,
    );
    if (constructedPence !== expectedPence) {
      const deltaPence = constructedPence - expectedPence;
      // Skipped expenses would have been negative deposit lines. So a payout
      // net of N with K pence of skipped expenses produces a constructed
      // total of N + K (we didn't subtract them). delta should equal +K.
      const tolerated = skippedTransactions.length > 0 && deltaPence === skippedExpensePence;
      if (!tolerated) {
        const msg = `Deposit total mismatch: constructed=£${constructedTotal.toFixed(2)} (${constructedPence}p), expected payout net=£${expectedNet.toFixed(2)} (${expectedPence}p), delta=${deltaPence}p, skipped=${skippedTransactions.length} (sum ${skippedExpensePence}p). Check NON_SALE_CHARGE/SHIPPING_LABEL amounts and gross_amount signs.`;
        console.error(msg);
        await persistSyncFailure(admin, payoutId, msg);
        return new Response(
          JSON.stringify({ success: false, error: msg, payoutId, skipped: skippedTransactions }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.warn(`Deposit reconciliation tolerated mismatch of ${deltaPence}p — fully accounted for by ${skippedTransactions.length} skipped transaction(s). Payout will be marked partial.`);
    } else {
      console.log(`Deposit reconciliation OK: constructed=£${constructedTotal.toFixed(2)}, expected=£${expectedNet.toFixed(2)}, delta=0p`);
    }

    // ─── 6a. Check for existing QBO deposit with same DocNumber ─
    let qboDepositId: string | null = null;
    let qboDepositTotal: number | null = null;

    if (externalPayoutId) {
      const queryStr = `SELECT * FROM Deposit WHERE DocNumber = '${externalPayoutId}'`;
      console.log(`Checking for existing QBO deposit: ${queryStr}`);
      const existingRes = await fetchWithTimeout(
        `${baseUrl}/query?query=${encodeURIComponent(queryStr)}&minorversion=65`,
        { method: "GET", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
      );
      if (existingRes.ok) {
        const existingPayload = await existingRes.json();
        const deposits = (existingPayload?.QueryResponse?.Deposit ?? []) as Record<string, unknown>[];
        if (deposits.length > 0) {
          qboDepositId = String(deposits[0].Id);
          qboDepositTotal = Number(deposits[0].TotalAmt ?? 0);
          console.log(`Found existing QBO deposit ${qboDepositId} for DocNumber ${externalPayoutId} (TotalAmt £${qboDepositTotal.toFixed(2)}) — skipping creation`);
        }
      } else {
        await existingRes.text(); // consume body
      }
    }

    if (!qboDepositId) {
      const depositPayload: Record<string, unknown> = {
        TxnDate: payoutDate,
        DepositToAccountRef: buildAccountRef(payoutBankRef),
        Line: depositLines,
        PrivateNote: `${channel} payout ${externalPayoutId} — ${saleTxs.length} orders, ${expenseResults.length} expenses`,
      };
      if (externalPayoutId) {
        depositPayload.DocNumber = externalPayoutId;
      }
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

      if (depositRes.ok) {
        const depositResult = await depositRes.json();
        qboDepositId = String(depositResult.Deposit.Id);
        qboDepositTotal = Number(depositResult.Deposit.TotalAmt ?? 0);
      } else {
        const errBody = await depositRes.text();
        syncError = `Deposit creation failed [${depositRes.status}]: ${errBody.substring(0, 500)}`;
        console.error(`QBO Deposit creation failed:`, syncError);
      }
    }

    // ─── Post-create exact-balance safeguard for the Deposit ─
    // QBO's returned TotalAmt must match the EFFECTIVE expected total — i.e.
    // the payout net plus any skipped-expense pence the deposit didn't subtract.
    const effectiveExpectedNet = fromPence(toPence(expectedNet) + skippedExpensePence);
    if (qboDepositId && qboDepositTotal !== null) {
      try {
        assertQBOTotalMatches({
          expectedGross: effectiveExpectedNet,
          qboTotalAmt: qboDepositTotal,
          docKind: "Deposit",
          qboDocId: qboDepositId,
        });
      } catch (e) {
        if (e instanceof QBOTotalMismatchError) {
          syncError = e.message;
          console.error(syncError);
          // Do NOT clear qboDepositId — record exists in QBO and operator
          // needs to delete it manually before retry. Persist as error.
          await persistSyncFailure(admin, payoutId, e.message);
          return new Response(
            JSON.stringify({ success: false, error: e.message, payoutId, qbo_deposit_id: qboDepositId, qbo_deposit_total: qboDepositTotal, skipped: skippedTransactions }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        throw e;
      }
    }


    // ─── 7. Update payout record ────────────────────────────
    // Status:
    //  - synced  → deposit landed and no skipped transactions
    //  - partial → deposit landed but ≥1 transactions skipped (drift unresolvable)
    //  - error   → deposit creation itself failed
    const finalStatus = qboDepositId
      ? (skippedTransactions.length > 0 ? "partial" : "synced")
      : "error";
    const partialMessage = skippedTransactions.length > 0
      ? `Partial sync: ${skippedTransactions.length} transaction(s) skipped after auto-adjust failed: ${skippedTransactions.map((s) => `${s.transactionId} (expected £${s.expected.toFixed(2)}, QBO returned £${s.lastQboTotal.toFixed(2)})`).join("; ")}`
      : null;
    const updateData: Record<string, unknown> = {
      qbo_sync_status: finalStatus,
      qbo_sync_error: syncError ?? partialMessage,
      sync_attempted_at: new Date().toISOString(),
    };
    if (qboDepositId) updateData.qbo_deposit_id = qboDepositId;

    await admin
      .from("payouts" as never)
      .update(updateData as never)
      .eq("id", payoutId);

    if (!qboDepositId) {
      return new Response(
        JSON.stringify({ success: false, error: syncError, payoutId, skipped: skippedTransactions }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return jsonResponse({
      success: true,
      status: finalStatus,
      qbo_deposit_id: qboDepositId,
      expenses_created: expenseResults.length,
      skipped: skippedTransactions,
      partial_message: partialMessage,
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
