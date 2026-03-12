import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { QboSettingsPanel } from "./QboSettingsPanel";
import { EbaySettingsPanel } from "./EbaySettingsPanel";
import { BrickEconomySettingsPanel } from "./BrickEconomySettingsPanel";

export default function IntegrationsSettingsPage() {
  return (
    <BackOfficeLayout title="Integrations">
      <div className="space-y-6 animate-fade-in max-w-2xl">
        <QboSettingsPanel />
        <EbaySettingsPanel />
        <BrickEconomySettingsPanel />
      </div>
    </BackOfficeLayout>
  );
}
