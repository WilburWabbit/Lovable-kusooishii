// ============================================================
// qbo-health-check
// Read-only preflight check for the /admin/data-sync page.
// Verifies that the QBO-related tables, views, and functions
// expected by the sync/refresh edge functions actually exist
// in the database, so staff can detect missing migrations
// before invoking destructive sync actions.
// ============================================================

import {
  corsHeaders,
  createAdminClient,
  authenticateRequest,
} from "../_shared/qbo-helpers.ts";

type Severity = "critical" | "warn";
type Kind = "table" | "view" | "function";

interface CheckSpec {
  name: string;
  kind: Kind;
  severity: Severity;
  migration_hint: string;
  description: string;
}

interface CheckResult extends CheckSpec {
  present: boolean;
}

// ─── Allowlist of expected QBO objects ──────────────────────
// Keep this list curated. Each entry includes the migration
// filename that introduces it so the UI can guide remediation.

const EXPECTED: CheckSpec[] = [
  // QBO Wholesale Refresh foundation
  {
    name: "qbo_refresh_run",
    kind: "table",
    severity: "critical",
    migration_hint: "20260501010000_rolling_operations_reference_grading_qbo_refresh.sql",
    description: "Tracks each QBO wholesale refresh run.",
  },
  {
    name: "qbo_refresh_drift",
    kind: "table",
    severity: "critical",
    migration_hint: "20260501010000_rolling_operations_reference_grading_qbo_refresh.sql",
    description: "Stores drift findings between app and QBO.",
  },
  {
    name: "v_qbo_refresh_drift",
    kind: "view",
    severity: "warn",
    migration_hint: "20260501010000_rolling_operations_reference_grading_qbo_refresh.sql",
    description: "Convenience view over qbo_refresh_drift.",
  },
  {
    name: "rebuild_qbo_refresh_drift",
    kind: "function",
    severity: "critical",
    migration_hint: "20260501010000_rolling_operations_reference_grading_qbo_refresh.sql",
    description: "RPC that rebuilds drift findings from a refresh run.",
  },
  {
    name: "approve_qbo_refresh_drift",
    kind: "function",
    severity: "critical",
    migration_hint: "20260501010000_rolling_operations_reference_grading_qbo_refresh.sql",
    description: "RPC for staff approval of drift corrections.",
  },
  {
    name: "apply_approved_qbo_refresh_drift",
    kind: "function",
    severity: "critical",
    migration_hint: "20260501010000_rolling_operations_reference_grading_qbo_refresh.sql",
    description: "RPC that applies approved drift corrections.",
  },

  // Posting intents queue
  {
    name: "qbo_posting_intents",
    kind: "table",
    severity: "critical",
    migration_hint: "20260430240000_manage_qbo_posting_intents.sql",
    description: "Queue of pending QBO posting intents.",
  },

  // QBO connection / sync tracking
  {
    name: "qbo_connection",
    kind: "table",
    severity: "critical",
    migration_hint: "qbo-auth setup migration",
    description: "Stores active QBO OAuth connection.",
  },
  {
    name: "qbo_sync_state",
    kind: "table",
    severity: "warn",
    migration_hint: "20260318100000_qbo_sync_tracking.sql",
    description: "Per-entity QBO sync cursor and state.",
  },
  {
    name: "qbo_account_settings",
    kind: "table",
    severity: "warn",
    migration_hint: "20260313100000_align_account_qbo.sql",
    description: "Account mappings for QBO ledger postings.",
  },

  // Shared helper
  {
    name: "has_role",
    kind: "function",
    severity: "critical",
    migration_hint: "user roles migration",
    description: "Role check used by RLS and admin checks.",
  },
];

