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
import { AlertTriangle, TrendingDown, Gauge, Hash, Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const CHANNELS = ["ebay", "bricklink", "brickowl", "web"] as const;

interface PricingRow {
  id: string;
  channel: string;
  listed_price: number | null;
  price_floor: number | null;
  price_target: number | null;
  price_ceiling: number | null;
  confidence_score: number | null;
  priced_at: string | null;
  offer_status: string | null;
  sku_code: string;
  condition_grade: string;
  product_name: string;
  mpn: string;
}

const ALL_COLUMNS = [
  { key: "product_name", label: "Product" },
  { key: "mpn", label: "MPN" },
  { key: "sku_code", label: "SKU" },
  { key: "condition_grade", label: "Grade" },
  { key: "channel", label: "Channel" },
  { key: "offer_status", label: "Status" },
  { key: "listed_price", label: "Listed £" },
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

interface ChannelConfig {
  channel: string;
  auto_price_enabled: boolean;
}

export default function PricingDashboardPage() {
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [belowFloorOnly, setBelowFloorOnly] = useState(false);
  const [autoPriceConfigs, setAutoPriceConfigs] = useState<ChannelConfig[]>([]);
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
    const { data, error } = await supabase
      .from("channel_listing")
      .select("id, channel, listed_price, price_floor, price_target, price_ceiling, confidence_score, priced_at, offer_status, sku:sku_id(sku_code, condition_grade, product:product_id(name, mpn))")
      .order("channel");

    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }

    const mapped: PricingRow[] = (data ?? []).map((r: any) => ({
      id: r.id,
      channel: r.channel,
      listed_price: r.listed_price,
      price_floor: r.price_floor,
      price_target: r.price_target,
      price_ceiling: r.price_ceiling,
      confidence_score: r.confidence_score,
      priced_at: r.priced_at,
      offer_status: r.offer_status,
      sku_code: r.sku?.sku_code ?? "—",
      condition_grade: r.sku?.condition_grade ?? "—",
      product_name: r.sku?.product?.name ?? "—",
      mpn: r.sku?.product?.mpn ?? "—",
    }));
    setRows(mapped);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    invokeWithAuth<ChannelConfig[]>("admin-data", { action: "list-channel-pricing-config" })
      .then((data) => setAutoPriceConfigs(data))
      .catch(() => {});
  }, []);

  const handleRunAllPricing = async () => {
    setBatchRunning(true);
    setBatchProgress({ done: 0, total: 0 });
    try {
      // Get all listings to price
      const batch = await invokeWithAuth<{ listings: { listing_id: string; sku_id: string; channel: string }[]; total: number }>("admin-data", {
        action: "batch-calculate-pricing",
        channel: channelFilter !== "all" ? channelFilter : undefined,
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
          // Persist prices with auto_price
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
    if (channelFilter !== "all" && r.channel !== channelFilter) return false;
    if (q && !r.product_name.toLowerCase().includes(q) && !r.mpn.toLowerCase().includes(q) && !r.sku_code.toLowerCase().includes(q)) return false;
    if (belowFloorOnly && !(r.listed_price != null && r.price_floor != null && r.listed_price < r.price_floor)) return false;
    return true;
  });

  // Sort
  const sorted = sortRows(filtered, prefs.sort.key, prefs.sort.dir, (row, key) => (row as any)[key]);

  // Stats
  const pricedCount = filtered.filter((r) => r.price_floor != null).length;
  const belowFloorCount = filtered.filter((r) => r.listed_price != null && r.price_floor != null && r.listed_price < r.price_floor).length;
  const confidenceValues = filtered.filter((r) => r.confidence_score != null).map((r) => r.confidence_score!);
  const avgConfidence = confidenceValues.length > 0 ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length : 0;

  const isBelowFloor = (r: PricingRow) => r.listed_price != null && r.price_floor != null && r.listed_price < r.price_floor;

  return (
    <BackOfficeLayout title="Pricing Dashboard">
      <div className="space-y-6 p-6">
        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Hash className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Priced SKU-Channels</p>
                <p className="text-2xl font-bold">{pricedCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className={belowFloorCount > 0 ? "border-destructive/50" : ""}>
            <CardContent className="flex items-center gap-3 p-4">
              <TrendingDown className={`h-5 w-5 ${belowFloorCount > 0 ? "text-destructive" : "text-muted-foreground"}`} />
              <div>
                <p className="text-xs text-muted-foreground">Below Floor</p>
                <p className={`text-2xl font-bold ${belowFloorCount > 0 ? "text-destructive" : ""}`}>{belowFloorCount}</p>
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
            Run All Pricing{channelFilter !== "all" ? ` (${channelFilter})` : ""}
          </Button>
          <div className="flex-1 min-w-[200px]">
            <Input placeholder="Search product, MPN or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9" />
          </div>
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Channels</SelectItem>
              {CHANNELS.map((ch) => (
                <SelectItem key={ch} value={ch}>{ch}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Switch id="below-floor" checked={belowFloorOnly} onCheckedChange={setBelowFloorOnly} />
            <Label htmlFor="below-floor" className="text-xs whitespace-nowrap">Below floor only</Label>
          </div>
          <ColumnSelector allColumns={ALL_COLUMNS} visibleColumns={prefs.visibleColumns} onToggleColumn={toggleColumn} onMoveColumn={moveColumn} />
          <div className="flex items-center gap-1.5 ml-auto">
            {autoPriceConfigs.map((c) => (
              <Badge key={c.channel} variant={c.auto_price_enabled ? "default" : "outline"} className="text-[10px] capitalize">
                {c.channel} {c.auto_price_enabled ? "Auto" : "Manual"}
              </Badge>
            ))}
          </div>
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
                    const align = ["listed_price", "price_floor", "price_target", "price_ceiling", "confidence_score"].includes(key) ? "right" as const : "left" as const;
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
                  sorted.map((row) => {
                    const below = isBelowFloor(row);
                    return (
                      <TableRow key={row.id} className={below ? "bg-destructive/10" : ""}>
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
                            case "channel":
                              content = <Badge variant="secondary" className="text-[10px] capitalize">{row.channel}</Badge>;
                              break;
                            case "offer_status":
                              content = row.offer_status ? <Badge variant="outline" className="text-[10px]">{row.offer_status}</Badge> : "—";
                              break;
                            case "listed_price":
                              content = (
                                <span className={below ? "font-semibold text-destructive" : ""}>
                                  {fmt(row.listed_price)}
                                  {below && <AlertTriangle className="ml-1 inline h-3 w-3 text-destructive" />}
                                </span>
                              );
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
                          const align = ["listed_price", "price_floor", "price_target", "price_ceiling", "confidence_score"].includes(key) ? "text-right" : "";
                          return <TableCell key={key} className={align}>{content}</TableCell>;
                        })}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </BackOfficeLayout>
  );
}
