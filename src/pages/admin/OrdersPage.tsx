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
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ShoppingCart, PoundSterling, ArrowUpRight, ArrowDownLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { useTablePreferences } from "@/hooks/useTablePreferences";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import { ColumnSelector } from "@/components/admin/ColumnSelector";
import { sortRows } from "@/lib/table-utils";

type OrderLineRow = {
  id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  vat_rate_percent: number | null;
  sku: {
    sku_code: string;
    name: string | null;
    catalog_product: { name: string } | null;
  } | null;
};

type OrderRow = {
  id: string;
  order_number: string;
  origin_channel: string;
  origin_reference: string | null;
  status: string;
  merchandise_subtotal: number;
  tax_total: number;
  gross_total: number;
  currency: string;
  guest_name: string | null;
  guest_email: string | null;
  created_at: string;
  notes: string | null;
  customer: { id: string; display_name: string; email: string | null } | null;
  sales_order_line: OrderLineRow[];
};

const ORIGIN_COLORS: Record<string, string> = {
  web: "bg-blue-100 text-blue-800",
  qbo: "bg-emerald-100 text-emerald-800",
  qbo_refund: "bg-red-100 text-red-800",
};

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "bg-yellow-100 text-yellow-800",
  authorised: "bg-blue-100 text-blue-800",
  paid: "bg-emerald-100 text-emerald-800",
  complete: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-muted text-muted-foreground",
  refunded: "bg-red-100 text-red-800",
  exception: "bg-destructive/10 text-destructive",
};

const STATUS_OPTIONS = [
  "pending_payment", "authorised", "paid", "picking", "packed",
  "awaiting_dispatch", "shipped", "complete", "cancelled",
  "partially_refunded", "refunded", "exception",
];

function fmt(v: number | null | undefined) {
  if (v == null) return "—";
  return `£${v.toFixed(2)}`;
}

function lineVatAmount(l: OrderLineRow) {
  if (l.vat_rate_percent == null) return null;
  return Math.round(l.line_total * (l.vat_rate_percent / 100) * 100) / 100;
}

const ALL_COLUMNS: { key: string; label: string; align?: "left" | "center" | "right" }[] = [
  { key: "_expand", label: "", align: "left" as const },
  { key: "order_number", label: "Order #" },
  { key: "customer_name", label: "Customer" },
  { key: "origin_channel", label: "Origin" },
  { key: "origin_reference", label: "Reference" },
  { key: "status", label: "Status" },
  { key: "items", label: "Items", align: "center" as const },
  { key: "net", label: "Net", align: "right" as const },
  { key: "vat", label: "VAT", align: "right" as const },
  { key: "total", label: "Total", align: "right" as const },
  { key: "created_at", label: "Date" },
];

const DEFAULT_VISIBLE = ALL_COLUMNS.map((c) => c.key);

function getSortValue(o: OrderRow, key: string): unknown {
  switch (key) {
    case "order_number": return o.order_number;
    case "origin_channel": return o.origin_channel;
    case "origin_reference": return o.origin_reference;
    case "status": return o.status;
    case "items": return o.sales_order_line.length;
    case "net": return o.merchandise_subtotal;
    case "vat": return o.tax_total;
    case "total": return o.gross_total;
    case "created_at": return o.created_at;
    default: return null;
  }
}

