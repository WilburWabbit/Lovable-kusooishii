import { Link } from "react-router-dom";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { AdminPageHeader } from "@/components/admin-v2/admin-patterns";
import { QboHealthCheckCard } from "@/components/admin-v2/QboHealthCheckCard";
import { CsvSyncPage } from "@/components/admin-v2/csv-sync/CsvSyncPage";
import { StagingErrorsPanel } from "@/components/admin-v2/StagingErrorsPanel";
import { RebrickableImportCard } from "@/components/admin-v2/RebrickableImportCard";

export default function DataSyncPage() {
  return (
    <AdminV2Layout>
      <div className="space-y-6">
        <AdminPageHeader
          title="Data Sync"
          description="Operational sync controls for staging errors, catalogue imports, CSV transfer, and replay paths. Connector credentials live in Settings."
          actions={
            <Link
              to="/admin/settings/integrations"
              className="inline-flex h-9 items-center rounded-md border border-zinc-300 bg-white px-3 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Integration Settings
            </Link>
          }
        />
        <QboHealthCheckCard />
        <StagingErrorsPanel />
        <RebrickableImportCard />
        <CsvSyncPage />
      </div>
    </AdminV2Layout>
  );
}
