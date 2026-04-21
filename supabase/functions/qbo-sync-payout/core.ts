// ============================================================
// QBO Sync Payout — channel-agnostic core
// ============================================================
// This module is driven by a `PayoutAdapter` (eBay, Stripe, …).
// The adapter loads channel-native transactions and converts them
// into `NeutralPayoutTx` rows; the core then runs the same QBO
// purchase + deposit pipeline regardless of channel.
//
// To preserve eBay behaviour byte-for-byte, the adapter must report:
//   - the same set of transactions (excluding settlement-only rows
//     classified by classifyTransactions),
//   - the same fee descriptions, DocNumbers, PrivateNotes, and
//     ItemRefs as the original eBay-only code did.
// ============================================================

import {
  corsHeaders,
  createAdminClient,
  getQBOConfig,
  qboBaseUrl,
  ensureValidToken,
  fetchWithTimeout,
  jsonResponse,
} from "../_shared/qbo-helpers.ts";
import {
  toPence,
  fromPence,
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
import type { PayoutAdapter, NeutralPayoutTx, AdapterDeps } from "../_shared/payout-adapter.ts";

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

// ─── Constants ───────────────────────────────────────────────

// EBAY_VENDOR_REF moved into ebayAdapter.qboVendorRef.
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
  docKind: "Purchase" | "SalesReceipt" | "Deposit",
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

/**
 * Best-effort delete a QBO SalesReceipt. Used during canonical-drift
 * auto-rebuild: when the cached SalesReceipt's TotalAmt doesn't equal the
 * channel-recorded sale gross, we delete it and let qbo-sync-sales-receipt
 * recreate it from the canonical sales_order.
 */
async function deleteQBOSalesReceipt(
  baseUrl: string,
  accessToken: string,
  receiptId: string,
): Promise<void> {
  try {
    const getRes = await fetchWithTimeout(
      `${baseUrl}/salesreceipt/${encodeURIComponent(receiptId)}?minorversion=65`,
      { method: "GET", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
    );
    if (!getRes.ok) {
      console.warn(`Could not fetch QBO SalesReceipt ${receiptId} for delete: HTTP ${getRes.status}`);
      return;
    }
    const getJson = await getRes.json();
    const syncToken = getJson?.SalesReceipt?.SyncToken;
    if (syncToken === undefined) {
      console.warn(`QBO SalesReceipt ${receiptId} missing SyncToken; skipping delete`);
      return;
    }
    const delRes = await fetchWithTimeout(
      `${baseUrl}/salesreceipt?operation=delete&minorversion=65`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ Id: receiptId, SyncToken: String(syncToken) }),
      },
    );
    if (!delRes.ok) {
      const body = await delRes.text();
      console.warn(`QBO SalesReceipt ${receiptId} delete failed [${delRes.status}]: ${body.substring(0, 300)}`);
    } else {
      console.log(`Deleted stale QBO SalesReceipt ${receiptId}`);
    }
  } catch (e) {
    console.warn(`Exception deleting QBO SalesReceipt ${receiptId}:`, e);
  }
}

/**
 * Repair a sales_order whose totals have drifted from the channel-recorded
 * gross. `sales_order_line.unit_price` and `line_total` are stored EX-VAT (NET)
 * by every ingestion path. The canonical invariant is:
 *
 *   sum(net line totals)  = round(channelGrossPence / 1.2)   (banker's)
 *   sales_order.gross_total = channelGross (exact, to the penny)
 *
 * Previous attempts used integer NET pence as the repair target. That loses
 * the sub-penny precision present in canonical ex-VAT order lines like
 * £13.325 (which legitimately maps to a £15.99 customer-facing gross). Once
 * such a line is rewritten to £13.33, qbo-sync-sales-receipt derives £16.00
 * on rebuild and we permanently regress historical sales.
 *
 * So the repair target here is the per-line GROSS pence distribution, and we
 * write back 4dp NET line totals chosen to reproduce those exact gross pence
 * when qbo-sync-sales-receipt later runs `Math.round(netLineTotal * 1.2 * 100)`.
 *
 * Writes a price_audit_log entry per affected SKU.
 */
