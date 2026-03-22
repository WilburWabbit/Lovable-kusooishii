import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { StripeSettingsPanel } from "./StripeSettingsPanel";
import { QboSettingsPanel } from "./QboSettingsPanel";
import { EbaySettingsPanel } from "./EbaySettingsPanel";
import { BrickEconomySettingsPanel } from "./BrickEconomySettingsPanel";
import { GmcSettingsPanel } from "./GmcSettingsPanel";

export default function IntegrationsSettingsPage() {
  return (
    <BackOfficeLayout title="Integrations">
      <div className="space-y-6 animate-fade-in max-w-2xl">
        <StripeSettingsPanel />
        <QboSettingsPanel />
        <EbaySettingsPanel />
        <GmcSettingsPanel />
        <BrickEconomySettingsPanel />
      </div>
    </BackOfficeLayout>
  );
}
