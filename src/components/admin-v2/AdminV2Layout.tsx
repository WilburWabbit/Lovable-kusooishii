import { useMemo } from "react";
import { AdminV2Sidebar } from "./AdminV2Sidebar";
import { AiAssistant } from "./AiAssistant";
import { useBatchUnitSummaries } from "@/hooks/admin/use-purchase-batches";
import { useOrders } from "@/hooks/admin/use-orders";

interface AdminV2LayoutProps {
  children: React.ReactNode;
}

export function AdminV2Layout({ children }: AdminV2LayoutProps) {
  const { data: summaryMap } = useBatchUnitSummaries();
  const { data: orders } = useOrders();

  const ungradedCount = useMemo(() => {
    if (!summaryMap) return 0;
    return Array.from(summaryMap.values()).reduce((s, b) => s + b.ungradedCount, 0);
  }, [summaryMap]);

  const actionNeededCount = useMemo(() => {
    if (!orders) return 0;
    return orders.filter(
      (o) => o.status === "needs_allocation" || o.status === "return_pending"
    ).length;
  }, [orders]);

  return (
    <div className="flex h-screen font-sans">
      <AdminV2Sidebar
        ungradedCount={ungradedCount}
        actionNeededCount={actionNeededCount}
      />
      <main className="flex-1 overflow-auto bg-stone-100 px-8 py-6 text-zinc-900">
        {children}
      </main>
      <AiAssistant />
    </div>
  );
}
