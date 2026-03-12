import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { ShippingRatesSettingsPanel } from "./ShippingRatesSettingsPanel";

export default function ShippingRatesSettingsPage() {
  return (
    <BackOfficeLayout title="Shipping Rates">
      <div className="space-y-6 animate-fade-in max-w-2xl">
        <ShippingRatesSettingsPanel />
      </div>
    </BackOfficeLayout>
  );
}
