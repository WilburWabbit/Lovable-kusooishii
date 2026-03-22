import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";

export default function PayoutListPage() {
  return (
    <AdminV2Layout>
      <div>
        <h1 className="text-[22px] font-bold text-zinc-50 mb-1">Payouts</h1>
        <p className="text-zinc-500 text-[13px]">Channel payouts, fee breakdowns, QBO sync.</p>
      </div>
    </AdminV2Layout>
  );
}
