import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { QboSettingsCard } from "@/components/admin-v2/QboSettingsCard";
import { CsvSyncPage } from "@/components/admin-v2/csv-sync/CsvSyncPage";

export default function DataSyncPage() {
  return (
    <AdminV2Layout>
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">
            QuickBooks re-sync is available here as a fallback path when you need to re-land source data before resolving sync issues. Primary integration controls remain in Settings.
          </p>
          <QboSettingsCard />
        </div>
        <CsvSyncPage />
      </div>
    </AdminV2Layout>
  );
}
