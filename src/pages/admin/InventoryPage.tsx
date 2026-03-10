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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Package, PoundSterling, BoxesIcon, ShieldCheck } from "lucide-react";
import { format } from "date-fns";

type StockRow = {
  id: string;
  mpn: string;
  condition_grade: string;
  status: string;
  landed_cost: number | null;
  carrying_value: number | null;
  accumulated_impairment: number;
  created_at: string;
  vat_rate_percent: number | null;
  sku: {
    sku_code: string;
    name: string | null;
    catalog_product: { name: string } | null;
  } | null;
};

const STATUS_COLORS: Record<string, string> = {
  received: "bg-blue-100 text-blue-800",
  available: "bg-emerald-100 text-emerald-800",
  reserved: "bg-yellow-100 text-yellow-800",
  allocated: "bg-orange-100 text-orange-800",
  shipped: "bg-muted text-muted-foreground",
  delivered: "bg-muted text-muted-foreground",
  scrap: "bg-destructive/10 text-destructive",
  written_off: "bg-destructive/10 text-destructive",
};

const GRADE_LABELS: Record<string, string> = {
  "1": "1 – Sealed",
  "2": "2 – Like New",
  "3": "3 – Good",
  "4": "4 – Fair",
  "5": "5 – Poor",
};

const STATUS_OPTIONS = [
  "received", "available", "reserved", "allocated", "picked", "packed",
  "shipped", "delivered", "returned", "scrap", "part_out", "written_off", "closed",
];

function fmt(v: number | null | undefined) {
  if (v == null) return "—";
  return `£${v.toFixed(2)}`;
}

function vatAmount(landed: number | null, rate: number | null) {
  if (landed == null || rate == null) return null;
  return Math.round(landed * (rate / 100) * 100) / 100;
}

export function InventoryPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [gradeFilter, setGradeFilter] = useState<string>("all");

  const { data: units = [], isLoading } = useQuery({
    queryKey: ["stock-units"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-data", {
        body: { action: "list-stock-units" },
      });
      if (error) throw error;
      return (data ?? []) as unknown as StockRow[];
    },
    enabled: !!user,
  });

  const filtered = useMemo(() => {
    let list = units;
    if (statusFilter !== "all") list = list.filter((u) => u.status === statusFilter);
    if (gradeFilter !== "all") list = list.filter((u) => u.condition_grade === gradeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      const productName = (u: StockRow) => u.sku?.catalog_product?.name ?? u.sku?.name ?? "";
      list = list.filter(
        (u) =>
          u.mpn.toLowerCase().includes(q) ||
          u.sku?.sku_code.toLowerCase().includes(q) ||
          productName(u).toLowerCase().includes(q),
      );
    }
    return list;
  }, [units, statusFilter, gradeFilter, search]);

  const totalValue = useMemo(
    () => units.reduce((s, u) => s + (u.carrying_value ?? 0), 0),
    [units],
  );
  const countByStatus = (st: string) => units.filter((u) => u.status === st).length;

  return (
    <BackOfficeLayout title="Inventory">
      <div className="space-y-6 animate-fade-in">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Total Units</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{units.length}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Carrying Value</CardTitle>
              <PoundSterling className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{fmt(totalValue)}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Available</CardTitle>
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{countByStatus("available")}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Received</CardTitle>
              <BoxesIcon className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{countByStatus("received")}</p></CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="Search MPN, SKU, or product…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-xs"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={gradeFilter} onValueChange={setGradeFilter}>
            <SelectTrigger className="sm:w-44"><SelectValue placeholder="Grade" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All grades</SelectItem>
              {["1", "2", "3", "4", "5"].map((g) => (
                <SelectItem key={g} value={g}>{GRADE_LABELS[g]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No stock units found.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU Code</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>MPN</TableHead>
                    <TableHead>Grade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Landed (net)</TableHead>
                    <TableHead className="text-right">VAT %</TableHead>
                    <TableHead className="text-right">VAT</TableHead>
                    <TableHead className="text-right">Landed (inc VAT)</TableHead>
                    <TableHead className="text-right">Carrying</TableHead>
                    <TableHead className="text-right">Impairment</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((u) => {
                    const vat = vatAmount(u.landed_cost, u.vat_rate_percent);
                    const gross = vat != null && u.landed_cost != null ? u.landed_cost + vat : null;
                    return (
                      <TableRow key={u.id}>
                        <TableCell className="font-mono text-xs">{u.sku?.sku_code ?? "—"}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{u.sku?.catalog_product?.name ?? u.sku?.name ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{u.mpn}</TableCell>
                        <TableCell>{GRADE_LABELS[u.condition_grade] ?? u.condition_grade}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_COLORS[u.status] ?? ""}>
                            {u.status.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{fmt(u.landed_cost)}</TableCell>
                        <TableCell className="text-right text-xs">{u.vat_rate_percent != null ? `${u.vat_rate_percent}%` : "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{vat != null ? fmt(vat) : "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{gross != null ? fmt(gross) : "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{fmt(u.carrying_value)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{fmt(u.accumulated_impairment)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{format(new Date(u.created_at), "dd MMM yyyy")}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </BackOfficeLayout>
  );
}

export default InventoryPage;
