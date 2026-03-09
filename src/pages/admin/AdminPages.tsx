import { BackOfficeLayout } from "@/components/BackOfficeLayout";

interface AdminPlaceholderProps {
  title: string;
  description: string;
}

function AdminPlaceholder({ title, description }: AdminPlaceholderProps) {
  return (
    <BackOfficeLayout title={title}>
      <div className="flex h-[60vh] items-center justify-center animate-fade-in">
        <div className="text-center">
          <h2 className="font-display text-xl font-bold text-foreground">{title}</h2>
          <p className="mt-2 font-body text-sm text-muted-foreground max-w-md">{description}</p>
        </div>
      </div>
    </BackOfficeLayout>
  );
}

// IntakePage moved to src/pages/admin/IntakePage.tsx

// InventoryPage moved to src/pages/admin/InventoryPage.tsx

export function ListingsPage() {
  return <AdminPlaceholder title="Listings" description="Multi-channel listing orchestration, coverage tracking, and publish queue." />;
}

export function OrdersPage() {
  return <AdminPlaceholder title="Orders" description="Cross-channel order management, fulfilment tracking, and refund processing." />;
}

export function ReconciliationPage() {
  return <AdminPlaceholder title="Reconciliation" description="Settlement matching, payout reconciliation, and exception management." />;
}

export function DemandPage() {
  return <AdminPlaceholder title="Demand" description="Wishlist signals, stock alerts, price watches, and sourcing intelligence." />;
}

export function AnalyticsPage() {
  return <AdminPlaceholder title="Analytics" description="Operational, strategic, and digital analytics dashboards." />;
}

export function AuditPage() {
  return <AdminPlaceholder title="Audit Explorer" description="Immutable audit trail with full event lineage and raw payload inspection." />;
}

export { SettingsPage } from "./SettingsPageFull";
