// ============================================================
// qbo-list-accounts
// Returns the active accounts in the connected QBO company so
// the admin can pick which account to use for inventory asset,
// sales income, COGS and cash/bank in QboSettingsCard.
// Also returns the currently configured mappings from
// qbo_account_settings so the picker can show selections.
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

interface QboAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType?: string;
  Active?: boolean;
  Classification?: string;
  CurrentBalance?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "list");

    // ─── Save mappings ─────────────────────────────────────
    if (action === "save") {
      const mappings = body?.mappings as Record<string, { account_id: string; account_name?: string; account_type?: string }>;
      if (!mappings || typeof mappings !== "object") {
        return jsonResponse({ error: "mappings is required" }, 400);
      }
      const allowedKeys = new Set([
        "qbo_inventory_asset_account_id",
        "qbo_income_account_id",
        "qbo_cogs_account_id",
        "qbo_cash_account_id",
        "qbo_shipping_expense_account_id",
        "qbo_broker_fee_expense_account_id",
        "qbo_other_purchase_expense_account_id",
      ]);
      const rows: Array<Record<string, unknown>> = [];
      for (const [key, value] of Object.entries(mappings)) {
        if (!allowedKeys.has(key)) continue;
        if (!value?.account_id) continue;
        rows.push({
          key,
          account_id: value.account_id,
          account_name: value.account_name ?? null,
          account_type: value.account_type ?? null,
          updated_at: new Date().toISOString(),
        });
      }
      if (rows.length === 0) return jsonResponse({ saved: 0 });

      const { error } = await admin
        .from("qbo_account_settings" as never)
        .upsert(rows as never, { onConflict: "key" } as never);
      if (error) throw new Error(`Save failed: ${error.message}`);
      return jsonResponse({ saved: rows.length });
    }

    // ─── List accounts (default) ───────────────────────────
    const { clientId, clientSecret, realmId } = getQBOConfig();
    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = qboBaseUrl(realmId);

    // Pull all active accounts. QBO caps query results at ~1000;
    // a typical company has < 200 accounts so a single page is fine.
    const query = "SELECT Id, Name, AccountType, AccountSubType, Active, Classification, CurrentBalance FROM Account WHERE Active = true MAXRESULTS 500";
    const url = `${baseUrl}/query?query=${encodeURIComponent(query)}&minorversion=65`;
    const res = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`QBO accounts query failed [${res.status}]: ${txt.substring(0, 300)}`);
    }
    const json = await res.json();
    const accounts = ((json?.QueryResponse?.Account ?? []) as QboAccount[])
      .map((a) => ({
        id: a.Id,
        name: a.Name,
        type: a.AccountType,
        subType: a.AccountSubType ?? null,
        classification: a.Classification ?? null,
        balance: a.CurrentBalance ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Current mappings
    const { data: settings } = await admin
      .from("qbo_account_settings" as never)
      .select("key, account_id, account_name, account_type");
    const mappings: Record<string, { account_id: string; account_name: string | null; account_type: string | null }> = {};
    for (const row of (settings ?? []) as Record<string, unknown>[]) {
      const k = row.key as string;
      mappings[k] = {
        account_id: (row.account_id as string) ?? "",
        account_name: (row.account_name as string) ?? null,
        account_type: (row.account_type as string) ?? null,
      };
    }

    return jsonResponse({ accounts, mappings });
  } catch (err) {
    console.error("qbo-list-accounts error:", err);
    return errorResponse(err, 500);
  }
});
