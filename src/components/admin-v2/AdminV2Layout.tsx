import { useMemo, useState } from "react";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminV2Sidebar } from "./AdminV2Sidebar";
import { AiAssistant } from "./AiAssistant";
import { useBatchUnitSummaries } from "@/hooks/admin/use-purchase-batches";
import { useOrders } from "@/hooks/admin/use-orders";

interface AdminV2LayoutProps {
  children: React.ReactNode;
}

export function AdminV2Layout({ children }: AdminV2LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    <div className="flex h-dvh font-sans">
      {/* Mobile top bar — visible below lg only */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-[#18181B] border-b border-zinc-700/80 flex items-center px-4 gap-3">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 -ml-2 text-zinc-400 hover:text-white min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <Menu className="h-6 w-6" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-xs font-extrabold text-zinc-900">
            K
          </div>
          <span className="text-sm font-semibold text-zinc-100">Kuso Hub</span>
        </div>
      </div>

      {/* Backdrop — mobile only */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <AdminV2Sidebar
        ungradedCount={ungradedCount}
        actionNeededCount={actionNeededCount}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex-1 overflow-auto bg-stone-100 px-4 py-4 lg:px-8 lg:py-6 pt-[72px] lg:pt-6 text-zinc-900">
        {children}
      </main>

      <AiAssistant />
    </div>
  );
}
