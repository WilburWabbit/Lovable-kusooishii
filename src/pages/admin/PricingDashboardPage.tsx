import { useEffect, useState } from "react";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { supabase } from "@/integrations/supabase/client";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import { ColumnSelector } from "@/components/admin/ColumnSelector";
import { useTablePreferences } from "@/hooks/useTablePreferences";
import { sortRows } from "@/lib/table-utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingDown, Gauge, Hash, Play, Loader2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface PricingRow {
  id: string;
  sku_code: string;
  condition_grade: string;
  product_name: string;
  mpn: string;
  stock_qty: number;
  price: number | null;
  price_floor: number | null;
  price_target: number | null;
  price_ceiling: number | null;
  confidence_score: number | null;
  priced_at: string | null;
}

const ALL_COLUMNS = [
  { key: "product_name", label: "Product" },
  { key: "mpn", label: "MPN" },
  { key: "sku_code", label: "SKU" },
  { key: "condition_grade", label: "Grade" },
  { key: "stock_qty", label: "Stock" },
  { key: "price", label: "Price £" },
  { key: "price_floor", label: "Floor £" },
  { key: "price_target", label: "Target £" },
  { key: "price_ceiling", label: "Ceiling £" },
  { key: "confidence_score", label: "Confidence" },
  { key: "priced_at", label: "Priced At" },
];

const DEFAULT_VISIBLE = ALL_COLUMNS.map((c) => c.key);

function fmt(v: number | null) {
  return v != null ? `£${v.toFixed(2)}` : "—";
}

