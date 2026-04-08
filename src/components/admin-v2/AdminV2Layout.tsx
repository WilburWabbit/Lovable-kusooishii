import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Menu } from "lucide-react";
import { AdminV2Sidebar } from "./AdminV2Sidebar";
import { useBatchUnitSummaries } from "@/hooks/admin/use-purchase-batches";
import { useOrders } from "@/hooks/admin/use-orders";

interface AdminV2LayoutProps {
  children: React.ReactNode;
}

export function AdminV2Layout({ children }: AdminV2LayoutProps) {
  const { data: summaryMap } = useBatchUnitSummaries();
  const { data: orders } = useOrders();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-12 bg-[#18181B] border-b border-zinc-700/80 flex items-center gap-3 px-4">
        <button
          onClick={() => setSidebarOpen(true)}
          className="text-zinc-400 hover:text-zinc-200 transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link to="/admin/purchases" className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-xs font-extrabold text-zinc-900">
            K
          </div>
          <span className="text-sm font-bold text-zinc-50">Kuso Hub</span>
        </Link>
      </div>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <AdminV2Sidebar
        ungradedCount={ungradedCount}
        actionNeededCount={actionNeededCount}
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex-1 overflow-auto bg-stone-100 px-8 py-6 pt-[calc(3rem+1.5rem)] md:pt-6 text-zinc-900">
        {children}
      </main>
    </div>
  );
}
