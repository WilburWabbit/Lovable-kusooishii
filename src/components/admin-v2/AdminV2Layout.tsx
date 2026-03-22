import { AdminV2Sidebar } from "./AdminV2Sidebar";

interface AdminV2LayoutProps {
  children: React.ReactNode;
  ungradedCount?: number;
  actionNeededCount?: number;
}

export function AdminV2Layout({ children, ungradedCount, actionNeededCount }: AdminV2LayoutProps) {
  return (
    <div className="flex h-screen bg-[#1C1C1E] font-sans text-zinc-50">
      <AdminV2Sidebar
        ungradedCount={ungradedCount}
        actionNeededCount={actionNeededCount}
      />
      <main className="flex-1 overflow-auto px-8 py-6">
        {children}
      </main>
    </div>
  );
}
