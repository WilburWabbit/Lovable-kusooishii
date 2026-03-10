import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
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
import {
  Box, ChevronRight, Package, PoundSterling, ShoppingBag, FileText,
  CheckCircle2, Circle,
} from "lucide-react";
import { useTablePreferences } from "@/hooks/useTablePreferences";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import { ColumnSelector } from "@/components/admin/ColumnSelector";
import { sortRows } from "@/lib/table-utils";
import { invokeWithAuth } from "@/lib/invokeWithAuth";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface ChannelListing {
  id: string;
  sku_id: string;
  channel: string;
  external_sku: string;
  offer_status: string | null;
  listed_price: number | null;
  listing_title: string | null;
  listing_description: string | null;
  synced_at: string;
}

interface ProductSku {
  id: string;
  sku_code: string;
  condition_grade: string;
  price: number | null;
  active_flag: boolean;
  stock_available: number;
  carrying_value: number;
  channel_listings: ChannelListing[];
}

interface ProductRow {
  id: string;
  mpn: string;
  name: string | null;
  theme_name: string | null;
  subtheme_name: string | null;
  piece_count: number | null;
  release_year: number | null;
  retired_flag: boolean;
  img_url: string | null;
  product_hook: string | null;
  description: string | null;
  highlights: string | null;
  call_to_action: string | null;
  seo_title: string | null;
  seo_description: string | null;
  stock_available: number;
  carrying_value: number;
  units_sold: number;
  revenue: number;
  skus: ProductSku[];
  channel_listings: ChannelListing[];
}

const CHANNELS = ["ebay", "bricklink", "brickowl", "web"] as const;
type Channel = (typeof CHANNELS)[number];

const CHANNEL_LABELS: Record<Channel, string> = {
  ebay: "eBay",
  bricklink: "BrickLink",
  brickowl: "BrickOwl",
  web: "Web",
};

