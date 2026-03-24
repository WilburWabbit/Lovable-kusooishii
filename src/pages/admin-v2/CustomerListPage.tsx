import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { CustomerList } from "@/components/admin-v2/CustomerList";

export default function CustomerListPage() {
  return (
    <AdminV2Layout>
      <CustomerList />
    </AdminV2Layout>
  );
}
