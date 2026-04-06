import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { QboSettingsCard } from "@/components/admin-v2/QboSettingsCard";
import { StripeSettingsCard } from "@/components/admin-v2/StripeSettingsCard";
import { CsvSyncPage } from "@/components/admin-v2/csv-sync/CsvSyncPage";
import { StagingErrorsPanel } from "@/components/admin-v2/StagingErrorsPanel";

export default function DataSyncPage() {
  return (
    <AdminV2Layout>
      <div className="space-y-6">
        <StagingErrorsPanel />
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Integration re-sync is available here as a fallback path when you need to re-land or republish source data before resolving sync issues. Primary integration controls remain in Settings.
          </p>
          <QboSettingsCard />
          <StripeSettingsCard />
        </div>
        <CsvSyncPage />
      </div>
    </AdminV2Layout>
  );
}
