import { useQuery } from "@tanstack/react-query";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { SurfaceCard, SectionHead } from "@/components/admin-v2/ui-primitives";
import { invokeWithAuth } from "@/lib/invokeWithAuth";

type DiagnosticsSnapshot = {
  generated_at: string;
  schema: { tables: Array<{ table_schema: string; table_name: string }>; routines: Array<{ routine_schema: string; routine_name: string }>; table_error?: string | null; routine_error?: string | null };
  health: { app_settings_keys: number; user_role_counts: Record<string, number>; pending_or_error_qbo_landing: number };
  logs: { audit_events: Array<Record<string, unknown>>; landing_qbo_errors: Array<Record<string, unknown>>; audit_error?: string | null; landing_error?: string | null };
};

export default function AppHealthPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin", "app-health"],
    queryFn: () => invokeWithAuth<DiagnosticsSnapshot>("admin-data", { action: "diagnostics-snapshot", limit: 200 }),
  });

  return (
    <AdminV2Layout>
      <div className="space-y-6">
        <SectionHead title="App Health" subtitle="Live diagnostics snapshot of schema, operational signals, and recent logs." />
        <button className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => refetch()}>Refresh snapshot</button>
        {isLoading ? <SurfaceCard>Loading…</SurfaceCard> : null}
        {data ? (
          <>
            <SurfaceCard>
              <p className="text-sm">Generated: {new Date(data.generated_at).toLocaleString()}</p>
              <p className="text-sm">Tables discovered: {data.schema.tables.length}</p>
              <p className="text-sm">Public routines discovered: {data.schema.routines.length}</p>
              <p className="text-sm">Pending/Error QBO landing rows: {data.health.pending_or_error_qbo_landing}</p>
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
