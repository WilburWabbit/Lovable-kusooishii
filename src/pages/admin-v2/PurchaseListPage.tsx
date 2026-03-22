import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";

export default function PurchaseListPage() {
  return (
    <AdminV2Layout>
      <div>
        <h1 className="text-[22px] font-bold text-zinc-50 mb-1">Purchases</h1>
        <p className="text-zinc-500 text-[13px]">Purchase batches and goods-in grading.</p>
      </div>
    </AdminV2Layout>
  );
}
