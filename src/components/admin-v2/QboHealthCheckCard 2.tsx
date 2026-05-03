// ============================================================
// QboHealthCheckCard
// Preflight panel for /admin/data-sync. Calls the
// qbo-health-check edge function and reports any missing
// QBO tables/functions/views that would break sync actions.
// ============================================================

import { useState } from "react";
import { SurfaceCard, SectionHead, Badge } from "./ui-primitives";
import { Button } from "@/components/ui/button";
import { useQboHealth, type HealthCheck } from "@/hooks/admin/useQboHealth";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

function statusFor(report: { missing_critical: number; missing_warn: number } | null) {
  if (!report) return { label: "Unknown", color: "#6B7280" };
  if (report.missing_critical > 0) return { label: "Missing migrations", color: "#DC2626" };
  if (report.missing_warn > 0) return { label: "Warnings", color: "#D97706" };
  return { label: "Healthy", color: "#16A34A" };
}

function GroupedRows({ checks }: { checks: HealthCheck[] }) {
  // Group by migration_hint so staff see "apply this file → fixes these N items".
  const groups = new Map<string, HealthCheck[]>();
  for (const c of checks) {
    const key = c.migration_hint;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }
  return (
    <div className="space-y-3">
      {Array.from(groups.entries()).map(([hint, items]) => (
        <div key={hint} className="rounded border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-xs font-mono text-foreground">{hint}</span>
          </div>
          <ul className="space-y-1 pl-6 list-disc text-xs">
            {items.map(item => (
              <li key={`${item.kind}:${item.name}`} className="text-muted-foreground">
                <span className="font-mono text-foreground">{item.name}</span>
                <span className="text-muted-foreground"> ({item.kind})</span>
                {item.severity === "critical" && (
                  <span className="ml-2 inline-block rounded bg-red-500/15 text-red-600 text-[10px] px-1.5 py-px uppercase">
                    Critical
                  </span>
                )}
                <div className="text-[11px] text-muted-foreground/80">{item.description}</div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function QboHealthCheckCard() {
  const { report, loading, error, refresh } = useQboHealth();
  const [showMigrations, setShowMigrations] = useState(false);

  const status = statusFor(report);
  const missing = (report?.checks ?? []).filter(c => !c.present);
  const present = (report?.checks ?? []).filter(c => c.present);

  return (
    <SurfaceCard>
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionHead>QBO Health Check</SectionHead>
          <p className="text-xs text-muted-foreground mt-1">
            Verifies the database objects that the QBO sync and refresh edge functions depend on.
            Run this before invoking any QBO action if you've recently pulled new code or migrations.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge label={status.label} color={status.color} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-1.5">Re-run</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {report && (
        <div className="mt-4 space-y-4">
          {report.missing_critical > 0 && (
            <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-800">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                Do not run QBO sync or refresh actions until these migrations are applied.
              </div>
              <div className="mt-1 text-red-700/90">
                {report.missing_critical} critical object{report.missing_critical === 1 ? "" : "s"} missing.
                Edge functions like <span className="font-mono">qbo-wholesale-refresh</span> will fail with PGRST205 / 42P01.
              </div>
            </div>
          )}

          {missing.length > 0 ? (
            <div>
              <div className="text-xs font-semibold text-foreground mb-2">
                Missing objects ({missing.length})
              </div>
              <GroupedRows checks={missing} />
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              All {present.length} required QBO objects are present.
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowMigrations(v => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {showMigrations ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Recent applied migrations ({report.recent_migrations.length})
            </button>
            {showMigrations && (
              <div className={cn("mt-2 rounded border border-border bg-muted/30 p-3", report.recent_migrations.length === 0 && "italic text-muted-foreground")}>
                {report.recent_migrations.length === 0 ? (
                  <span className="text-xs">Migration history not exposed via API in this environment.</span>
                ) : (
                  <ul className="space-y-0.5 text-xs font-mono">
                    {report.recent_migrations.map(v => (
                      <li key={v}>{v}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="text-[10px] text-muted-foreground">
            Last checked {new Date(report.generated_at).toLocaleString()}
          </div>
        </div>
      )}
    </SurfaceCard>
  );
}
