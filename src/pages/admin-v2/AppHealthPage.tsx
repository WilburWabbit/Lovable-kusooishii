import { useQuery } from "@tanstack/react-query";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { SurfaceCard, SectionHead } from "@/components/admin-v2/ui-primitives";
import { invokeWithAuth } from "@/lib/invokeWithAuth";

type DiagnosticsSnapshot = {
  generated_at: string;
  schema: { tables: Array<{ table_schema: string; table_name: string }>; routines: Array<{ routine_schema: string; routine_name: string }>; table_error?: string | null; routine_error?: string | null };
  health: { app_settings_rows: number;
    settings_error?: string | null;
    roles_error?: string | null; user_role_counts: Record<string, number>; pending_or_error_qbo_landing: number };
  logs: { audit_events: Array<Record<string, unknown>>; landing_qbo_errors: Array<Record<string, unknown>>; audit_error?: string | null; landing_error?: string | null };
};

function isKnownSchemaDiscoveryLimit(message?: string | null) {
  return message === "Invalid schema: information_schema";
}

export default function AppHealthPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "app-health"],
    queryFn: () => invokeWithAuth<DiagnosticsSnapshot>("admin-data", { action: "diagnostics-snapshot", limit: 200 }),
  });

  const tableDiscoveryLimited = isKnownSchemaDiscoveryLimit(data?.schema.table_error);
  const routineDiscoveryLimited = isKnownSchemaDiscoveryLimit(data?.schema.routine_error);
  const schemaDiscoveryLimited = tableDiscoveryLimited || routineDiscoveryLimited;

  return (
    <AdminV2Layout>
      <div className="space-y-6">
        <SectionHead title="App Health" subtitle="Live diagnostics snapshot of schema, operational signals, and recent logs." />
        <button className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => refetch()}>Refresh snapshot</button>
        {isLoading ? <SurfaceCard>Loading…</SurfaceCard> : null}
        {error ? <SurfaceCard><p className="text-sm text-destructive">Failed to load diagnostics: {(error as Error).message}</p></SurfaceCard> : null}
        {data ? (
          <>
            <SurfaceCard>
              <p className="text-sm">Generated: {new Date(data.generated_at).toLocaleString()}</p>
              <p className="text-sm">Tables discovered: {data.schema.tables.length}</p>
              <p className="text-sm">Public routines discovered: {data.schema.routines.length}</p>
              <p className="text-sm">Pending/Error QBO landing rows: {data.health.pending_or_error_qbo_landing}</p>
              <p className="text-sm">App settings rows: {data.health.app_settings_rows}</p>
              {data.health.settings_error ? <p className="text-sm text-destructive">Settings error: {data.health.settings_error}</p> : null}
              {data.health.roles_error ? <p className="text-sm text-destructive">Role error: {data.health.roles_error}</p> : null}
              {schemaDiscoveryLimited ? (
                <p className="text-sm text-muted-foreground">
                  Schema discovery unavailable: Supabase does not expose information_schema through this diagnostics client.
                </p>
              ) : null}
              {data.schema.table_error && !tableDiscoveryLimited ? <p className="text-sm text-destructive">Schema table discovery error: {data.schema.table_error}</p> : null}
              {data.schema.routine_error && !routineDiscoveryLimited ? <p className="text-sm text-destructive">Schema routine discovery error: {data.schema.routine_error}</p> : null}
            </SurfaceCard>
            <SurfaceCard>
              <h3 className="mb-2 font-medium">Recent Audit Events</h3>
              <pre className="max-h-80 overflow-auto text-xs">{JSON.stringify(data.logs.audit_events, null, 2)}</pre>
            </SurfaceCard>
            <SurfaceCard>
              <h3 className="mb-2 font-medium">Recent QBO Landing Errors</h3>
              <pre className="max-h-80 overflow-auto text-xs">{JSON.stringify(data.logs.landing_qbo_errors, null, 2)}</pre>
            </SurfaceCard>
          </>
        ) : null}
      </div>
    </AdminV2Layout>
  );
}
