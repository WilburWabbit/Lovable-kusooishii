import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { SectionHead, SurfaceCard } from "@/components/admin-v2/ui-primitives";
import { QboSettingsCard } from "@/components/admin-v2/QboSettingsCard";
import { EbaySettingsCard } from "@/components/admin-v2/EbaySettingsCard";
import { PricingSettingsCard } from "@/components/admin-v2/PricingSettingsCard";

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
        </div>

        <div className="mt-6">
          <PricingSettingsCard />
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
