// ============================================================
// Edge Function: csv-sync
// Handles CSV export, stage, diff, apply, rollback, history.
// All actions require admin/staff role.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(msg: string, status = 400) {
  return jsonResponse({ error: msg }, status);
}

// ─── Table registry (server-side subset) ────────────────────
// Mirrors the client registry for column definitions, modes, and FK resolvers.
// Duplicated here because edge functions can't import from src/.

interface ColumnConfig {
  dbColumn: string;
  csvHeader: string;
  type: string;
  mode: "editable" | "readonly" | "fk";
  required: boolean;
  enumValues?: string[];
}

interface FkResolver {
  fkColumn: string;
  csvLookupColumn: string;
  targetTable: string;
  targetLookupColumn: string;
  targetPkColumn: string;
}

interface TableConfig {
  tableName: string;
  primaryKey: string;
  naturalKeys: string[];
  columns: ColumnConfig[];
  fkResolvers: FkResolver[];
  exportOrderBy: string;
  allowDelete: boolean;
}

// We load the table config from a shared constant rather than duplicating all 12
// table definitions. The client sends tableName and we validate against this list.
const VALID_TABLES = [
  "purchase_batches",
  "purchase_line_items",
  "stock_unit",
  "product",
  "sku",
  "channel_listing",
  "sales_order",
  "sales_order_line",
  "customer",
  "payouts",
  "payout_orders",
  "landing_raw_ebay_payout",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth ──────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Unauthorized", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token);
    if (userError || !user) {
      return errorResponse("Unauthorized", 401);
    }
    const userId = user.id;

    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    const hasAccess = (roles ?? []).some(
      (r: { role: string }) => r.role === "admin" || r.role === "staff",
    );
    if (!hasAccess) {
      return errorResponse("Forbidden", 403);
    }

    // ── Route by action ──────────────────────────────────
    const { action, ...params } = await req.json();

    switch (action) {
      case "export":
        return await handleExport(admin, params);
      case "stage":
        return await handleStage(admin, userId, params);
      case "diff":
        return await handleDiff(admin, params);
      case "apply":
        return await handleApply(admin, params);
      case "rollback":
        return await handleRollback(admin, params);
      case "history":
        return await handleHistory(admin, params);
      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("csv-sync error:", msg);
    return errorResponse(msg, 500);
  }
});

// ─── Export ─────────────────────────────────────────────────

async function handleExport(
  admin: ReturnType<typeof createClient>,
  params: { tableName: string; filters?: Record<string, unknown> },
) {
  const { tableName, filters } = params;
  if (!VALID_TABLES.includes(tableName)) {
    return errorResponse(`Invalid table: ${tableName}`);
  }

  let query = admin.from(tableName).select("*");

  // Apply optional filters
  if (filters) {
    for (const [col, val] of Object.entries(filters)) {
      query = query.eq(col, val);
    }
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;

  return jsonResponse({ rows: data ?? [], tableName });
}

// ─── Stage ──────────────────────────────────────────────────

async function handleStage(
  admin: ReturnType<typeof createClient>,
  userId: string,
  params: { tableName: string; filename: string; rows: Record<string, string>[] },
) {
  const { tableName, filename, rows } = params;
  if (!VALID_TABLES.includes(tableName)) {
    return errorResponse(`Invalid table: ${tableName}`);
  }
  if (!rows || rows.length === 0) {
    return errorResponse("No rows to stage");
  }

  // Create session
  const { data: session, error: sessErr } = await admin
    .from("csv_sync_session")
    .insert({
      table_name: tableName,
      filename,
      row_count: rows.length,
      performed_by: userId,
      status: "staged",
    })
    .select("id")
    .single();
  if (sessErr) throw sessErr;

  // Stage rows in batches of 500
  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((row, idx) => ({
      session_id: session.id,
      row_number: i + idx + 1,
      raw_data: row,
      status: "pending",
    }));
    const { error: stageErr } = await admin.from("csv_sync_staging").insert(batch);
    if (stageErr) throw stageErr;
  }

  return jsonResponse({ sessionId: session.id, rowCount: rows.length });
}

// ─── Diff ───────────────────────────────────────────────────

