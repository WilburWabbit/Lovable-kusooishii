import { Link } from "react-router-dom";
import {
  Activity,
  ArrowUpDown,
  Bot,
  FileSearch,
  Map,
  MessageSquare,
  Receipt,
  Settings,
  Store,
  Truck,
} from "lucide-react";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { AdminPageHeader } from "@/components/admin-v2/admin-patterns";
import { SurfaceCard } from "@/components/admin-v2/ui-primitives";

const settingsGroups = [
  {
    title: "Integration Control",
    description: "Credentials, connector status, sync tools, staging errors, and replay controls.",
    items: [
      { label: "Integrations", to: "/admin/settings/integrations", icon: Settings, detail: "QBO, Stripe, eBay, BrickEconomy, GMC, and AI provider credentials." },
      { label: "Data Sync", to: "/admin/data-sync", icon: ArrowUpDown, detail: "Staging errors, health checks, imports, and CSV sync controls." },
      { label: "Google Merchant", to: "/admin/gmc", icon: Store, detail: "Merchant feed readiness and channel operation page." },
    ],
  },
  {
    title: "Commercial Rules",
    description: "Pricing, fees, shipping, taxonomy, and channel projection rules.",
    items: [
      { label: "Pricing Rules", to: "/admin/settings/pricing", icon: Receipt, detail: "Channel fees, selling-cost defaults, and pricing automation actions." },
      { label: "Shipping Rates", to: "/admin/settings/shipping-rates", icon: Truck, detail: "Carrier rate tables used by fulfilment and pricing." },
      { label: "Channel Mappings", to: "/admin/settings/channel-mappings", icon: Map, detail: "Canonical attributes, item specifics, and condition mappings." },
      { label: "SEO/GEO", to: "/admin/settings/seo-geo", icon: FileSearch, detail: "Search and generative answer optimisation documents." },
    ],
  },
  {
    title: "System Evidence",
    description: "Diagnostics, audit visibility, operational transcripts, and system-level inspection.",
    items: [
      { label: "App Health", to: "/admin/settings/app-health", icon: Activity, detail: "Schema, roles, settings, recent audit events, and landing errors." },
      { label: "Transcripts", to: "/admin/settings/transcripts", icon: MessageSquare, detail: "Review and export captured operational transcripts." },
      { label: "Schedules & Jobs", to: "/admin/operations", icon: Bot, detail: "Scheduled job evidence, posting queues, and reconciliation controls." },
    ],
  },
];

export default function SettingsSystemPage() {
  return (
    <AdminV2Layout>
      <AdminPageHeader
        title="Settings/System"
        description="Non-operational administration lives here so daily workspaces stay focused on intake, inventory, orders, finance, and customers."
      />

      <div className="space-y-6">
        {settingsGroups.map((group) => (
          <section key={group.title}>
            <div className="mb-3">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-zinc-500">{group.title}</h2>
              <p className="mt-1 text-[12px] text-zinc-500">{group.description}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {group.items.map((item) => (
                <Link key={item.to} to={item.to} className="block">
                  <SurfaceCard className="h-full">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">
                        <item.icon className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-900">{item.label}</h3>
                        <p className="mt-1 text-[12px] leading-5 text-zinc-500">{item.detail}</p>
                      </div>
                    </div>
                  </SurfaceCard>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AdminV2Layout>
  );
}
