import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { QboSettingsPanel } from "./QboSettingsPanel";
import { BrickEconomySettingsPanel } from "./BrickEconomySettingsPanel";
import { EbaySettingsPanel } from "./EbaySettingsPanel";
import { ChannelFeesSettingsPanel } from "./ChannelFeesSettingsPanel";
import { ShippingRatesSettingsPanel } from "./ShippingRatesSettingsPanel";
import { SellingCostDefaultsPanel } from "./SellingCostDefaultsPanel";

export function SettingsPage() {
  return (
    <BackOfficeLayout title="Settings">
      <div className="space-y-6 animate-fade-in max-w-2xl">
        <QboSettingsPanel />
        <EbaySettingsPanel />
        <BrickEconomySettingsPanel />
        <SellingCostDefaultsPanel />
        <ChannelFeesSettingsPanel />
        <ShippingRatesSettingsPanel />
      </div>
    </BackOfficeLayout>
  );
}
