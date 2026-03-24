import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { CsvSyncPage } from "@/components/admin-v2/csv-sync/CsvSyncPage";

export default function DataSyncPage() {
  return (
    <AdminV2Layout>
      <CsvSyncPage />
    </AdminV2Layout>
  );
}