async function handleDiff(
  admin: ReturnType<typeof createClient>,
  params: { sessionId: string },
) {
  const { sessionId } = params;

  // Load session
  const { data: session, error: sessErr } = await admin
    .from("csv_sync_session")
    .select("*")
    .eq("id", sessionId)
    .single();
  if (sessErr || !session) return errorResponse("Session not found", 404);
  if (session.status !== "staged") {
    return errorResponse(`Session status must be "staged", got "${session.status}"`);
  }

  const tableName = session.table_name;

  // Load staged rows
  const { data: staged, error: stageErr } = await admin
    .from("csv_sync_staging")
    .select("*")
    .eq("session_id", sessionId)
    .order("row_number");
  if (stageErr) throw stageErr;

  // Load current canonical data
  const { data: canonical, error: canErr } = await admin
    .from(tableName)
    .select("*");
  if (canErr) throw canErr;

  // Build lookup maps for canonical data by id
  const canonicalById = new Map<string, Record<string, unknown>>();
  for (const row of (canonical ?? [])) {
    canonicalById.set(String(row.id), row);
  }

  // Track which canonical rows are "seen" (for delete detection)
  const seenIds = new Set<string>();

  const changeset: Array<{
    action: string;
    row_id: string | null;
    natural_key: Record<string, string> | null;
    before_data: Record<string, unknown> | null;
    after_data: Record<string, unknown> | null;
    changed_fields: string[];
    warnings: string[];
    errors: string[];
  }> = [];

  let errorCount = 0;
  let warningCount = 0;

  for (const stagedRow of (staged ?? [])) {
    const raw = stagedRow.raw_data as Record<string, string>;
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];
    const rowId = raw.id && raw.id.trim() !== "" ? raw.id.trim() : null;

    // Determine if this is an insert or update
    let existingRow: Record<string, unknown> | null = null;

    if (rowId && canonicalById.has(rowId)) {
      existingRow = canonicalById.get(rowId)!;
      seenIds.add(rowId);
    }

    if (existingRow) {
      // ── UPDATE: compare fields ────────────────────────
      const changedFields: string[] = [];
      const afterData: Record<string, unknown> = { ...existingRow };

      for (const [key, val] of Object.entries(raw)) {
        if (key === "id") continue;
        // Skip empty values (don't overwrite with null unless explicitly clearing)
        const newVal = val?.trim() ?? "";
        const oldVal = existingRow[key];
        const oldStr = oldVal === null || oldVal === undefined ? "" : String(oldVal);

        if (newVal !== oldStr && newVal !== "") {
          changedFields.push(key);
          afterData[key] = newVal;
        }
      }

      if (changedFields.length > 0) {
        changeset.push({
          action: "update",
          row_id: rowId,
          natural_key: null,
          before_data: existingRow,
          after_data: afterData,
          changed_fields: changedFields,
          warnings: rowWarnings,
          errors: rowErrors,
        });
      }
    } else {
      // ── INSERT ────────────────────────────────────────
      const afterData: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(raw)) {
        if (key === "id" && (!val || val.trim() === "")) continue;
        if (val && val.trim() !== "") {
          afterData[key] = val.trim();
        }
      }

      changeset.push({
        action: "insert",
        row_id: null,
        natural_key: null,
        before_data: null,
        after_data: afterData,
        changed_fields: [],
        warnings: rowWarnings,
        errors: rowErrors,
      });
    }

    if (rowErrors.length > 0) errorCount++;
    if (rowWarnings.length > 0) warningCount++;
  }

  // ── Delete detection: canonical rows not in CSV ─────
  // Only check for tables that allow delete
  // For now, skip delete detection — it requires the full registry which
  // would make this function too large. Delete detection can be added later.

  // Write changeset to DB
  if (changeset.length > 0) {
    const BATCH_SIZE = 500;
    for (let i = 0; i < changeset.length; i += BATCH_SIZE) {
      const batch = changeset.slice(i, i + BATCH_SIZE).map((c) => ({
        session_id: sessionId,
        ...c,
      }));
      const { error: csErr } = await admin
        .from("csv_sync_changeset")
        .insert(batch);
      if (csErr) throw csErr;
    }
  }

  // Update session
  const insertCount = changeset.filter((c) => c.action === "insert").length;
  const updateCount = changeset.filter((c) => c.action === "update").length;
  const deleteCount = changeset.filter((c) => c.action === "delete").length;

  await admin
    .from("csv_sync_session")
    .update({
      status: "previewed",
      insert_count: insertCount,
      update_count: updateCount,
      delete_count: deleteCount,
      warning_count: warningCount,
      error_count: errorCount,
    })
    .eq("id", sessionId);

  return jsonResponse({
    sessionId,
    inserts: insertCount,
    updates: updateCount,
    deletes: deleteCount,
    errors: errorCount,
    warnings: warningCount,
    changeset: changeset.map((c) => ({
      action: c.action,
      rowId: c.row_id,
      changedFields: c.changed_fields,
      warnings: c.warnings,
      errors: c.errors,
      beforeData: c.before_data,
      afterData: c.after_data,
    })),
  });
}

// ─── Apply ──────────────────────────────────────────────────

async function handleApply(
  admin: ReturnType<typeof createClient>,
  params: { sessionId: string },
) {
  const { sessionId } = params;

  // Call the atomic SQL function
  const { data, error } = await admin.rpc("csv_sync_apply_changeset", {
    p_session_id: sessionId,
  });
  if (error) throw error;

  return jsonResponse(data);
}

// ─── Rollback ───────────────────────────────────────────────

async function handleRollback(
  admin: ReturnType<typeof createClient>,
  params: { sessionId: string },
) {
  const { sessionId } = params;

  const { data, error } = await admin.rpc("csv_sync_rollback_session", {
    p_session_id: sessionId,
  });
  if (error) throw error;

  return jsonResponse(data);
}

// ─── History ────────────────────────────────────────────────

async function handleHistory(
  admin: ReturnType<typeof createClient>,
  params: { tableName?: string; limit?: number },
) {
  const { tableName, limit = 50 } = params;

  let query = admin
    .from("csv_sync_session")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (tableName) {
    query = query.eq("table_name", tableName);
  }

  const { data, error } = await query;
  if (error) throw error;

  return jsonResponse({ sessions: data ?? [] });
}
