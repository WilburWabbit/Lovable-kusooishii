import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { useConnectionStatus } from "@/hooks/admin/use-connection-status";
import { SurfaceCard, SectionHead, Badge } from "@/components/admin-v2/ui-primitives";

export default function SettingsPage() {
  const { data: status, isLoading } = useConnectionStatus();

  const integrations = [
    {
      name: "QuickBooks Online",
      key: "qbo" as const,
      description: "Accounting sync — SalesReceipts, Items, Deposits, Expenses",
    },
    {
      name: "eBay",
      key: "ebay" as const,
      description: "Order import, listing management, payout reconciliation",
    },
    {
      name: "Stripe",
      key: "stripe" as const,
      description: "Website and in-person payment processing, payout tracking",
    },
  ];

  const stateColor = (state: string) =>
    state === "connected" ? "#22C55E" : state === "expired" ? "#F59E0B" : "#EF4444";
  const stateLabel = (state: string) =>
    state === "connected" ? "Connected" : state === "expired" ? "Expired" : "Disconnected";

  return (
    <AdminV2Layout>
      <div>
        <h1 className="text-[22px] font-bold text-zinc-50 mb-1">Settings</h1>
        <p className="text-zinc-500 text-[13px] mb-5">
          Configuration, integrations, and credentials.
        </p>

        <SectionHead>Integrations</SectionHead>
        <div className="grid gap-3">
          {integrations.map((int) => {
            const state = status?.[int.key] ?? "disconnected";
            return (
              <SurfaceCard key={int.key}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-zinc-50 font-medium text-sm">{int.name}</div>
                    <div className="text-zinc-500 text-xs mt-0.5">{int.description}</div>
                  </div>
                  <Badge
                    label={isLoading ? "Checking…" : stateLabel(state)}
                    color={isLoading ? "#71717A" : stateColor(state)}
                  />
                </div>
              </SurfaceCard>
            );
          })}
        </div>

        <div className="mt-6">
          <SectionHead>System</SectionHead>
          <SurfaceCard>
            <div className="text-zinc-400 text-xs">
              Admin V2 build. Edge functions require manual deployment via{" "}
              <code className="text-amber-500">npx supabase functions deploy</code>.
            </div>
          </SurfaceCard>
        </div>
      </div>
    </AdminV2Layout>
  );
}
