import { useState } from "react";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { CanonicalAttributesPanel } from "@/components/admin-v2/settings/CanonicalAttributesPanel";
import { ChannelMappingsPanel } from "@/components/admin-v2/settings/ChannelMappingsPanel";
import { EbayConditionsPanel } from "@/components/admin-v2/settings/EbayConditionsPanel";

type Tab = "attributes" | "mappings" | "conditions";

export default function ChannelMappingsSettingsPage() {
  const [tab, setTab] = useState<Tab>("attributes");

  return (
    <AdminV2Layout>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] font-bold text-zinc-900">Channel Mappings</h1>
          <p className="text-[12px] text-zinc-500 mt-1 max-w-2xl">
            Configure the canonical attribute registry, how each attribute
            projects onto eBay's item specifics, and how internal condition
            grades resolve to eBay's per-category condition values.
          </p>
        </div>

        <div className="flex gap-1 border-b border-zinc-200 mb-5">
          <TabButton active={tab === "attributes"} onClick={() => setTab("attributes")}>
            Canonical Attributes
          </TabButton>
          <TabButton active={tab === "mappings"} onClick={() => setTab("mappings")}>
            eBay Mappings
          </TabButton>
          <TabButton active={tab === "conditions"} onClick={() => setTab("conditions")}>
            eBay Conditions
          </TabButton>
        </div>

        {tab === "attributes" && <CanonicalAttributesPanel />}
        {tab === "mappings" && <ChannelMappingsPanel />}
        {tab === "conditions" && <EbayConditionsPanel />}
      </div>
    </AdminV2Layout>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-[13px] border-b-2 -mb-px transition-colors ${
        active
          ? "border-amber-500 text-zinc-900 font-semibold"
          : "border-transparent text-zinc-500 hover:text-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}