async function repairSalesOrderToCanonicalGross(
  admin: ReturnType<typeof createAdminClient>,
  salesOrderId: string,
  orderNumber: string | null,
  channelGross: number,
): Promise<{ repaired: boolean; reason: string }> {
  const channelGrossPence = toPence(channelGross);

  const { data: lines, error: linesErr } = await admin
    .from("sales_order_line" as never)
    .select("id, sku_id, quantity, unit_price, line_total")
    .eq("sales_order_id" as never, salesOrderId);

  if (linesErr) {
    return { repaired: false, reason: `Failed to load order lines: ${linesErr.message}` };
  }
  type Line = { id: string; sku_id: string | null; quantity: number; unit_price: number; line_total: number };
  const orderLines = ((lines ?? []) as Line[]);
  if (orderLines.length === 0) {
    return { repaired: false, reason: "Order has no lines" };
  }

  const currentNetTotals = orderLines.map((l) =>
    typeof l.line_total === "number" && l.line_total !== 0
      ? l.line_total
      : (l.unit_price ?? 0) * (l.quantity ?? 1)
  );
  const currentNetWeightPenceByLine = currentNetTotals.map((net) => toPence(net));
  const currentGrossProxyPenceByLine = currentNetTotals.map((net) => Math.round(net * VAT_DIVISOR * 100));
  const currentTotalNetWeightPence = currentNetWeightPenceByLine.reduce((s, p) => s + p, 0);

  const { data: orderRow, error: orderErr } = await admin
    .from("sales_order" as never)
    .select("gross_total")
    .eq("id" as never, salesOrderId)
    .single();
  if (orderErr) {
    return { repaired: false, reason: `Failed to load order header: ${orderErr.message}` };
  }
  const currentOrderGross = Number((orderRow as { gross_total?: number } | null)?.gross_total ?? 0);

  const indexed = currentNetWeightPenceByLine.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => a.p - b.p);

  // Build proportional GROSS pence shares that sum exactly to channelGrossPence.
  const sortedShares: number[] = new Array(indexed.length);
  if (currentTotalNetWeightPence === 0) {
    for (let k = 0; k < sortedShares.length; k++) sortedShares[k] = 0;
    sortedShares[sortedShares.length - 1] = channelGrossPence;
  } else {
    let allocated = 0;
    for (let k = 0; k < indexed.length - 1; k++) {
      const share = Math.round((indexed[k].p / currentTotalNetWeightPence) * channelGrossPence);
      sortedShares[k] = share;
      allocated += share;
    }
    sortedShares[sortedShares.length - 1] = channelGrossPence - allocated;
  }

  type Adjusted = {
    id: string;
    sku_id: string | null;
    quantity: number;
    oldUnitPrice: number;
    oldLineTotal: number;
    currentGrossProxyPence: number;
    targetGrossPence: number;
  };
  const adjusted: Adjusted[] = orderLines.map((l, i) => ({
    id: l.id,
    sku_id: l.sku_id,
    quantity: l.quantity ?? 1,
    oldUnitPrice: l.unit_price ?? 0,
    oldLineTotal: currentNetTotals[i],
    currentGrossProxyPence: currentGrossProxyPenceByLine[i],
    targetGrossPence: 0,
  }));
  for (let k = 0; k < indexed.length; k++) {
    adjusted[indexed[k].i].targetGrossPence = sortedShares[k];
  }

  // No-op short-circuit: stored lines already reproduce the canonical gross.
  if (
    toPence(currentOrderGross) === channelGrossPence &&
    adjusted.every((a) => a.currentGrossProxyPence === a.targetGrossPence)
  ) {
    return { repaired: false, reason: "Order gross already matches channel gross" };
  }

  // Persist line updates as 4dp ex-VAT amounts that reproduce the exact target
  // gross pence during qbo-sync-sales-receipt rebuild.
  for (const a of adjusted) {
    if (a.currentGrossProxyPence === a.targetGrossPence) continue;
    const newLineTotal = Math.round(((a.targetGrossPence / (VAT_DIVISOR * 100)) * 10000)) / 10000;
    const newUnitPrice = a.quantity > 0
      ? Math.round((newLineTotal / a.quantity) * 10000) / 10000
      : newLineTotal;

    const { error: updErr } = await admin
      .from("sales_order_line" as never)
      .update({
        unit_price: newUnitPrice,
        line_total: newLineTotal,
      } as never)
      .eq("id" as never, a.id);
    if (updErr) {
      return { repaired: false, reason: `Failed to update line ${a.id}: ${updErr.message}` };
    }

    if (a.sku_id) {
      const { data: skuRow } = await admin
        .from("sku" as never)
        .select("sku_code")
        .eq("id" as never, a.sku_id)
        .maybeSingle();
      const skuCode = (skuRow as { sku_code?: string } | null)?.sku_code ?? "unknown";
      await admin.from("price_audit_log" as never).insert({
        sku_id: a.sku_id,
        sku_code: skuCode,
        old_price: a.oldUnitPrice,
        new_price: newUnitPrice,
        reason: `payout_canonical_repair (order ${orderNumber ?? salesOrderId})`,
      } as never);
    }
  }

  // Update sales_order.gross_total to the exact channel gross.
  const { error: orderUpdErr } = await admin
    .from("sales_order" as never)
    .update({ gross_total: channelGross } as never)
    .eq("id" as never, salesOrderId);
  if (orderUpdErr) {
    return { repaired: false, reason: `Failed to update order gross_total: ${orderUpdErr.message}` };
  }

  const repairedLineTotals = adjusted.map((a) =>
    Math.round(((a.targetGrossPence / (VAT_DIVISOR * 100)) * 10000)) / 10000
  );
  console.log(
    `Repaired sales_order ${orderNumber ?? salesOrderId}: gross proxies ${currentGrossProxyPenceByLine.join(",")} → ${adjusted.map((a) => a.targetGrossPence).join(",")} and line totals ${currentNetTotals.join(",")} → ${repairedLineTotals.join(",")} (canonical gross £${channelGross.toFixed(2)})`,
  );
  return { repaired: true, reason: "OK" };
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

