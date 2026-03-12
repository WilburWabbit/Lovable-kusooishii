import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { SellingCostDefaultsPanel } from "./SellingCostDefaultsPanel";
import { ChannelFeesSettingsPanel } from "./ChannelFeesSettingsPanel";
import { ChannelPricingConfigPanel } from "./ChannelPricingConfigPanel";

export default function SellingFeesSettingsPage() {
  return (
    <BackOfficeLayout title="Selling Fees">
      <div className="space-y-6 animate-fade-in max-w-2xl">
        <SellingCostDefaultsPanel />
        <ChannelPricingConfigPanel />
        <ChannelFeesSettingsPanel />
      </div>
    </BackOfficeLayout>
  );
}
