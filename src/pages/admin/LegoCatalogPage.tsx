import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import {
  Database, Search, X, BookOpen, Archive, Layers, Calendar,
} from "lucide-react";
import { useTablePreferences } from "@/hooks/useTablePreferences";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import { ColumnSelector } from "@/components/admin/ColumnSelector";
import { PaginationControls } from "@/components/PaginationControls";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import {
  MobileListCard, MobileCardTitle, MobileCardMeta, MobileCardBadges,
} from "@/components/admin/MobileListCard";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface CatalogRow {
  id: string;
  mpn: string;
  name: string;
  theme_id: string | null;
  theme_name: string | null;
  subtheme_name: string | null;
  piece_count: number | null;
  release_year: number | null;
  retired_flag: boolean;
  img_url: string | null;
  product_type: string;
  status: string;
  description: string | null;
  version_descriptor: string | null;
  brickeconomy_id: string | null;
  bricklink_item_no: string | null;
  brickowl_boid: string | null;
  rebrickable_id: string | null;
  created_at: string;
  updated_at: string;
}

interface FilterOptions {
  themes: { id: string; name: string }[];
  subthemes: string[];
  years: number[];
  productTypes: string[];
}

interface ListResponse {
  rows: CatalogRow[];
  totalCount: number;
}

/* ------------------------------------------------------------------ */
/* Column definitions                                                  */
/* ------------------------------------------------------------------ */

const ALL_COLUMNS: { key: string; label: string; align?: "left" | "center" | "right" }[] = [
  { key: "img", label: "", align: "center" },
  { key: "mpn", label: "MPN" },
  { key: "name", label: "Name" },
  { key: "theme_name", label: "Theme" },
  { key: "subtheme_name", label: "Subtheme" },
  { key: "release_year", label: "Year", align: "center" },
  { key: "piece_count", label: "Pieces", align: "right" },
  { key: "retired_flag", label: "Retired", align: "center" },
  { key: "product_type", label: "Type" },
  { key: "status", label: "Status", align: "center" },
];

