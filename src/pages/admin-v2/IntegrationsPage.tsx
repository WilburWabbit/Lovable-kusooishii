import { Link } from "react-router-dom";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";

const integrations = [
  { slug: "ebay", label: "eBay", to: "/admin/channels/ebay" },
  { slug: "stripe", label: "Stripe", to: "/admin/integrations/stripe" },
  { slug: "qbo", label: "QuickBooks", to: "/admin/integrations/qbo" },
  { slug: "gmc", label: "Google Merchant Center", to: "/admin/gmc" },
  { slug: "meta", label: "Meta", to: "/admin/settings/integrations?entity=meta" },
  { slug: "brickeconomy", label: "BrickEconomy", to: "/admin/integrations/brickeconomy" },
  { slug: "rebrickable", label: "Rebrickable", to: "/admin/integrations/rebrickable" },
];

export default function IntegrationsPage() {
  return <AdminV2Layout><div className="space-y-4"><h1 className="text-2xl font-bold">Integrations</h1><div className="grid gap-3 md:grid-cols-2">{integrations.map((i)=><Link key={i.slug} to={i.to} className="rounded border p-4 text-sm hover:bg-zinc-50">{i.label}</Link>)}</div></div></AdminV2Layout>;
}
