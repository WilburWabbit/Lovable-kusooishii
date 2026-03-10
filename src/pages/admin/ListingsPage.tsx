import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table";
import { Layers, ShoppingBag, AlertTriangle, Clock, RefreshCw } from "lucide-react";
import { format, differenceInHours } from "date-fns";
import { useTablePreferences } from "@/hooks/useTablePreferences";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import { ColumnSelector } from "@/components/admin/ColumnSelector";
import { sortRows } from "@/lib/table-utils";
import { toast } from "sonner";

async function invokeWithAuth<T = unknown>(fnName: string, body?: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated – please log in again.");
  const { data, error } = await supabase.functions.invoke(fnName, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  return data as T;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface ChannelListing {
  id: string;
  sku_id: string;
  channel: string;
  external_sku: string;
  external_listing_id: string | null;
  offer_status: string | null;
  listed_price: number | null;
  listed_quantity: number | null;
  synced_at: string;
}

interface ListingRow {
  id: string;
  sku_code: string;
  name: string | null;
  condition_grade: string;
  price: number | null;
  catalog_product: { name: string; mpn: string } | null;
  stock_available: number;
  channel_listings: ChannelListing[];
}

const CHANNELS = ["ebay", "bricklink", "brickowl", "web"] as const;
type Channel = typeof CHANNELS[number];

const CHANNEL_LABELS: Record<Channel, string> = {
  ebay: "eBay",
  bricklink: "BrickLink",
  brickowl: "BrickOwl",
  web: "Web",
};

const GRADE_LABELS: Record<string, string> = {
  "1": "1 – Sealed",
  "2": "2 – Like New",
  "3": "3 – Good",
  "4": "4 – Fair",
  "5": "5 – Poor",
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fmt(v: number | null | undefined) {
  if (v == null) return "—";
  return `£${v.toFixed(2)}`;
}

function productName(r: ListingRow) {
  return r.catalog_product?.name ?? r.name ?? "";
}

function getChannelListing(r: ListingRow, ch: Channel): ChannelListing | undefined {
  return r.channel_listings.find((l) => l.channel === ch);
}

function latestSync(r: ListingRow): string | null {
  if (r.channel_listings.length === 0) return null;
  return r.channel_listings.reduce((latest, l) =>
    l.synced_at > latest ? l.synced_at : latest, r.channel_listings[0].synced_at);
}

function channelCount(rows: ListingRow[], ch: Channel) {
  return rows.filter((r) => r.channel_listings.some((l) => l.channel === ch)).length;
}

function isStale(syncedAt: string) {
  return differenceInHours(new Date(), new Date(syncedAt)) > 24;
}

/* ------------------------------------------------------------------ */
/* Channel cell                                                        */
/* ------------------------------------------------------------------ */

function ChannelCell({ listing }: { listing: ChannelListing | undefined }) {
  if (!listing) {
    return <span className="text-muted-foreground/40">—</span>;
  }
  const status = listing.offer_status?.toLowerCase() ?? "unknown";
  let badgeClass = "bg-muted text-muted-foreground";
  if (status === "live" || status === "active" || status === "published") {
    badgeClass = "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400";
  } else if (status === "draft") {
    badgeClass = "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
  } else if (status === "paused" || status === "ended" || status === "suppressed") {
    badgeClass = "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400";
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${badgeClass}`}>
        {listing.offer_status ?? "—"}
      </Badge>
      {listing.listed_price != null && (
        <span className="font-mono text-[10px] text-muted-foreground">{fmt(listing.listed_price)}</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Column definitions                                                  */
/* ------------------------------------------------------------------ */

const ALL_COLUMNS: { key: string; label: string; align?: "left" | "center" | "right" }[] = [
  { key: "sku_code", label: "SKU Code" },
  { key: "product", label: "Product" },
  { key: "mpn", label: "MPN" },
  { key: "grade", label: "Grade" },
  { key: "price", label: "Our Price", align: "right" },
  { key: "stock", label: "Stock", align: "right" },
  { key: "ebay", label: "eBay", align: "center" },
  { key: "bricklink", label: "BrickLink", align: "center" },
  { key: "brickowl", label: "BrickOwl", align: "center" },
  { key: "web", label: "Web", align: "center" },
  { key: "last_sync", label: "Last Sync" },
];

const DEFAULT_VISIBLE = ALL_COLUMNS.map((c) => c.key);

function getSortValue(r: ListingRow, key: string): unknown {
  switch (key) {
    case "sku_code": return r.sku_code;
    case "product": return productName(r);
    case "mpn": return r.catalog_product?.mpn ?? "";
    case "grade": return r.condition_grade;
    case "price": return r.price;
    case "stock": return r.stock_available;
    case "ebay": return getChannelListing(r, "ebay")?.offer_status ?? "";
    case "bricklink": return getChannelListing(r, "bricklink")?.offer_status ?? "";
    case "brickowl": return getChannelListing(r, "brickowl")?.offer_status ?? "";
    case "web": return getChannelListing(r, "web")?.offer_status ?? "";
    case "last_sync": return latestSync(r) ?? "";
    default: return null;
  }
}

function renderCell(r: ListingRow, key: string): React.ReactNode {
  switch (key) {
    case "sku_code": return <span className="font-mono text-xs">{r.sku_code}</span>;
    case "product": return <span className="max-w-[200px] truncate block">{productName(r) || "—"}</span>;
    case "mpn": return <span className="font-mono text-xs">{r.catalog_product?.mpn ?? "—"}</span>;
    case "grade": return GRADE_LABELS[r.condition_grade] ?? r.condition_grade;
    case "price": return <span className="font-mono text-xs">{fmt(r.price)}</span>;
    case "stock": return <span className="font-mono text-xs">{r.stock_available}</span>;
    case "ebay": return <ChannelCell listing={getChannelListing(r, "ebay")} />;
    case "bricklink": return <ChannelCell listing={getChannelListing(r, "bricklink")} />;
    case "brickowl": return <ChannelCell listing={getChannelListing(r, "brickowl")} />;
    case "web": return <ChannelCell listing={getChannelListing(r, "web")} />;
    case "last_sync": {
      const ls = latestSync(r);
      if (!ls) return <span className="text-muted-foreground/40">—</span>;
      const stale = isStale(ls);
      return (
        <span className={`text-xs ${stale ? "text-destructive" : "text-muted-foreground"}`}>
          {format(new Date(ls), "dd MMM HH:mm")}
        </span>
      );
    }
    default: return null;
  }
}

/* ------------------------------------------------------------------ */
/* Page Component                                                      */
/* ------------------------------------------------------------------ */

export function ListingsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [coverageFilter, setCoverageFilter] = useState<string>("all");
  const [syncing, setSyncing] = useState(false);

  const tp = useTablePreferences("admin-listings", DEFAULT_VISIBLE, { key: "sku_code", dir: "asc" });

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ["listings-coverage"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-data", {
        body: { action: "list-listings" },
      });
      if (error) throw error;
      return (data ?? []) as ListingRow[];
    },
    enabled: !!user,
  });

  /* Filters */
  const filtered = useMemo(() => {
    let list = rows;

    if (channelFilter !== "all") {
      list = list.filter((r) => r.channel_listings.some((l) => l.channel === channelFilter));
    }

    if (coverageFilter === "listed") {
      list = list.filter((r) => r.channel_listings.length > 0);
    } else if (coverageFilter === "unlisted") {
      list = list.filter((r) => r.channel_listings.length === 0);
    } else if (coverageFilter === "partial") {
      list = list.filter((r) => r.channel_listings.length > 0 && r.channel_listings.length < CHANNELS.length);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.sku_code.toLowerCase().includes(q) ||
          (r.catalog_product?.mpn ?? "").toLowerCase().includes(q) ||
          productName(r).toLowerCase().includes(q),
      );
    }
    return list;
  }, [rows, channelFilter, coverageFilter, search]);

  const sorted = useMemo(
    () => sortRows(filtered, tp.prefs.sort.key, tp.prefs.sort.dir, getSortValue),
    [filtered, tp.prefs.sort],
  );

  /* Summary stats */
  const totalSkus = rows.length;
  const ebayCount = channelCount(rows, "ebay");
  const unlistedCount = rows.filter((r) => r.channel_listings.length === 0 && r.stock_available > 0).length;
  const staleCount = rows.filter((r) => {
    const ls = latestSync(r);
    return ls != null && isStale(ls);
  }).length;

  /* Sync eBay */
  const handleSyncEbay = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke("ebay-sync", {
        body: { action: "sync_inventory" },
      });
      if (error) throw error;
      toast.success("eBay sync triggered");
      refetch();
    } catch (err: any) {
      toast.error(err.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const visibleCols = tp.prefs.visibleColumns
    .map((k) => ALL_COLUMNS.find((c) => c.key === k)!)
    .filter(Boolean);

  return (
    <BackOfficeLayout title="Listings">
      <div className="space-y-6 animate-fade-in">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Active SKUs</CardTitle>
              <Layers className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{totalSkus}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Listed on eBay</CardTitle>
              <ShoppingBag className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{ebayCount}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Unlisted (in stock)</CardTitle>
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{unlistedCount}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Stale Syncs (&gt;24h)</CardTitle>
              <Clock className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{staleCount}</p></CardContent>
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
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="sm:w-40"><SelectValue placeholder="Channel" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              {CHANNELS.map((ch) => (
                <SelectItem key={ch} value={ch}>{CHANNEL_LABELS[ch]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={coverageFilter} onValueChange={setCoverageFilter}>
            <SelectTrigger className="sm:w-40"><SelectValue placeholder="Coverage" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All coverage</SelectItem>
              <SelectItem value="listed">Listed</SelectItem>
              <SelectItem value="unlisted">Unlisted</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
            </SelectContent>
          </Select>
          <div className="sm:ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={handleSyncEbay} disabled={syncing}>
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Sync eBay</span>
            </Button>
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
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No listings found.</div>
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
                  {sorted.map((r) => (
                    <TableRow key={r.id}>
                      {visibleCols.map((col) => (
                        <TableCell key={col.key} className={col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}>
                          {renderCell(r, col.key)}
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

export default ListingsPage;