const DEFAULT_VISIBLE = ALL_COLUMNS.map((c) => c.key);
const PAGE_SIZES = [25, 50, 100] as const;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function renderCell(row: CatalogRow, key: string): React.ReactNode {
  switch (key) {
    case "img":
      return row.img_url ? (
        <img src={row.img_url} alt="" className="h-8 w-8 rounded object-contain" />
      ) : (
        <div className="h-8 w-8 rounded bg-muted flex items-center justify-center">
          <Database className="h-3 w-3 text-muted-foreground" />
        </div>
      );
    case "mpn":
      return <span className="font-mono text-xs font-medium">{row.mpn}</span>;
    case "name":
      return <span className="max-w-[260px] truncate block text-xs">{row.name}</span>;
    case "theme_name":
      return <span className="text-xs">{row.theme_name ?? "—"}</span>;
    case "subtheme_name":
      return <span className="text-xs">{row.subtheme_name ?? "—"}</span>;
    case "release_year":
      return <span className="text-xs">{row.release_year ?? "—"}</span>;
    case "piece_count":
      return <span className="font-mono text-xs">{row.piece_count ?? "—"}</span>;
    case "retired_flag":
      return row.retired_flag ? (
        <Badge variant="outline" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 text-[10px]">Retired</Badge>
      ) : (
        <Badge variant="outline" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px]">Active</Badge>
      );
    case "product_type":
      return <span className="text-xs capitalize">{row.product_type}</span>;
    case "status":
      return (
        <Badge variant="outline" className={`text-[10px] ${row.status === "active" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
          {row.status}
        </Badge>
      );
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Edit Sheet                                                          */
/* ------------------------------------------------------------------ */

function EditSheet({
  row,
  filterOptions,
  open,
  onClose,
  onSaved,
}: {
  row: CatalogRow | null;
  filterOptions: FilterOptions | undefined;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (row) {
      setForm({
        name: row.name,
        mpn: row.mpn,
        theme_id: row.theme_id ?? "",
        subtheme_name: row.subtheme_name ?? "",
        piece_count: row.piece_count ?? "",
        release_year: row.release_year ?? "",
        retired_flag: row.retired_flag,
        product_type: row.product_type,
        status: row.status,
        description: row.description ?? "",
        version_descriptor: row.version_descriptor ?? "",
        img_url: row.img_url ?? "",
        brickeconomy_id: row.brickeconomy_id ?? "",
        bricklink_item_no: row.bricklink_item_no ?? "",
        brickowl_boid: row.brickowl_boid ?? "",
        rebrickable_id: row.rebrickable_id ?? "",
      });
    }
  }, [row]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!row) return;
      const updates: Record<string, unknown> = {};
      if (form.name !== row.name) updates.name = form.name;
      if (form.mpn !== row.mpn) updates.mpn = form.mpn;
      if (form.theme_id !== (row.theme_id ?? "")) updates.theme_id = form.theme_id || null;
      if (form.subtheme_name !== (row.subtheme_name ?? "")) updates.subtheme_name = form.subtheme_name || null;
      const pc = form.piece_count === "" ? null : Number(form.piece_count);
      if (pc !== row.piece_count) updates.piece_count = pc;
      const ry = form.release_year === "" ? null : Number(form.release_year);
      if (ry !== row.release_year) updates.release_year = ry;
      if (form.retired_flag !== row.retired_flag) updates.retired_flag = form.retired_flag;
      if (form.product_type !== row.product_type) updates.product_type = form.product_type;
      if (form.status !== row.status) updates.status = form.status;
      if (form.description !== (row.description ?? "")) updates.description = form.description || null;
      if (form.version_descriptor !== (row.version_descriptor ?? "")) updates.version_descriptor = form.version_descriptor || null;
      if (form.img_url !== (row.img_url ?? "")) updates.img_url = form.img_url || null;
      if (form.brickeconomy_id !== (row.brickeconomy_id ?? "")) updates.brickeconomy_id = form.brickeconomy_id || null;
      if (form.bricklink_item_no !== (row.bricklink_item_no ?? "")) updates.bricklink_item_no = form.bricklink_item_no || null;
      if (form.brickowl_boid !== (row.brickowl_boid ?? "")) updates.brickowl_boid = form.brickowl_boid || null;
      if (form.rebrickable_id !== (row.rebrickable_id ?? "")) updates.rebrickable_id = form.rebrickable_id || null;

      if (Object.keys(updates).length === 0) {
        toast.info("No changes to save.");
        return;
      }

      await invokeWithAuth("admin-data", { action: "update-lego-catalog", id: row.id, updates });
      toast.success("Catalog entry updated.");
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  if (!row) return null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display">Edit Catalog Entry</SheetTitle>
          <SheetDescription className="font-mono text-xs">{row.mpn} — {row.name}</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          {/* Core fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">MPN</Label>
              <Input value={String(form.mpn ?? "")} onChange={(e) => set("mpn", e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={String(form.name ?? "")} onChange={(e) => set("name", e.target.value)} className="h-8 text-xs" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Theme</Label>
              <Select value={String(form.theme_id ?? "")} onValueChange={(v) => set("theme_id", v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select theme" /></SelectTrigger>
                <SelectContent>
                  {(filterOptions?.themes ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Subtheme</Label>
              <Input value={String(form.subtheme_name ?? "")} onChange={(e) => set("subtheme_name", e.target.value)} className="h-8 text-xs" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Year</Label>
              <Input type="number" value={String(form.release_year ?? "")} onChange={(e) => set("release_year", e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Pieces</Label>
              <Input type="number" value={String(form.piece_count ?? "")} onChange={(e) => set("piece_count", e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Version</Label>
              <Input value={String(form.version_descriptor ?? "")} onChange={(e) => set("version_descriptor", e.target.value)} className="h-8 text-xs" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Product Type</Label>
              <Select value={String(form.product_type ?? "Set")} onValueChange={(v) => set("product_type", v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(filterOptions?.productTypes ?? ["Set"]).map((pt) => (
                    <SelectItem key={pt} value={pt}>{pt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={String(form.status ?? "active")} onValueChange={(v) => set("status", v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              checked={!!form.retired_flag}
              onCheckedChange={(checked) => set("retired_flag", !!checked)}
            />
            <Label className="text-xs">Retired</Label>
          </div>

          <div>
            <Label className="text-xs">Image URL</Label>
            <Input value={String(form.img_url ?? "")} onChange={(e) => set("img_url", e.target.value)} className="h-8 text-xs" />
          </div>

          <div>
            <Label className="text-xs">Description</Label>
            <Textarea value={String(form.description ?? "")} onChange={(e) => set("description", e.target.value)} rows={3} className="text-xs" />
          </div>

          {/* External IDs */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">External IDs</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">BrickEconomy ID</Label>
                <Input value={String(form.brickeconomy_id ?? "")} onChange={(e) => set("brickeconomy_id", e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">BrickLink Item No</Label>
                <Input value={String(form.bricklink_item_no ?? "")} onChange={(e) => set("bricklink_item_no", e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">BrickOwl BOID</Label>
                <Input value={String(form.brickowl_boid ?? "")} onChange={(e) => set("brickowl_boid", e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">Rebrickable ID</Label>
                <Input value={String(form.rebrickable_id ?? "")} onChange={(e) => set("rebrickable_id", e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={onClose} className="text-xs">Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="text-xs">
            {mutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Page Component                                                      */
/* ------------------------------------------------------------------ */

export function LegoCatalogPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Filters state
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [themeFilter, setThemeFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [retiredFilter, setRetiredFilter] = useState("all");
  const [productTypeFilter, setProductTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Table preferences (sort + columns)
  const tp = useTablePreferences("admin-lego-catalog", DEFAULT_VISIBLE, { key: "mpn", dir: "asc" });

  // Edit sheet
  const [editRow, setEditRow] = useState<CatalogRow | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when filters change
  const resetPage = useCallback(() => setPage(1), []);

  // Filter options
  const { data: filterOptions } = useQuery({
    queryKey: ["lego-catalog-filter-options"],
    queryFn: () => invokeWithAuth<FilterOptions>("admin-data", { action: "lego-catalog-filter-options" }),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  // Main data query
  const { data, isLoading } = useQuery({
    queryKey: [
      "admin-lego-catalog",
      page, pageSize,
      debouncedSearch,
      themeFilter, yearFilter, retiredFilter, productTypeFilter, statusFilter,
      tp.prefs.sort.key, tp.prefs.sort.dir,
    ],
    queryFn: () =>
      invokeWithAuth<ListResponse>("admin-data", {
        action: "list-lego-catalog",
        page,
        pageSize,
        search: debouncedSearch || undefined,
        theme_id: themeFilter !== "all" ? themeFilter : undefined,
        year: yearFilter !== "all" ? yearFilter : undefined,
        retired: retiredFilter !== "all" ? retiredFilter : undefined,
        product_type: productTypeFilter !== "all" ? productTypeFilter : undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
        sortKey: tp.prefs.sort.key,
        sortDir: tp.prefs.sort.dir,
      }),
    enabled: !!user,
    placeholderData: (prev) => prev,
  });

  const rows = data?.rows ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  const handleSaved = () => {
    setEditRow(null);
    queryClient.invalidateQueries({ queryKey: ["admin-lego-catalog"] });
  };

  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setThemeFilter("all");
    setYearFilter("all");
    setRetiredFilter("all");
    setProductTypeFilter("all");
    setStatusFilter("all");
    setPage(1);
  };

  const hasActiveFilters = debouncedSearch || themeFilter !== "all" || yearFilter !== "all" || retiredFilter !== "all" || productTypeFilter !== "all" || statusFilter !== "all";

  const visibleCols = tp.prefs.visibleColumns
    .map((k) => ALL_COLUMNS.find((c) => c.key === k))
    .filter(Boolean) as typeof ALL_COLUMNS;

  return (
    <BackOfficeLayout title="LEGO Catalog">
      <div className="space-y-6 animate-fade-in">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Total Sets</CardTitle>
              <Database className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold font-display">{totalCount.toLocaleString()}</p>
              {hasActiveFilters && (
                <p className="text-[10px] text-muted-foreground">filtered result</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Themes</CardTitle>
              <Layers className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold font-display">{filterOptions?.themes.length ?? "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Year Range</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold font-display">
                {filterOptions?.years.length
                  ? `${filterOptions.years[filterOptions.years.length - 1]}–${filterOptions.years[0]}`
                  : "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Product Types</CardTitle>
              <Archive className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold font-display">{filterOptions?.productTypes.length ?? "—"}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters bar */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative sm:max-w-xs flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search MPN or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={themeFilter} onValueChange={(v) => { setThemeFilter(v); resetPage(); }}>
              <SelectTrigger className="sm:w-44"><SelectValue placeholder="Theme" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Themes</SelectItem>
                {(filterOptions?.themes ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={yearFilter} onValueChange={(v) => { setYearFilter(v); resetPage(); }}>
              <SelectTrigger className="sm:w-28"><SelectValue placeholder="Year" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {(filterOptions?.years ?? []).map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={retiredFilter} onValueChange={(v) => { setRetiredFilter(v); resetPage(); }}>
              <SelectTrigger className="sm:w-32"><SelectValue placeholder="Retired" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="yes">Retired</SelectItem>
                <SelectItem value="no">Not Retired</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={productTypeFilter} onValueChange={(v) => { setProductTypeFilter(v); resetPage(); }}>
              <SelectTrigger className="sm:w-36"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {(filterOptions?.productTypes ?? []).map((pt) => (
                  <SelectItem key={pt} value={pt}>{pt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); resetPage(); }}>
              <SelectTrigger className="sm:w-32"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-xs">
                <X className="h-3 w-3" /> Clear filters
              </Button>
            )}
            <div className="hidden md:block sm:ml-auto">
              <ColumnSelector
                allColumns={ALL_COLUMNS.filter((c) => c.key !== "img")}
                visibleColumns={tp.prefs.visibleColumns.filter((k) => k !== "img")}
                onToggleColumn={tp.toggleColumn}
                onMoveColumn={tp.moveColumn}
              />
            </div>
          </div>
        </div>

        {/* Mobile card view */}
        <div className="md:hidden space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No catalog entries found.</div>
          ) : (
            rows.map((r) => (
              <MobileListCard key={r.id} onClick={() => setEditRow(r)}>
                <MobileCardTitle>{r.mpn} — {r.name}</MobileCardTitle>
                <MobileCardMeta>
                  {r.theme_name && <span>{r.theme_name}</span>}
                  {r.release_year && <span>{r.release_year}</span>}
                  {r.piece_count != null && <span>{r.piece_count} pcs</span>}
                </MobileCardMeta>
                <MobileCardBadges>
                  {r.retired_flag && (
                    <Badge variant="outline" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 text-[10px]">Retired</Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] capitalize">{r.product_type}</Badge>
                </MobileCardBadges>
              </MobileListCard>
            ))
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block">
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No catalog entries found.</div>
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
                          sortable={col.key !== "img"}
                          className={col.key === "img" ? "w-10" : ""}
                        />
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setEditRow(r)}
                      >
                        {visibleCols.map((col) => (
                          <TableCell
                            key={col.key}
                            className={`${col.key === "img" ? "w-10 px-2" : ""} ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}`}
                          >
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

        {/* Pagination */}
        <PaginationControls
          currentPage={page}
          totalPages={totalPages}
          totalItems={totalCount}
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZES}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          itemLabel="sets"
        />
      </div>

      {/* Edit Sheet */}
      <EditSheet
        row={editRow}
        filterOptions={filterOptions}
        open={!!editRow}
        onClose={() => setEditRow(null)}
        onSaved={handleSaved}
      />
    </BackOfficeLayout>
  );
}

export default LegoCatalogPage;
