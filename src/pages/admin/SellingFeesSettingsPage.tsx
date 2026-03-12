import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { SellingCostDefaultsPanel } from "./SellingCostDefaultsPanel";
import { ChannelFeesSettingsPanel } from "./ChannelFeesSettingsPanel";

export default function SellingFeesSettingsPage() {
  return (
    <BackOfficeLayout title="Selling Fees">
      <div className="space-y-6 animate-fade-in max-w-2xl">
        <SellingCostDefaultsPanel />
        <ChannelFeesSettingsPanel />
      </div>
    </BackOfficeLayout>
  );
}
