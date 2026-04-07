import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { SectionHead, SurfaceCard } from "@/components/admin-v2/ui-primitives";
import { QboSettingsCard } from "@/components/admin-v2/QboSettingsCard";
import { EbaySettingsCard } from "@/components/admin-v2/EbaySettingsCard";
import { StripeSettingsCard } from "@/components/admin-v2/StripeSettingsCard";
import { PricingSettingsCard } from "@/components/admin-v2/PricingSettingsCard";
import { PricingActionsCard } from "@/components/admin-v2/PricingActionsCard";
import { BrickEconomySettingsCard } from "@/components/admin-v2/BrickEconomySettingsCard";

export default function SettingsPage() {
  return (
    <AdminV2Layout>
      <div>
        <h1 className="text-[22px] font-bold text-zinc-900 mb-1">Settings</h1>
        <p className="text-zinc-500 text-[13px] mb-5">
          Configuration, integrations, and credentials.
        </p>

        <SectionHead>Integrations</SectionHead>
        <div className="grid gap-3">
          <QboSettingsCard />
          <EbaySettingsCard />
          <StripeSettingsCard />
          <BrickEconomySettingsCard />
        </div>

        <div className="mt-6">
          <PricingSettingsCard />
        </div>

        <div className="mt-6">
          <SectionHead>Pricing Actions</SectionHead>
          <PricingActionsCard />
        </div>

        <div className="mt-6">
          <SectionHead>System</SectionHead>
          <SurfaceCard>
            <div className="text-zinc-600 text-xs">
              Admin V2 build. Edge functions require manual deployment via{" "}
              <code className="text-amber-500">npx supabase functions deploy</code>.
            </div>
          </SurfaceCard>
        </div>
      </div>
    </AdminV2Layout>
  );
}
