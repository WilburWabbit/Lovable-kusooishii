import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";

export default function NewPurchaseFormPage() {
  return (
    <AdminV2Layout>
      <div>
        <h1 className="text-[22px] font-bold text-zinc-50 mb-1">New Purchase</h1>
        <p className="text-zinc-500 text-[13px]">Record a new purchase batch.</p>
      </div>
    </AdminV2Layout>
  );
}
