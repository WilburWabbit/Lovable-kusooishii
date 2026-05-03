// ============================================================
// useQboHealth — shared hook for QBO health-check status.
// Powers the QboHealthCheckCard on /admin/data-sync and lets
// other QBO admin cards disable destructive actions when
// critical migrations are missing.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";

export type HealthSeverity = "critical" | "warn";
export type HealthKind = "table" | "view" | "function";

export interface HealthCheck {
  name: string;
  kind: HealthKind;
  severity: HealthSeverity;
  migration_hint: string;
  description: string;
  present: boolean;
}

export interface HealthReport {
  ok: boolean;
  missing_count: number;
  missing_critical: number;
  missing_warn: number;
  checks: HealthCheck[];
  recent_migrations: string[];
  generated_at: string;
}

interface UseQboHealth {
  report: HealthReport | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  hasCriticalGaps: boolean;
}

export function useQboHealth(): UseQboHealth {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invokeWithAuth<HealthReport>("qbo-health-check");
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load health check");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return {
    report,
    loading,
    error,
    refresh,
    hasCriticalGaps: !!report && report.missing_critical > 0,
  };
}