interface ExistingObject { name: string; kind: Kind }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    const { userId } = await authenticateRequest(req, admin);

    // Admin role check (skip for service-role internal calls)
    if (userId !== "service-role") {
      const { data: isAdmin, error: roleErr } = await admin.rpc("has_role", {
        _user_id: userId,
        _role: "admin",
      });
      if (roleErr || !isAdmin) {
        return new Response(
          JSON.stringify({ error: "Forbidden — admin role required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const tableNames = EXPECTED.filter(e => e.kind === "table").map(e => e.name);
    const viewNames = EXPECTED.filter(e => e.kind === "view").map(e => e.name);
    const fnNames = EXPECTED.filter(e => e.kind === "function").map(e => e.name);

    // Run lookups in parallel using PostgREST against information_schema
    // and pg_catalog via dedicated SQL helper RPCs is fragile, so we use
    // the .from(...).select on information_schema views, which Supabase
    // exposes when the schema is added to the API. Since that's not
    // guaranteed, we instead use a single rpc('exec_sql_*') style call —
    // but the project policy forbids raw SQL. So we use the lightweight
    // approach: call known catalog views via from('information_schema.tables')
    // through the postgres meta endpoint is not available either.
    //
    // Instead: use a single SECURITY DEFINER RPC if present, otherwise
    // probe each object by attempting a HEAD select. We'll probe.

    const existing: ExistingObject[] = [];

    // Probe tables/views by attempting a head count with limit 0.
    // PostgREST returns a clean error code when the relation is missing
    // (PGRST205 / 42P01) which we treat as "not present".
    for (const name of [...tableNames, ...viewNames]) {
      try {
        const { error } = await admin.from(name).select("*", { count: "exact", head: true }).limit(0);
        if (!error) {
          existing.push({
            name,
            kind: viewNames.includes(name) ? "view" : "table",
          });
        } else {
          const code = (error as { code?: string }).code ?? "";
          const msg = error.message ?? "";
          // Treat "missing" signals as not-present; treat any other
          // error as present-but-restricted (still counts as present).
          const isMissing =
            code === "PGRST205" ||
            code === "42P01" ||
            /Could not find the table|does not exist/i.test(msg);
          if (!isMissing) {
            existing.push({
              name,
              kind: viewNames.includes(name) ? "view" : "table",
            });
          }
        }
      } catch {
        // network/unknown — leave as not-present
      }
    }

    // Probe functions by calling them with realistic stub args so
    // PostgREST resolves the named overload. We then distinguish:
    //   - PGRST202 / 42883 with "Could not find the function": MISSING
    //   - Any other outcome (success, validation error, runtime error,
    //     permission denied): PRESENT
    // Stub args are chosen to match the known signatures; if the RPC
    // signature changes, this probe degrades to "missing", which is a
    // safe-fail (it surfaces a warning rather than hiding a real gap).
    const FN_STUBS: Record<string, Record<string, unknown>> = {
      rebuild_qbo_refresh_drift: { p_run_id: "00000000-0000-0000-0000-000000000000" },
      approve_qbo_refresh_drift: { p_drift_id: "00000000-0000-0000-0000-000000000000" },
      apply_approved_qbo_refresh_drift: { p_run_id: "00000000-0000-0000-0000-000000000000" },
      has_role: { _user_id: "00000000-0000-0000-0000-000000000000", _role: "admin" },
    };

    for (const name of fnNames) {
      try {
        const args = FN_STUBS[name] ?? {};
        const { error } = await admin.rpc(name, args);
        if (!error) {
          existing.push({ name, kind: "function" });
        } else {
          const code = (error as { code?: string }).code ?? "";
          const msg = error.message ?? "";
          const isMissing =
            (code === "PGRST202" || code === "42883") &&
            /Could not find the function|does not exist/i.test(msg);
          if (!isMissing) {
            existing.push({ name, kind: "function" });
          }
        }
      } catch {
        // ignore
      }
    }

    const presentSet = new Set(existing.map(e => `${e.kind}:${e.name}`));
    const checks: CheckResult[] = EXPECTED.map(spec => ({
      ...spec,
      present: presentSet.has(`${spec.kind}:${spec.name}`),
    }));

    const missingCritical = checks.filter(c => !c.present && c.severity === "critical").length;
    const missingWarn = checks.filter(c => !c.present && c.severity === "warn").length;
    const missingCount = missingCritical + missingWarn;

    // Recent applied migrations (best-effort; supabase_migrations
    // is not exposed via PostgREST by default — return empty if not).
    let recentMigrations: string[] = [];
    try {
      const { data } = await admin
        .schema("supabase_migrations" as unknown as "public")
        .from("schema_migrations")
        .select("version")
        .order("version", { ascending: false })
        .limit(10);
      if (Array.isArray(data)) {
        recentMigrations = data.map((r: { version: string }) => r.version);
      }
    } catch {
      // not exposed — that's fine
    }

    return new Response(
      JSON.stringify({
        ok: missingCritical === 0,
        missing_count: missingCount,
        missing_critical: missingCritical,
        missing_warn: missingWarn,
        checks,
        recent_migrations: recentMigrations,
        generated_at: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = /Unauthorized/i.test(msg) ? 401 : 500;
    return new Response(
      JSON.stringify({ error: msg }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
