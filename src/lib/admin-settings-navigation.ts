import type { ElementType } from "react";
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

export interface AdminSettingsItem {
  label: string;
  to: string;
  icon: ElementType;
  detail: string;
}

export interface AdminSettingsGroup {
  title: string;
  description: string;
  items: AdminSettingsItem[];
}

export const adminSettingsGroups: AdminSettingsGroup[] = [
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
