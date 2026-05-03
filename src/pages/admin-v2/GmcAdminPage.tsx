import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { GmcSettingsCard } from "@/components/admin-v2/GmcSettingsCard";

export default function GmcAdminPage() {
  return (
    <AdminV2Layout>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Manage Google Merchant Centre connection, publish orchestration, diagnostics, and field mapping context in one place.
        </p>
        <GmcSettingsCard />
      </div>
    </AdminV2Layout>
  );
}
