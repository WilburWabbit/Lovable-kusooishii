import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { StripeSettingsCard } from "@/components/admin-v2/StripeSettingsCard";
import { QboSettingsCard } from "@/components/admin-v2/QboSettingsCard";
import { BrickEconomySettingsCard } from "@/components/admin-v2/BrickEconomySettingsCard";
import { RebrickableImportCard } from "@/components/admin-v2/RebrickableImportCard";

export default function IntegrationDetailPage() {
  const { integration } = useParams();
  const title = useMemo(() => integration?.toUpperCase() ?? "Integration", [integration]);

  return (
    <AdminV2Layout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{title} Integration</h1>
        {integration === "stripe" && <StripeSettingsCard />}
        {integration === "qbo" && <QboSettingsCard />}
        {integration === "brickeconomy" && <BrickEconomySettingsCard />}
        {integration === "rebrickable" && <RebrickableImportCard />}
      </div>
    </AdminV2Layout>
  );
}