// ─── Main entry point (channel-agnostic) ─────────────────────

/**
 * Internal tx shape used by the legacy eBay-shaped pipeline below. The
 * adapter loads NeutralPayoutTx rows; we map them onto this shape so the
 * downstream code (which is already correct for eBay) doesn't need to be
 * rewritten. Field semantics are channel-neutral.
 */
type InternalTx = {
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
  ebay_item_id: string | null; // generic "channel-native item id"
  __neutral: NeutralPayoutTx;  // back-pointer for adapter callbacks
};

function neutralToInternal(n: NeutralPayoutTx): InternalTx {
  return {
    id: n.id,
    transaction_id: n.transactionId,
    transaction_type: n.transactionType,
    order_id: n.externalOrderId,
    gross_amount: n.grossAmount,
    total_fees: n.totalFees,
    net_amount: n.netAmount,
    fee_details: n.feeDetails.map((f) => ({ feeType: f.feeType, amount: f.amount, currency: f.currency })),
    matched_order_id: n.matchedOrderId,
    qbo_purchase_id: n.qboPurchaseId,
    memo: n.memo,
    ebay_item_id: n.externalItemId,
    __neutral: n,
  };
}

export async function syncPayoutCore(
  payoutId: string,
  admin: ReturnType<typeof createAdminClient>,
  adapter: PayoutAdapter,
): Promise<Response> {
  try {
    const { clientId, clientSecret, realmId } = getQBOConfig();

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

    // ─── 2. Load transactions via adapter ───────────────────
    const adapterDeps: AdapterDeps = {
      admin,
      payoutId,
      externalPayoutId,
      payoutDate,
      payoutNet: Number(p.net_amount ?? 0),
      payoutGross: Number(p.gross_amount ?? 0),
      payoutFees: Number(p.fees_amount ?? p.total_fees ?? 0),
    };

    const neutralTxs = await adapter.loadTransactions(adapterDeps);
    const allTransactions = neutralTxs.map(neutralToInternal);

    // Adapter-driven settlement classification (eBay TRANSFER pairing, etc.).
    // Settled tx ids are still booked as Purchases but go directly to bank
    // and are excluded from the deposit lines. Default: empty set.
    const classification = adapter.classifyTransactions
      ? adapter.classifyTransactions(neutralTxs)
      : { settledTxIds: new Set<string>() };
    const settledTxIds = classification.settledTxIds;

    // Some channels (eBay) include informational TRANSFER rows that must
    // not produce expense Purchases. Filter them out by string match — Stripe
    // and others won't have any TRANSFER rows so this is a no-op for them.
    const transactions = allTransactions.filter((t) => t.transaction_type !== "TRANSFER");
    if (settledTxIds.size > 0) {
      console.log(`Detected ${settledTxIds.size} settled charge(s) — booking direct to bank, excluding from deposit.`);
    }

    // ─── 3. Pre-flight: Verify SALE transactions are synced ─
    const saleTxs = transactions.filter((t) => t.transaction_type === "SALE");
    const expenseTxs = transactions; // all non-TRANSFER need expenses

    // Build order → QBO SalesReceipt map for deposit lines
    var orderQboMap = new Map<string, { qboId: string; channelGross: number; orderNumber: string | null; txId: string; transactionId: string; salesOrderId: string }>();
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

        // Good — add to deposit map. Carry the channel-recorded sale gross
        // (canonical for this historical sale) and the salesOrderId so the
        // deposit builder can detect drift and trigger an auto-rebuild.
        const orderNum = (so.order_number as string) ?? null;
        orderQboMap.set(so.id as string, {
          qboId: so.qbo_sales_receipt_id as string,
          channelGross: tx.gross_amount,
          orderNumber: orderNum,
          txId: tx.id,
          transactionId: tx.transaction_id,
          salesOrderId: so.id as string,
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
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        for (const tx of saleTxs) {
          let so: Record<string, unknown> | undefined;
          if (tx.matched_order_id) {
            so = soById.get(tx.matched_order_id);
          } else if (tx.order_id) {
            so = soByRef.get(tx.order_id);
          }

          if (!so || so.qbo_sales_receipt_id) continue;

          const recreateRes = await fetchWithTimeout(
            `${supabaseUrl}/functions/v1/qbo-sync-sales-receipt`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ orderId: so.id }),
            },
          );
          const recreateBody = await recreateRes.json().catch(() => ({}));
          if (!recreateRes.ok || (recreateBody && recreateBody.success === false)) {
            const message = `Cannot create deposit: failed to sync linked order ${(so.origin_reference as string) ?? (so.id as string)}: ${JSON.stringify(recreateBody).substring(0, 300)}`;
            await persistSyncFailure(admin, payoutId, message);
            return new Response(
              JSON.stringify({ success: false, error: message, payoutId }),
              { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          const { data: refreshedSo, error: refreshedErr } = await admin
            .from("sales_order" as never)
            .select("id, origin_reference, order_number, customer_id, qbo_sales_receipt_id, qbo_sync_status")
            .eq("id" as never, so.id as string)
            .single();

          if (refreshedErr || !refreshedSo || !(refreshedSo as Record<string, unknown>).qbo_sales_receipt_id) {
            const message = `Cannot create deposit: linked order ${(so.origin_reference as string) ?? (so.id as string)} did not relink a SalesReceipt after sync`;
            await persistSyncFailure(admin, payoutId, message);
            return new Response(
              JSON.stringify({ success: false, error: message, payoutId }),
              { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          const refreshed = refreshedSo as Record<string, unknown>;
          so.qbo_sales_receipt_id = refreshed.qbo_sales_receipt_id;
          so.qbo_sync_status = refreshed.qbo_sync_status;
        }
      }

      for (const tx of saleTxs) {
        let so: Record<string, unknown> | undefined;
        if (tx.matched_order_id) {
          so = soById.get(tx.matched_order_id);
        } else if (tx.order_id) {
          so = soByRef.get(tx.order_id);
        }

        if (!so || !so.qbo_sales_receipt_id || so.qbo_sales_receipt_id === "") continue;

        const orderNum = (so.order_number as string) ?? null;
        orderQboMap.set(so.id as string, {
          qboId: so.qbo_sales_receipt_id as string,
          channelGross: tx.gross_amount,
          orderNumber: orderNum,
          txId: tx.id,
          transactionId: tx.transaction_id,
          salesOrderId: so.id as string,
        });
        if (orderNum) {
          orderNumberByTxId.set(tx.id, orderNum);
        }
        const customerId = so.customer_id as string | null;
        if (customerId) {
          customerRefByTxId.set(tx.id, { value: customerId });
        }
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

    // ─── 4b. Resolve QBO ItemRefs via adapter (e.g. eBay insertion fees) ─
    // The adapter decides which transactions need an ItemRef on their
    // expense line and how to resolve it. Channels that don't need this
    // (Stripe) simply omit `resolveItemRef`.
    const itemRefByTxId = new Map<string, { value: string; name?: string }>();
    if (adapter.resolveItemRef) {
      for (const tx of allTransactions) {
        const ref = await adapter.resolveItemRef(tx.__neutral, adapterDeps);
        if (ref) itemRefByTxId.set(tx.id, ref);
      }
      if (itemRefByTxId.size > 0) {
        console.log(`Resolved ${itemRefByTxId.size} QBO ItemRef(s) via ${adapter.channel} adapter`);
      }
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
      // If the cached total doesn't match the canonical source amount, auto-rebuild:
      // delete the stale Purchase, clear the link, and fall through to recreate it
      // via the existing createQBOPurchase path (which handles VAT-recompute drift).
      if (tx.qbo_purchase_id) {
        if (tx.qbo_purchase_id === "N/A") continue;
        const acctRef = txType === "NON_SALE_CHARGE"
          ? buildAccountRef(subscriptionAccount!)
          : buildAccountRef(sellingFeesAccount);
        let cachedTotal = 0;
        let cacheReadOk = true;
        try {
          cachedTotal = await fetchQBODocTotal(baseUrl, accessToken, "Purchase", tx.qbo_purchase_id);
        } catch (e) {
          console.warn(`Cannot read cached QBO Purchase ${tx.qbo_purchase_id} for tx ${tx.transaction_id}: ${e instanceof Error ? e.message : String(e)}. Will attempt rebuild.`);
          cacheReadOk = false;
        }
        const expectedAmount = txType === "SALE" ? round2(tx.total_fees) : round2(Math.abs(tx.gross_amount));

        if (cacheReadOk && toPence(cachedTotal) === toPence(expectedAmount)) {
          // Cached Purchase matches canonical — reuse it.
          expenseResults.push({ txId: tx.id, qboPurchaseId: tx.qbo_purchase_id, amount: expectedAmount, qboTotalAmt: cachedTotal, accountRef: acctRef, transactionType: txType, settledViaTransfer: settledTxIds.has(tx.id) });
          continue;
        }

        // Drift (or unreadable) — delete the stale Purchase, clear the link, and
        // fall through to the recreate path below. The existing createQBOPurchase
        // helper has its own 3-attempt VAT-recompute convergence loop.
        console.warn(
          `Canonical drift on Purchase for tx ${tx.transaction_id}: cached TotalAmt £${cachedTotal.toFixed(2)} ≠ expected £${expectedAmount.toFixed(2)}. Auto-rebuilding…`,
        );
        await deleteQBOPurchase(baseUrl, accessToken, tx.qbo_purchase_id);
        await adapter.persistPurchaseId(adapterDeps, tx.__neutral, null);
        // Fall through to expense-line build + createQBOPurchase below.
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
            // ItemRef pre-resolved by adapter (e.g. eBay insertion fees)
            const adapterItemRef = itemRefByTxId.get(tx.id);
            if (adapterItemRef) itemRef = adapterItemRef;
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
    // Canonical rule (your stated business rule):
    //   The channel-recorded sale amount (ebay_payout_transactions.gross_amount)
    //   IS canonical for a historical sale. The app's sales_order is the legal
    //   record of that sale and its gross MUST equal the channel-recorded gross.
    //   The QBO SalesReceipt mirrors the sales_order so its TotalAmt MUST also
    //   equal the channel-recorded gross.
    //
    // QBO behaviour: when a Deposit line carries a LinkedTxn for a SalesReceipt
    // or Purchase, QBO ignores the line Amount we POST and substitutes the
    // linked document's TotalAmt. There is no "settlement adjustment" line we
    // can append that QBO will accept against a linked-doc deposit — empirically
    // QBO drops unlinked AccountRef lines from such deposits silently. Therefore
    // the deposit can only ever equal sum(linked-doc TotalAmts).
    //
    // Strategy: for every SALE, ensure QBO SalesReceipt TotalAmt == channel
    // gross. If it doesn't, repair the canonical sales_order, delete the stale
    // SalesReceipt, recreate it from the canonical order. Then construct
    // deposit lines from the verified canonical totals. The sum is then equal
    // to payout.net_amount by construction — no fudge line, no surprises.
    let depositLines: { Amount: number; DepositLineDetail: Record<string, unknown>; LinkedTxn: Array<Record<string, string>> }[] = [];

    if (typeof orderQboMap === "undefined" || orderQboMap.size === 0) {
      const msg = "Cannot create deposit: no SalesReceipt lines — all payout transactions must be linked to QBO records";
      await persistSyncFailure(admin, payoutId, msg);
      return new Response(
        JSON.stringify({ success: false, error: msg, payoutId, expensesCreated: expenseResults.length }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Canonical-drift detection + auto-rebuild for every SALE in the payout.
    // Per-order mismatches collected for the operator if auto-rebuild ultimately
    // fails — surfaced verbatim in qbo_sync_error so they know exactly which
    // order to investigate.
    const canonicalMismatches: Array<{
      orderNumber: string | null;
      transactionId: string;
      channelGross: number;
      qboTotal: number;
      reason: string;
    }> = [];

    for (const entry of orderQboMap.values()) {
      let qboTotal = 0;
      try {
        qboTotal = await fetchQBODocTotal(baseUrl, accessToken, "SalesReceipt", entry.qboId);
      } catch (e) {
        const reason = `Cannot read QBO SalesReceipt ${entry.qboId}: ${e instanceof Error ? e.message : String(e)}`;
        canonicalMismatches.push({
          orderNumber: entry.orderNumber,
          transactionId: entry.transactionId,
          channelGross: entry.channelGross,
          qboTotal: 0,
          reason,
        });
        continue;
      }

      if (toPence(qboTotal) === toPence(entry.channelGross)) {
        depositLines.push({
          Amount: round2(qboTotal),
          DepositLineDetail: { PaymentMethodRef: { value: "1" } },
          LinkedTxn: [{ TxnId: entry.qboId, TxnLineId: "0", TxnType: "SalesReceipt" }],
        });
        continue;
      }

      // Drift detected. Auto-rebuild this sale.
      console.warn(
        `Canonical drift on ${entry.orderNumber ?? entry.transactionId}: ` +
          `QBO SalesReceipt ${entry.qboId} TotalAmt £${qboTotal.toFixed(2)} ≠ ` +
          `channel gross £${entry.channelGross.toFixed(2)}. Auto-rebuilding…`,
      );

      // Step 1: repair the local sales_order so its gross == channel gross.
      const repair = await repairSalesOrderToCanonicalGross(
        admin,
        entry.salesOrderId,
        entry.orderNumber,
        entry.channelGross,
      );
      if (!repair.repaired && repair.reason !== "Order gross already matches channel gross") {
        canonicalMismatches.push({
          orderNumber: entry.orderNumber,
          transactionId: entry.transactionId,
          channelGross: entry.channelGross,
          qboTotal,
          reason: `sales_order repair failed: ${repair.reason}`,
        });
        continue;
      }

      // Step 2: delete the stale QBO SalesReceipt.
      await deleteQBOSalesReceipt(baseUrl, accessToken, entry.qboId);

      // Step 3: clear the local QBO link so qbo-sync-sales-receipt builds fresh.
      await admin
        .from("sales_order" as never)
        .update({ qbo_sales_receipt_id: null, qbo_sync_status: null } as never)
        .eq("id" as never, entry.salesOrderId);

      // Step 4: invoke qbo-sync-sales-receipt for this order.
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const recreateRes = await fetchWithTimeout(
        `${supabaseUrl}/functions/v1/qbo-sync-sales-receipt`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ orderId: entry.salesOrderId }),
        },
      );
      const recreateBody = await recreateRes.json().catch(() => ({}));
      if (!recreateRes.ok || (recreateBody && recreateBody.success === false)) {
        canonicalMismatches.push({
          orderNumber: entry.orderNumber,
          transactionId: entry.transactionId,
          channelGross: entry.channelGross,
          qboTotal,
          reason: `Recreate SalesReceipt failed: ${JSON.stringify(recreateBody).substring(0, 300)}`,
        });
        continue;
      }

      // Step 5: re-fetch the new SalesReceipt id + verify TotalAmt to the penny.
      const { data: refreshedSo } = await admin
        .from("sales_order" as never)
        .select("qbo_sales_receipt_id")
        .eq("id" as never, entry.salesOrderId)
        .single();
      const newReceiptId = (refreshedSo as { qbo_sales_receipt_id?: string } | null)?.qbo_sales_receipt_id;
      if (!newReceiptId) {
        canonicalMismatches.push({
          orderNumber: entry.orderNumber,
          transactionId: entry.transactionId,
          channelGross: entry.channelGross,
          qboTotal,
          reason: "SalesReceipt was not relinked after recreate",
        });
        continue;
      }
      const newQboTotal = await fetchQBODocTotal(baseUrl, accessToken, "SalesReceipt", newReceiptId);
      if (toPence(newQboTotal) !== toPence(entry.channelGross)) {
        canonicalMismatches.push({
          orderNumber: entry.orderNumber,
          transactionId: entry.transactionId,
          channelGross: entry.channelGross,
          qboTotal: newQboTotal,
          reason: `Recreated SalesReceipt ${newReceiptId} TotalAmt £${newQboTotal.toFixed(2)} still ≠ channel gross £${entry.channelGross.toFixed(2)}`,
        });
        continue;
      }

      console.log(
        `Recreated SalesReceipt ${newReceiptId} for ${entry.orderNumber}: TotalAmt £${newQboTotal.toFixed(2)} matches channel gross.`,
      );
      depositLines.push({
        Amount: round2(newQboTotal),
        DepositLineDetail: { PaymentMethodRef: { value: "1" } },
        LinkedTxn: [{ TxnId: newReceiptId, TxnLineId: "0", TxnType: "SalesReceipt" }],
      });
    }

    if (canonicalMismatches.length > 0) {
      const msg =
        `Canonical sale mismatch on ${canonicalMismatches.length} order(s): ` +
        canonicalMismatches
          .map((m) => `${m.orderNumber ?? m.transactionId} (channel £${m.channelGross.toFixed(2)}, QBO £${m.qboTotal.toFixed(2)} — ${m.reason})`)
          .join("; ");
      await persistSyncFailure(admin, payoutId, msg);
      return new Response(
        JSON.stringify({
          success: false,
          error: msg,
          payoutId,
          canonicalMismatches,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Expense (Purchase) lines — negative amounts net off the deposit.
    // qboTotalAmt was already verified to equal the source amount to the penny
    // (cached path: lines 821–827; fresh path: post-POST drift loop in
    // createQBOPurchase). So sum(deposit lines) is canonical by construction.
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

    if (depositLines.length === 0) {
      const msg = "Cannot create deposit: no deposit lines built — payout has no matched sales and no deductible expenses";
      await persistSyncFailure(admin, payoutId, msg);
      return new Response(JSON.stringify({ success: false, error: msg, payoutId }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Pre-POST balance assertion ──────────────────────────
    // After canonical-rebuild and verified expense totals, the deposit must
    // equal payout.net_amount to the penny. If not, something upstream is
    // broken — abort hard rather than mask with a fudge line.
    const constructedPence = depositLines.reduce((s, l) => s + toPence(l.Amount), 0);
    const expectedNet = p.net_amount as number;
    const expectedPence = toPence(expectedNet);

    if (constructedPence !== expectedPence) {
      const breakdown = depositLines
        .map((l) => `£${l.Amount.toFixed(2)} (${l.LinkedTxn?.[0]?.TxnType ?? "?"} ${l.LinkedTxn?.[0]?.TxnId ?? "?"})`)
        .join(", ");
      const msg =
        `Deposit construction does not balance: built £${fromPence(constructedPence).toFixed(2)} ` +
        `(${constructedPence}p), payout net £${expectedNet.toFixed(2)} (${expectedPence}p), ` +
        `delta ${expectedPence - constructedPence}p. Lines: ${breakdown}. ` +
        `This means a linked QBO doc total no longer matches its source — investigate ` +
        `the SalesReceipt/Purchase totals listed above.`;
      await persistSyncFailure(admin, payoutId, msg);
      return new Response(
        JSON.stringify({ success: false, error: msg, payoutId }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`Deposit balances exactly: £${expectedNet.toFixed(2)} across ${depositLines.length} lines.`);

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
          console.log(`Found existing QBO deposit ${qboDepositId} for DocNumber ${externalPayoutId} (TotalAmt £${qboDepositTotal.toFixed(2)})`);
          // Persist the link + synced status immediately so the UI reflects
          // reality even if a later step throws before the final status write.
          // Verification below may still downgrade to 'error' on TotalAmt mismatch.
          await admin
            .from("payouts" as never)
            .update({
              qbo_deposit_id: qboDepositId,
              qbo_sync_status: "synced",
              qbo_sync_error: null,
            } as never)
            .eq("id", payoutId);
        }
      } else {
        await existingRes.text();
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

    // ─── Post-POST verification: QBO Deposit TotalAmt MUST equal payout net ─
    // Read back from QBO (don't trust the POST response). If QBO dropped/forced
    // any line during creation, the TotalAmt will diverge — surface that as a
    // hard error so it never silently mis-posts.
    if (qboDepositId) {
      try {
        const verifiedTotal = await fetchQBODocTotal(baseUrl, accessToken, "Deposit", qboDepositId);
        if (toPence(verifiedTotal) !== expectedPence) {
          const driftPence = expectedPence - toPence(verifiedTotal);
          const msg =
            `QBO Deposit ${qboDepositId} TotalAmt £${verifiedTotal.toFixed(2)} ` +
            `does not equal payout net £${expectedNet.toFixed(2)} (drift ${driftPence}p). ` +
            `QBO dropped or forced a deposit line. Inspect the deposit in QBO and ` +
            `investigate which linked document changed.`;
          await persistSyncFailure(admin, payoutId, msg);
          // Persist the qbo_deposit_id so the operator can navigate to it,
          // but keep status = error.
          await admin
            .from("payouts" as never)
            .update({ qbo_deposit_id: qboDepositId } as never)
            .eq("id", payoutId);
          return new Response(
            JSON.stringify({
              success: false,
              error: msg,
              payoutId,
              qbo_deposit_id: qboDepositId,
              expected_total: expectedNet,
              actual_total: verifiedTotal,
            }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        qboDepositTotal = verifiedTotal;
      } catch (e) {
        const msg = `Could not verify created QBO Deposit ${qboDepositId}: ${e instanceof Error ? e.message : String(e)}`;
        await persistSyncFailure(admin, payoutId, msg);
        return new Response(
          JSON.stringify({ success: false, error: msg, payoutId, qbo_deposit_id: qboDepositId }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ─── 7. Update payout record ────────────────────────────
    // Status:
    //  - synced  → deposit landed, balanced exactly, no skipped txns
    //  - partial → deposit landed but ≥1 expense skipped (drift unresolvable)
    //  - error   → deposit creation itself failed
    const finalStatus = qboDepositId
      ? (skippedTransactions.length > 0 ? "partial" : "synced")
      : "error";
    const noteParts: string[] = [];
    if (skippedTransactions.length > 0) {
      noteParts.push(
        `Partial sync: ${skippedTransactions.length} transaction(s) skipped after auto-adjust failed: ${skippedTransactions.map((s) => `${s.transactionId} (expected £${s.expected.toFixed(2)}, QBO returned £${s.lastQboTotal.toFixed(2)})`).join("; ")}`
      );
    }
    const partialMessage = noteParts.length > 0 ? noteParts.join(" ") : null;
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
      qbo_deposit_total: qboDepositTotal,
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

