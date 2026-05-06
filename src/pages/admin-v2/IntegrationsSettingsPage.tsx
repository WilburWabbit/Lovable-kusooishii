import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { AdminPageHeader } from "@/components/admin-v2/admin-patterns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QboSettingsCard } from "@/components/admin-v2/QboSettingsCard";
import { StripeSettingsCard } from "@/components/admin-v2/StripeSettingsCard";
import { EbaySettingsCard } from "@/components/admin-v2/EbaySettingsCard";
import { BrickEconomySettingsCard } from "@/components/admin-v2/BrickEconomySettingsCard";
import { GmcSettingsCard } from "@/components/admin-v2/GmcSettingsCard";
import { GmcDeveloperRegistrationCard } from "@/components/admin-v2/GmcDeveloperRegistrationCard";
import { MetaSettingsCard } from "@/components/admin-v2/MetaSettingsCard";
import { AiProviderSettingsCard } from "@/components/admin-v2/AiProviderSettingsCard";
import { useSearchParams } from "react-router-dom";

const INTEGRATION_TABS = [
  { value: "google", label: "Google" },
  { value: "meta", label: "Meta" },
  { value: "quickbooks", label: "QuickBooks" },
  { value: "stripe", label: "Stripe" },
  { value: "ebay", label: "eBay" },
  { value: "brickeconomy", label: "BrickEconomy" },
  { value: "ai", label: "AI" },
] as const;

type IntegrationTab = typeof INTEGRATION_TABS[number]["value"];

function isIntegrationTab(value: string | null): value is IntegrationTab {
  return INTEGRATION_TABS.some((tab) => tab.value === value);
}

export default function IntegrationsSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = isIntegrationTab(searchParams.get("entity"))
    ? searchParams.get("entity") as IntegrationTab
    : "google";

  const setTab = (value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("entity", value);
      return next;
    }, { replace: true });
  };

  return (
    <AdminV2Layout>
      <AdminPageHeader
        title="Integrations"
        description="Connector credentials, health checks, and setup actions are managed separately from daily operational pages."
      />
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1 bg-zinc-100">
          {INTEGRATION_TABS.map((item) => (
            <TabsTrigger key={item.value} value={item.value} className="text-xs">
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="google" className="mt-0 space-y-3">
          <GmcSettingsCard />
          <GmcDeveloperRegistrationCard />
        </TabsContent>
        <TabsContent value="meta" className="mt-0 space-y-3">
          <MetaSettingsCard />
        </TabsContent>
        <TabsContent value="quickbooks" className="mt-0 space-y-3">
          <QboSettingsCard />
        </TabsContent>
        <TabsContent value="stripe" className="mt-0 space-y-3">
          <StripeSettingsCard />
        </TabsContent>
        <TabsContent value="ebay" className="mt-0 space-y-3">
          <EbaySettingsCard />
        </TabsContent>
        <TabsContent value="brickeconomy" className="mt-0 space-y-3">
          <BrickEconomySettingsCard />
        </TabsContent>
        <TabsContent value="ai" className="mt-0 space-y-3">
          <AiProviderSettingsCard />
        </TabsContent>
      </Tabs>
    </AdminV2Layout>
  );
}
