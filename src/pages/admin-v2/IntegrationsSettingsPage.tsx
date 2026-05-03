import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { AdminPageHeader } from "@/components/admin-v2/admin-patterns";
import { QboSettingsCard } from "@/components/admin-v2/QboSettingsCard";
import { StripeSettingsCard } from "@/components/admin-v2/StripeSettingsCard";
import { EbaySettingsCard } from "@/components/admin-v2/EbaySettingsCard";
import { BrickEconomySettingsCard } from "@/components/admin-v2/BrickEconomySettingsCard";
import { GmcSettingsCard } from "@/components/admin-v2/GmcSettingsCard";
import { AiProviderSettingsCard } from "@/components/admin-v2/AiProviderSettingsCard";

export default function IntegrationsSettingsPage() {
  return (
    <AdminV2Layout>
      <AdminPageHeader
        title="Integrations"
        description="Connector credentials, health checks, and setup actions are managed separately from daily operational pages."
      />
      <div className="space-y-3">
        <QboSettingsCard />
        <StripeSettingsCard />
        <EbaySettingsCard />
        <GmcSettingsCard />
        <BrickEconomySettingsCard />
        <AiProviderSettingsCard />
      </div>
    </AdminV2Layout>
  );
}