const GRADE_LABELS: Record<string, string> = {
  "1": "Sealed",
  "2": "Like New",
  "3": "Good",
  "4": "Fair",
  "5": "Poor",
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fmt(v: number | null | undefined) {
  if (v == null) return "—";
  return `£${v.toFixed(2)}`;
}

function hasContent(p: ProductRow) {
  return !!(p.product_hook || p.description || p.highlights);
}

const CONTENT_FIELDS = [
  { key: "product_hook", label: "Hook" },
  { key: "description", label: "Description" },
  { key: "highlights", label: "Highlights" },
  { key: "call_to_action", label: "CTA" },
  { key: "seo_title", label: "SEO Title" },
  { key: "seo_description", label: "SEO Desc" },
] as const;

function ContentIndicator({ product }: { product: ProductRow }) {
  const filled = CONTENT_FIELDS.filter((f) => !!(product as any)[f.key]).length;
  const total = CONTENT_FIELDS.length;
  if (filled === 0) return <span className="text-muted-foreground/40 text-xs">0/{total}</span>;
  if (filled === total)
    return <span className="text-emerald-600 dark:text-emerald-400 text-xs font-medium">{filled}/{total}</span>;
  return <span className="text-amber-600 dark:text-amber-400 text-xs font-medium">{filled}/{total}</span>;
}

function ChannelCell({ listing }: { listing: ChannelListing | undefined }) {
  if (!listing) return <span className="text-muted-foreground/40">—</span>;
  const status = listing.offer_status?.toLowerCase() ?? "unknown";
  let badgeClass = "bg-muted text-muted-foreground";
  if (status === "live" || status === "active" || status === "published")
    badgeClass = "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400";
  else if (status === "draft")
    badgeClass = "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
  else if (status === "paused" || status === "ended" || status === "suppressed")
    badgeClass = "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400";
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${badgeClass}`}>
      {listing.offer_status ?? "—"}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Column definitions                                                  */
/* ------------------------------------------------------------------ */

const ALL_COLUMNS: { key: string; label: string; align?: "left" | "center" | "right" }[] = [
  { key: "_expand", label: "", align: "left" },
  { key: "mpn", label: "MPN" },
  { key: "name", label: "Product" },
  { key: "theme", label: "Theme" },
  { key: "year", label: "Year", align: "center" },
  { key: "retired", label: "Retired", align: "center" },
  { key: "content", label: "Content", align: "center" },
  { key: "stock", label: "Stock", align: "right" },
  { key: "value", label: "Value", align: "right" },
  { key: "sold", label: "Sold", align: "right" },
  { key: "revenue", label: "Revenue", align: "right" },
];

const DEFAULT_VISIBLE = ALL_COLUMNS.map((c) => c.key);

function getSortValue(p: ProductRow, key: string): unknown {
  switch (key) {
    case "mpn": return p.mpn;
    case "name": return p.name ?? "";
    case "theme": return p.theme_name ?? "";
    case "year": return p.release_year;
    case "retired": return p.retired_flag ? 1 : 0;
    case "content": return CONTENT_FIELDS.filter((f) => !!(p as any)[f.key]).length;
    case "stock": return p.stock_available;
    case "value": return p.carrying_value;
    case "sold": return p.units_sold;
    case "revenue": return p.revenue;
    default: return null;
  }
}

function renderCell(p: ProductRow, key: string, expandedId: string | null): React.ReactNode {
  switch (key) {
    case "_expand":
      return <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expandedId === p.id ? "rotate-90" : ""}`} />;
    case "mpn":
      return <span className="font-mono text-xs font-medium">{p.mpn}</span>;
    case "name":
      return <span className="max-w-[220px] truncate block text-xs">{p.name ?? "—"}</span>;
    case "theme":
      return <span className="text-xs">{p.theme_name ?? "—"}</span>;
    case "year":
      return <span className="text-xs">{p.release_year ?? "—"}</span>;
    case "retired":
      return p.retired_flag ? <Badge variant="outline" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 text-[10px]">Retired</Badge> : null;
    case "content":
      return <ContentIndicator product={p} />;
    case "stock":
      return <span className="font-mono text-xs">{p.stock_available}</span>;
    case "value":
      return <span className="font-mono text-xs">{fmt(p.carrying_value)}</span>;
    case "sold":
      return <span className="font-mono text-xs">{p.units_sold}</span>;
    case "revenue":
      return <span className="font-mono text-xs">{fmt(p.revenue)}</span>;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Page Component                                                      */
/* ------------------------------------------------------------------ */

export function ProductsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [retiredFilter, setRetiredFilter] = useState<string>("all");
  const [contentFilter, setContentFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const tp = useTablePreferences("admin-products", DEFAULT_VISIBLE, { key: "mpn", dir: "asc" });

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const data = await invokeWithAuth<ProductRow[]>("admin-data", { action: "list-products" });
      return data ?? [];
    },
    enabled: !!user,
  });

  /* Filters */
  const filtered = useMemo(() => {
    let list = products;
    if (retiredFilter === "yes") list = list.filter((p) => p.retired_flag);
    else if (retiredFilter === "no") list = list.filter((p) => !p.retired_flag);
    if (contentFilter === "has") list = list.filter((p) => hasContent(p));
    else if (contentFilter === "missing") list = list.filter((p) => !hasContent(p));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.mpn.toLowerCase().includes(q) ||
          (p.name ?? "").toLowerCase().includes(q) ||
          (p.theme_name ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [products, retiredFilter, contentFilter, search]);

  const sorted = useMemo(
    () => sortRows(filtered, tp.prefs.sort.key, tp.prefs.sort.dir, getSortValue),
    [filtered, tp.prefs.sort],
  );

  /* Summary stats */
  const totalProducts = products.length;
  const withContent = products.filter(hasContent).length;
  const inStock = products.filter((p) => p.stock_available > 0).length;
  const listed = products.filter((p) => p.channel_listings.length > 0).length;

  const visibleCols = tp.prefs.visibleColumns
    .map((k) => ALL_COLUMNS.find((c) => c.key === k))
    .filter(Boolean) as typeof ALL_COLUMNS;

  return (
    <BackOfficeLayout title="Products">
      <div className="space-y-6 animate-fade-in">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Total Products</CardTitle>
              <Box className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{totalProducts}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">With Content</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{withContent}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">In Stock</CardTitle>
              <Package className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{inStock}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Listed</CardTitle>
              <ShoppingBag className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{listed}</p></CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="Search MPN, name, theme…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-xs"
          />
          <Select value={retiredFilter} onValueChange={setRetiredFilter}>
            <SelectTrigger className="sm:w-40"><SelectValue placeholder="Retired" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Retired</SelectItem>
              <SelectItem value="no">Active</SelectItem>
            </SelectContent>
          </Select>
          <Select value={contentFilter} onValueChange={setContentFilter}>
            <SelectTrigger className="sm:w-44"><SelectValue placeholder="Content" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All content</SelectItem>
              <SelectItem value="has">Has content</SelectItem>
              <SelectItem value="missing">Missing content</SelectItem>
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
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No products found.</div>
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
                  {sorted.map((p) => (
                    <Collapsible key={p.id} open={expandedId === p.id} onOpenChange={(open) => setExpandedId(open ? p.id : null)} asChild>
                      <>
                        <CollapsibleTrigger asChild>
                          <TableRow className="cursor-pointer" onClick={(e) => {
                            // If clicking the expand chevron column, toggle expand. Otherwise navigate.
                            const target = e.target as HTMLElement;
                            const cell = target.closest("td");
                            if (cell && cell.cellIndex === 0) return; // let collapsible handle it
                            e.preventDefault();
                            navigate(`/admin/products/${p.id}`);
                          }}>
                            {visibleCols.map((col) => (
                              <TableCell key={col.key} className={`${col.key === "_expand" ? "w-8 px-2" : ""} ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}`}>
                                {renderCell(p, col.key, expandedId)}
                              </TableCell>
                            ))}
                          </TableRow>
                        </CollapsibleTrigger>
                        <CollapsibleContent asChild>
                          <tr>
                            <td colSpan={visibleCols.length} className="bg-muted/30 p-0">
                              <div className="px-8 py-4 space-y-4">
                                {/* Content status */}
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Content Fields</p>
                                  <div className="flex flex-wrap gap-3">
                                    {CONTENT_FIELDS.map((f) => {
                                      const filled = !!(p as any)[f.key];
                                      return (
                                        <div key={f.key} className="flex items-center gap-1">
                                          {filled
                                            ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                            : <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />}
                                          <span className={`text-xs ${filled ? "text-foreground" : "text-muted-foreground/60"}`}>{f.label}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* SKUs breakdown */}
                                {p.skus.length > 0 && (
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground mb-1.5">SKUs</p>
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <SortableTableHead columnKey="" label="SKU" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" />
                                          <SortableTableHead columnKey="" label="Grade" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" />
                                          <SortableTableHead columnKey="" label="Price" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" align="right" />
                                          <SortableTableHead columnKey="" label="Stock" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" align="right" />
                                          {CHANNELS.map((ch) => (
                                            <SortableTableHead key={ch} columnKey="" label={CHANNEL_LABELS[ch]} sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" align="center" />
                                          ))}
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {p.skus.map((s) => (
                                          <TableRow key={s.id}>
                                            <TableCell className="font-mono text-xs">{s.sku_code}</TableCell>
                                            <TableCell className="text-xs">{GRADE_LABELS[s.condition_grade] ?? s.condition_grade}</TableCell>
                                            <TableCell className="text-xs text-right font-mono">{fmt(s.price)}</TableCell>
                                            <TableCell className="text-xs text-right font-mono">{s.stock_available}</TableCell>
                                            {CHANNELS.map((ch) => (
                                              <TableCell key={ch} className="text-center">
                                                <ChannelCell listing={s.channel_listings.find((l) => l.channel === ch)} />
                                              </TableCell>
                                            ))}
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                )}
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

export default ProductsPage;