function renderCell(o: OrderRow, key: string, expandedId: string | null): React.ReactNode {
  switch (key) {
    case "_expand":
      return <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expandedId === o.id ? "rotate-90" : ""}`} />;
    case "order_number":
      return <span className="font-mono text-xs font-medium">{o.order_number}</span>;
    case "origin_channel":
      return <Badge variant="outline" className={ORIGIN_COLORS[o.origin_channel] ?? ""}>{o.origin_channel.replace(/_/g, " ")}</Badge>;
    case "origin_reference":
      return <span className="font-mono text-xs">{o.origin_reference ?? "—"}</span>;
    case "status":
      return <Badge variant="outline" className={STATUS_COLORS[o.status] ?? ""}>{o.status.replace(/_/g, " ")}</Badge>;
    case "items":
      return o.sales_order_line.length;
    case "net":
      return <span className="font-mono text-xs">{fmt(o.merchandise_subtotal)}</span>;
    case "vat":
      return <span className="font-mono text-xs">{fmt(o.tax_total)}</span>;
    case "total":
      return <span className="font-mono text-xs">{fmt(o.gross_total)}</span>;
    case "created_at":
      return <span className="text-xs text-muted-foreground">{format(new Date(o.created_at), "dd MMM yyyy")}</span>;
    default: return null;
  }
}

export function OrdersPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const tp = useTablePreferences("admin-orders", DEFAULT_VISIBLE, { key: "created_at", dir: "desc" });

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-data", {
        body: { action: "list-orders" },
      });
      if (error) throw error;
      return (data ?? []) as unknown as OrderRow[];
    },
    enabled: !!user,
  });

  const filtered = useMemo(() => {
    let list = orders;
    if (channelFilter !== "all") list = list.filter((o) => o.origin_channel === channelFilter);
    if (statusFilter !== "all") list = list.filter((o) => o.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (o) =>
          o.order_number.toLowerCase().includes(q) ||
          (o.origin_reference ?? "").toLowerCase().includes(q) ||
          (o.guest_name ?? "").toLowerCase().includes(q) ||
          (o.guest_email ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [orders, channelFilter, statusFilter, search]);

  const sorted = useMemo(
    () => sortRows(filtered, tp.prefs.sort.key, tp.prefs.sort.dir, getSortValue),
    [filtered, tp.prefs.sort],
  );

  const totalRevenue = useMemo(
    () => orders.filter((o) => o.origin_channel !== "qbo_refund").reduce((s, o) => s + o.gross_total, 0),
    [orders],
  );
  const salesCount = orders.filter((o) => o.origin_channel !== "qbo_refund").length;
  const refundCount = orders.filter((o) => o.origin_channel === "qbo_refund").length;

  const visibleCols = tp.prefs.visibleColumns
    .map((k) => ALL_COLUMNS.find((c) => c.key === k))
    .filter(Boolean) as typeof ALL_COLUMNS;

  return (
    <BackOfficeLayout title="Orders">
      <div className="space-y-6 animate-fade-in">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Total Orders</CardTitle>
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{orders.length}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Total Revenue</CardTitle>
              <PoundSterling className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{fmt(totalRevenue)}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Sales</CardTitle>
              <ArrowUpRight className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{salesCount}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Refunds</CardTitle>
              <ArrowDownLeft className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{refundCount}</p></CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="Search order #, reference, customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-xs"
          />
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="sm:w-44"><SelectValue placeholder="Channel" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              <SelectItem value="web">Web</SelectItem>
              <SelectItem value="qbo">QBO Sale</SelectItem>
              <SelectItem value="qbo_refund">QBO Refund</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="sm:ml-auto">
            <ColumnSelector
              allColumns={ALL_COLUMNS.filter((c) => c.key !== "_expand")}
              visibleColumns={tp.prefs.visibleColumns.filter((k) => k !== "_expand")}
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
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No orders found.</div>
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
                        sortable={col.key !== "_expand"}
                        className={col.key === "_expand" ? "w-8" : ""}
                      />
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((o) => (
                    <Collapsible key={o.id} open={expandedId === o.id} onOpenChange={(open) => setExpandedId(open ? o.id : null)} asChild>
                      <>
                        <CollapsibleTrigger asChild>
                          <TableRow className="cursor-pointer">
                            {visibleCols.map((col) => (
                              <TableCell key={col.key} className={`${col.key === "_expand" ? "w-8 px-2" : ""} ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}`}>
                                {renderCell(o, col.key, expandedId)}
                              </TableCell>
                            ))}
                          </TableRow>
                        </CollapsibleTrigger>
                        <CollapsibleContent asChild>
                          <tr>
                            <td colSpan={visibleCols.length} className="bg-muted/30 p-0">
                              <div className="px-8 py-3">
                                {o.guest_name || o.guest_email ? (
                                  <p className="text-xs text-muted-foreground mb-2">
                                    Customer: {o.guest_name}{o.guest_email ? ` (${o.guest_email})` : ""}
                                  </p>
                                ) : null}
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <SortableTableHead columnKey="" label="SKU" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" />
                                      <SortableTableHead columnKey="" label="Product" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" />
                                      <SortableTableHead columnKey="" label="Qty" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" align="center" />
                                      <SortableTableHead columnKey="" label="Unit (net)" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" align="right" />
                                      <SortableTableHead columnKey="" label="Line (net)" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" align="right" />
                                      <SortableTableHead columnKey="" label="VAT %" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" align="right" />
                                      <SortableTableHead columnKey="" label="VAT" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" align="right" />
                                      <SortableTableHead columnKey="" label="Line (inc VAT)" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" align="right" />
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {o.sales_order_line.map((l) => {
                                      const vat = lineVatAmount(l);
                                      const gross = vat != null ? l.line_total + vat : null;
                                      return (
                                        <TableRow key={l.id}>
                                          <TableCell className="font-mono text-xs">{l.sku?.sku_code ?? "—"}</TableCell>
                                          <TableCell className="text-xs max-w-[200px] truncate">{l.sku?.catalog_product?.name ?? l.sku?.name ?? "—"}</TableCell>
                                          <TableCell className="text-xs text-center">{l.quantity}</TableCell>
                                          <TableCell className="text-xs text-right font-mono">{fmt(l.unit_price)}</TableCell>
                                          <TableCell className="text-xs text-right font-mono">{fmt(l.line_total)}</TableCell>
                                          <TableCell className="text-xs text-right">{l.vat_rate_percent != null ? `${l.vat_rate_percent}%` : "—"}</TableCell>
                                          <TableCell className="text-xs text-right font-mono">{vat != null ? fmt(vat) : "—"}</TableCell>
                                          <TableCell className="text-xs text-right font-mono">{gross != null ? fmt(gross) : "—"}</TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                              </div>
                            </td>
                          </tr>
                        </CollapsibleContent>
                      </>
                    </Collapsible>
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

export default OrdersPage;
