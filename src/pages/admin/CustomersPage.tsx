import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table";
import { Users, UserCheck, UserX } from "lucide-react";
import { format } from "date-fns";
import { useTablePreferences } from "@/hooks/useTablePreferences";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import { ColumnSelector } from "@/components/admin/ColumnSelector";
import { sortRows } from "@/lib/table-utils";

type CustomerRow = {
  id: string;
  qbo_customer_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  billing_city: string | null;
  billing_postcode: string | null;
  billing_country: string | null;
  active: boolean;
  synced_at: string;
  created_at: string;
};

const ALL_COLUMNS = [
  { key: "display_name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "mobile", label: "Mobile" },
  { key: "billing_city", label: "City" },
  { key: "billing_postcode", label: "Postcode" },
  { key: "billing_country", label: "Country" },
  { key: "active", label: "Active", align: "center" as const },
  { key: "synced_at", label: "Last Synced" },
];

const DEFAULT_VISIBLE = ALL_COLUMNS.map((c) => c.key);

function getSortValue(c: CustomerRow, key: string): unknown {
  switch (key) {
    case "display_name": return c.display_name;
    case "email": return c.email;
    case "phone": return c.phone;
    case "mobile": return c.mobile;
    case "billing_city": return c.billing_city;
    case "billing_postcode": return c.billing_postcode;
    case "billing_country": return c.billing_country;
    case "active": return c.active;
    case "synced_at": return c.synced_at;
    default: return null;
  }
}

function renderCell(c: CustomerRow, key: string): React.ReactNode {
  switch (key) {
    case "display_name":
      return <span className="font-medium text-sm">{c.display_name}</span>;
    case "email":
      return <span className="text-xs">{c.email ?? "—"}</span>;
    case "phone":
      return <span className="text-xs">{c.phone ?? "—"}</span>;
    case "mobile":
      return <span className="text-xs">{c.mobile ?? "—"}</span>;
    case "billing_city":
      return <span className="text-xs">{c.billing_city ?? "—"}</span>;
    case "billing_postcode":
      return <span className="text-xs font-mono">{c.billing_postcode ?? "—"}</span>;
    case "billing_country":
      return <span className="text-xs">{c.billing_country ?? "—"}</span>;
    case "active":
      return (
        <Badge variant="outline" className={c.active ? "bg-green-50 text-green-700 border-green-200" : "bg-muted text-muted-foreground"}>
          {c.active ? "Active" : "Inactive"}
        </Badge>
      );
    case "synced_at":
      return <span className="text-xs text-muted-foreground">{format(new Date(c.synced_at), "dd MMM yyyy HH:mm")}</span>;
    default: return null;
  }
}

export function CustomersPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const tp = useTablePreferences("admin-customers", DEFAULT_VISIBLE, { key: "display_name", dir: "asc" });

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["admin-customers"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-data", {
        body: { action: "list-customers" },
      });
      if (error) throw error;
      return (data ?? []) as CustomerRow[];
    },
    enabled: !!user,
  });

  const filtered = useMemo(() => {
    let list = customers;
    if (activeFilter === "active") list = list.filter((c) => c.active);
    if (activeFilter === "inactive") list = list.filter((c) => !c.active);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.display_name.toLowerCase().includes(q) ||
          (c.email ?? "").toLowerCase().includes(q) ||
          (c.phone ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [customers, activeFilter, search]);

  const sorted = useMemo(
    () => sortRows(filtered, tp.prefs.sort.key, tp.prefs.sort.dir, getSortValue),
    [filtered, tp.prefs.sort],
  );

  const activeCount = customers.filter((c) => c.active).length;
  const inactiveCount = customers.filter((c) => !c.active).length;

  const visibleCols = tp.prefs.visibleColumns
    .map((k) => ALL_COLUMNS.find((c) => c.key === k))
    .filter(Boolean) as typeof ALL_COLUMNS;

  return (
    <BackOfficeLayout title="Customers">
      <div className="space-y-6 animate-fade-in">
        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Total Customers</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{customers.length}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Active</CardTitle>
              <UserCheck className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{activeCount}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Inactive</CardTitle>
              <UserX className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{inactiveCount}</p></CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="Search name, email, phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-xs"
          />
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="sm:w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <div className="sm:ml-auto">
            <ColumnSelector
              allColumns={ALL_COLUMNS}
              visibleColumns={tp.prefs.visibleColumns}
              onToggleColumn={tp.toggleColumn}
              onMoveColumn={tp.moveColumn}
            />
          </div>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading…</div>
            ) : sorted.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No customers found. Run "Sync Customers" from Settings.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {visibleCols.map((col) => (
                      <SortableTableHead
                        key={col.key}
                        columnKey={col.key}
                        label={col.label}
                        sortKey={tp.prefs.sort.key}
                        sortDir={tp.prefs.sort.dir}
                        onToggleSort={tp.toggleSort}
                        align={col.align}
                      />
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((c) => (
                    <TableRow key={c.id}>
                      {visibleCols.map((col) => (
                        <TableCell key={col.key} className={(col as any).align === "center" ? "text-center" : (col as any).align === "right" ? "text-right" : ""}>
                          {renderCell(c, col.key)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </BackOfficeLayout>
  );
}

export default CustomersPage;