export default function PricingDashboardPage() {
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("in_stock");
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const { toast } = useToast();

  const { prefs, toggleSort, toggleColumn, moveColumn } = useTablePreferences(
    "admin-pricing",
    DEFAULT_VISIBLE,
    { key: "product_name", dir: "asc" },
  );

  const loadData = async () => {
    setLoading(true);

    // Fetch SKUs with product details
    const { data: skuData, error: skuError } = await supabase
      .from("sku")
      .select("id, sku_code, condition_grade, price, product:product_id(name, mpn)")
      .eq("active_flag", true)
      .order("sku_code");

    if (skuError) {
      console.error(skuError);
      setLoading(false);
      return;
    }

    // Fetch stock counts per SKU
    const { data: stockData } = await supabase
      .from("stock_unit")
      .select("sku_id")
      .eq("status", "available");

    const stockMap = new Map<string, number>();
    for (const su of stockData ?? []) {
      stockMap.set(su.sku_id, (stockMap.get(su.sku_id) ?? 0) + 1);
    }

    // Fetch best pricing from channel_listing per SKU (latest priced_at wins)
    const { data: listingData } = await supabase
      .from("channel_listing")
      .select("sku_id, price_floor, price_target, price_ceiling, confidence_score, priced_at")
      .not("sku_id", "is", null)
      .not("priced_at", "is", null)
      .order("priced_at", { ascending: false });

    // Build pricing map: first occurrence per sku_id wins (latest priced_at due to ordering)
    const pricingMap = new Map<string, {
      price_floor: number | null;
      price_target: number | null;
      price_ceiling: number | null;
      confidence_score: number | null;
      priced_at: string | null;
    }>();
    for (const cl of listingData ?? []) {
      if (cl.sku_id && !pricingMap.has(cl.sku_id)) {
        pricingMap.set(cl.sku_id, {
          price_floor: cl.price_floor,
          price_target: cl.price_target,
          price_ceiling: cl.price_ceiling,
          confidence_score: cl.confidence_score,
          priced_at: cl.priced_at,
        });
      }
    }

    const mapped: PricingRow[] = (skuData ?? []).map((r: any) => {
      const pricing = pricingMap.get(r.id);
      return {
        id: r.id,
        sku_code: r.sku_code,
        condition_grade: r.condition_grade ?? "—",
        product_name: r.product?.name ?? r.name ?? "—",
        mpn: r.product?.mpn ?? "—",
        stock_qty: stockMap.get(r.id) ?? 0,
        price: r.price,
        price_floor: pricing?.price_floor ?? null,
        price_target: pricing?.price_target ?? null,
        price_ceiling: pricing?.price_ceiling ?? null,
        confidence_score: pricing?.confidence_score ?? null,
        priced_at: pricing?.priced_at ?? null,
      };
    });

    setRows(mapped);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleRunAllPricing = async () => {
    setBatchRunning(true);
    setBatchProgress({ done: 0, total: 0 });
    try {
      const batch = await invokeWithAuth<{ listings: { listing_id: string; sku_id: string; channel: string }[]; total: number }>("admin-data", {
        action: "batch-calculate-pricing",
      });
      const listings = batch.listings ?? [];
      setBatchProgress({ done: 0, total: listings.length });

      let completed = 0;
      let errors = 0;
      for (const item of listings) {
        try {
          const result = await invokeWithAuth<any>("admin-data", {
            action: "calculate-pricing",
            sku_id: item.sku_id,
            channel: item.channel,
          });
          await invokeWithAuth("admin-data", {
            action: "update-listing-prices",
            listing_id: item.listing_id,
            price_floor: result.floor_price,
            price_target: result.target_price,
            price_ceiling: result.ceiling_price,
            confidence_score: result.confidence_score,
            auto_price: true,
          });
        } catch {
          errors++;
        }
        completed++;
        setBatchProgress({ done: completed, total: listings.length });
      }

      toast({
        title: "Batch pricing complete",
        description: `${completed - errors} of ${listings.length} priced successfully${errors > 0 ? `, ${errors} errors` : ""}`,
      });
      await loadData();
    } catch (err: any) {
      toast({ title: "Batch pricing failed", description: err.message, variant: "destructive" });
    } finally {
      setBatchRunning(false);
    }
  };

  // Filter
  const q = search.toLowerCase();
  let filtered = rows.filter((r) => {
    if (stockFilter === "in_stock" && r.stock_qty === 0) return false;
    if (stockFilter === "out_of_stock" && r.stock_qty > 0) return false;
    if (q && !r.product_name.toLowerCase().includes(q) && !r.mpn.toLowerCase().includes(q) && !r.sku_code.toLowerCase().includes(q)) return false;
    return true;
  });

  // Sort
  const sorted = sortRows(filtered, prefs.sort.key, prefs.sort.dir, (row, key) => (row as any)[key]);

  // Stats
  const pricedCount = filtered.filter((r) => r.price_floor != null).length;
  const unpricedCount = filtered.filter((r) => r.price_floor == null).length;
  const confidenceValues = filtered.filter((r) => r.confidence_score != null).map((r) => r.confidence_score!);
  const avgConfidence = confidenceValues.length > 0 ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length : 0;
  const totalStock = filtered.reduce((sum, r) => sum + r.stock_qty, 0);

  const RIGHT_ALIGNED = ["stock_qty", "price", "price_floor", "price_target", "price_ceiling", "confidence_score"];

  return (
    <BackOfficeLayout title="Pricing Dashboard">
      <div className="space-y-6 p-6">
        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Hash className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Priced SKUs</p>
                <p className="text-2xl font-bold">{pricedCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className={unpricedCount > 0 ? "border-warning/50" : ""}>
            <CardContent className="flex items-center gap-3 p-4">
              <TrendingDown className={`h-5 w-5 ${unpricedCount > 0 ? "text-warning" : "text-muted-foreground"}`} />
              <div>
                <p className="text-xs text-muted-foreground">Unpriced</p>
                <p className="text-2xl font-bold">{unpricedCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Gauge className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Avg Confidence</p>
                <p className="text-2xl font-bold">{avgConfidence > 0 ? `${(avgConfidence * 100).toFixed(0)}%` : "—"}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Package className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Total Stock</p>
                <p className="text-2xl font-bold">{totalStock}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Batch Run */}
        {batchRunning && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Pricing {batchProgress.done} of {batchProgress.total}…</span>
              <span>{batchProgress.total > 0 ? Math.round((batchProgress.done / batchProgress.total) * 100) : 0}%</span>
            </div>
            <Progress value={batchProgress.total > 0 ? (batchProgress.done / batchProgress.total) * 100 : 0} className="h-2" />
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <Button size="sm" onClick={handleRunAllPricing} disabled={batchRunning || loading}>
            {batchRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
            Run All Pricing
          </Button>
          <div className="flex-1 min-w-[200px]">
            <Input placeholder="Search product, MPN or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9" />
          </div>
          <Select value={stockFilter} onValueChange={setStockFilter}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="in_stock">In Stock</SelectItem>
              <SelectItem value="out_of_stock">Out of Stock</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <ColumnSelector allColumns={ALL_COLUMNS} visibleColumns={prefs.visibleColumns} onToggleColumn={toggleColumn} onMoveColumn={moveColumn} />
        </div>

        {/* Table */}
        <Card>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {prefs.visibleColumns.map((key) => {
                    const col = ALL_COLUMNS.find((c) => c.key === key);
                    if (!col) return null;
                    const align = RIGHT_ALIGNED.includes(key) ? "right" as const : "left" as const;
                    return (
                      <SortableTableHead
                        key={key}
                        columnKey={key}
                        label={col.label}
                        sortKey={prefs.sort.key}
                        sortDir={prefs.sort.dir}
                        onToggleSort={toggleSort}
                        align={align}
                      />
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {prefs.visibleColumns.map((c) => (
                        <TableCell key={c}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : sorted.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={prefs.visibleColumns.length} className="text-center text-muted-foreground py-12">
                      No pricing data found.
                    </TableCell>
                  </TableRow>
                ) : (
                  sorted.map((row) => (
                    <TableRow key={row.id}>
                      {prefs.visibleColumns.map((key) => {
                        let content: React.ReactNode;
                        switch (key) {
                          case "product_name":
                            content = <span className="font-medium">{row.product_name}</span>;
                            break;
                          case "mpn":
                            content = <span className="font-mono text-xs">{row.mpn}</span>;
                            break;
                          case "sku_code":
                            content = <span className="font-mono text-xs">{row.sku_code}</span>;
                            break;
                          case "condition_grade":
                            content = <Badge variant="outline" className="text-[10px]">{row.condition_grade}</Badge>;
                            break;
                          case "stock_qty":
                            content = (
                              <span className={row.stock_qty === 0 ? "text-muted-foreground" : "font-medium"}>
                                {row.stock_qty}
                              </span>
                            );
                            break;
                          case "price":
                            content = fmt(row.price);
                            break;
                          case "price_floor":
                            content = fmt(row.price_floor);
                            break;
                          case "price_target":
                            content = fmt(row.price_target);
                            break;
                          case "price_ceiling":
                            content = fmt(row.price_ceiling);
                            break;
                          case "confidence_score":
                            content = row.confidence_score != null ? `${(row.confidence_score * 100).toFixed(0)}%` : "—";
                            break;
                          case "priced_at":
                            content = row.priced_at ? format(new Date(row.priced_at), "dd MMM yy HH:mm") : "—";
                            break;
                          default:
                            content = "—";
                        }
                        const align = RIGHT_ALIGNED.includes(key) ? "text-right" : "";
                        return <TableCell key={key} className={align}>{content}</TableCell>;
                      })}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </BackOfficeLayout>
  );
}
