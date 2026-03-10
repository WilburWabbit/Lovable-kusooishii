import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTablePreferences } from "@/hooks/useTablePreferences";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import { ColumnSelector } from "@/components/admin/ColumnSelector";
import { sortRows } from "@/lib/table-utils";

interface VatRate {
  id: string;
  qbo_tax_rate_id: string;
  name: string;
  description: string | null;
  rate_percent: number;
  agency_ref: string | null;
  active: boolean;
  synced_at: string;
}

interface TaxCode {
  id: string;
  qbo_tax_code_id: string;
  name: string;
  active: boolean;
  sales_tax_rate_id: string | null;
  purchase_tax_rate_id: string | null;
  synced_at: string;
  sales_rate_name?: string;
  sales_rate_percent?: number;
  purchase_rate_name?: string;
  purchase_rate_percent?: number;
}

async function invokeWithAuth(fnName: string, body?: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated – please log in again.");
  const { data, error } = await supabase.functions.invoke(fnName, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  return data;
}

const RATE_COLUMNS: { key: string; label: string; align?: "left" | "center" | "right" }[] = [
  { key: "name", label: "Name" },
  { key: "qbo_tax_rate_id", label: "QBO Rate ID" },
  { key: "rate_percent", label: "Rate %", align: "right" as const },
  { key: "description", label: "Description" },
  { key: "active", label: "Status" },
  { key: "synced_at", label: "Last Synced" },
];

const CODE_COLUMNS: { key: string; label: string; align?: "left" | "center" | "right" }[] = [
  { key: "name", label: "Name" },
  { key: "qbo_tax_code_id", label: "QBO Code ID" },
  { key: "sales_rate", label: "Sales Rate" },
  { key: "purchase_rate", label: "Purchase Rate" },
  { key: "active", label: "Status" },
  { key: "synced_at", label: "Last Synced" },
];

function renderRateCell(rate: VatRate, key: string): React.ReactNode {
  switch (key) {
    case "name": return <span className="font-medium">{rate.name}</span>;
    case "qbo_tax_rate_id": return <span className="font-mono text-muted-foreground text-xs">{rate.qbo_tax_rate_id}</span>;
    case "rate_percent": return <span className="font-mono">{Number(rate.rate_percent).toFixed(2)}%</span>;
    case "description": return <span className="text-muted-foreground">{rate.description ?? "—"}</span>;
    case "active":
      return (
        <Badge variant="outline" className={rate.active ? "border-green-300 bg-green-50 text-green-700" : "border-muted bg-muted text-muted-foreground"}>
          {rate.active ? "Active" : "Inactive"}
        </Badge>
      );
    case "synced_at": return <span className="text-muted-foreground text-xs">{new Date(rate.synced_at).toLocaleString()}</span>;
    default: return null;
  }
}

function renderCodeCell(tc: TaxCode, key: string): React.ReactNode {
  switch (key) {
    case "name": return <span className="font-medium">{tc.name}</span>;
    case "qbo_tax_code_id": return <span className="font-mono text-muted-foreground text-xs">{tc.qbo_tax_code_id}</span>;
    case "sales_rate":
      return tc.sales_rate_name
        ? <span>{tc.sales_rate_name} <span className="font-mono text-muted-foreground">({tc.sales_rate_percent?.toFixed(2)}%)</span></span>
        : <span className="text-muted-foreground">—</span>;
    case "purchase_rate":
      return tc.purchase_rate_name
        ? <span>{tc.purchase_rate_name} <span className="font-mono text-muted-foreground">({tc.purchase_rate_percent?.toFixed(2)}%)</span></span>
        : <span className="text-muted-foreground">—</span>;
    case "active":
      return (
        <Badge variant="outline" className={tc.active ? "border-green-300 bg-green-50 text-green-700" : "border-muted bg-muted text-muted-foreground"}>
          {tc.active ? "Active" : "Inactive"}
        </Badge>
      );
    case "synced_at": return <span className="text-muted-foreground text-xs">{new Date(tc.synced_at).toLocaleString()}</span>;
    default: return null;
  }
}

function getRateSortValue(r: VatRate, key: string): unknown {
  switch (key) {
    case "rate_percent": return r.rate_percent;
    case "active": return r.active;
    case "synced_at": return r.synced_at;
    default: return (r as any)[key];
  }
}

function getCodeSortValue(tc: TaxCode, key: string): unknown {
  switch (key) {
    case "sales_rate": return tc.sales_rate_name ?? "";
    case "purchase_rate": return tc.purchase_rate_name ?? "";
    case "active": return tc.active;
    case "synced_at": return tc.synced_at;
    default: return (tc as any)[key];
  }
}

export default function VatRatesSettingsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [rates, setRates] = useState<VatRate[]>([]);
  const [codes, setCodes] = useState<TaxCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const ratesTp = useTablePreferences("admin-vat-rates", RATE_COLUMNS.map((c) => c.key), { key: "name", dir: "asc" });
  const codesTp = useTablePreferences("admin-tax-codes", CODE_COLUMNS.map((c) => c.key), { key: "name", dir: "asc" });

  const sortedRates = useMemo(
    () => sortRows(rates, ratesTp.prefs.sort.key, ratesTp.prefs.sort.dir, getRateSortValue),
    [rates, ratesTp.prefs.sort],
  );

  const sortedCodes = useMemo(
    () => sortRows(codes, codesTp.prefs.sort.key, codesTp.prefs.sort.dir, getCodeSortValue),
    [codes, codesTp.prefs.sort],
  );

  const visibleRateCols = ratesTp.prefs.visibleColumns
    .map((k) => RATE_COLUMNS.find((c) => c.key === k)!)
    .filter(Boolean);

  const visibleCodeCols = codesTp.prefs.visibleColumns
    .map((k) => CODE_COLUMNS.find((c) => c.key === k)!)
    .filter(Boolean);

  const fetchData = async () => {
    setLoading(true);
    const [ratesRes, codesRes, allRates] = await Promise.all([
      supabase.from("vat_rate").select("*").order("name"),
      supabase.from("tax_code").select("*").order("name"),
      supabase.from("vat_rate").select("id, name, rate_percent"),
    ]);

    if (!ratesRes.error && ratesRes.data) setRates(ratesRes.data as unknown as VatRate[]);

    const rateMap = new Map<string, { name: string; rate_percent: number }>();
    for (const r of (allRates.data ?? [])) {
      rateMap.set(r.id, { name: r.name, rate_percent: r.rate_percent });
    }

    if (!codesRes.error && codesRes.data) {
      setCodes((codesRes.data as unknown as TaxCode[]).map(tc => ({
        ...tc,
        sales_rate_name: tc.sales_tax_rate_id ? rateMap.get(tc.sales_tax_rate_id)?.name : undefined,
        sales_rate_percent: tc.sales_tax_rate_id ? rateMap.get(tc.sales_tax_rate_id)?.rate_percent : undefined,
        purchase_rate_name: tc.purchase_tax_rate_id ? rateMap.get(tc.purchase_tax_rate_id)?.name : undefined,
        purchase_rate_percent: tc.purchase_tax_rate_id ? rateMap.get(tc.purchase_tax_rate_id)?.rate_percent : undefined,
      })));
    }

    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const syncFromQbo = async () => {
    setSyncing(true);
    try {
      const data = await invokeWithAuth("qbo-sync-tax-rates");
      if (data?.error) throw new Error(data.error);
      toast({
        title: "Sync complete",
        description: `${data.synced} tax rate(s) and ${data.tax_codes_synced} tax code(s) synced from QBO.`,
      });
      fetchData();
    } catch (err) {
      toast({
        title: "Sync failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <BackOfficeLayout title="VAT Rates & Tax Codes">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="font-body text-sm text-muted-foreground">
            Tax rates and tax codes synced from QuickBooks Online. These are read-only.
          </p>
          <Button size="sm" onClick={syncFromQbo} disabled={syncing || !user}>
            {syncing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
            Refresh from QBO
          </Button>
        </div>

        <Tabs defaultValue="rates">
          <TabsList>
            <TabsTrigger value="rates">Tax Rates ({rates.length})</TabsTrigger>
            <TabsTrigger value="codes">Tax Codes ({codes.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="rates">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-display text-base">Tax Rates</CardTitle>
                <ColumnSelector
                  allColumns={RATE_COLUMNS}
                  visibleColumns={ratesTp.prefs.visibleColumns}
                  onToggleColumn={ratesTp.toggleColumn}
                  onMoveColumn={ratesTp.moveColumn}
                />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : rates.length === 0 ? (
                  <p className="font-body text-sm text-muted-foreground py-8 text-center">No VAT rates found. Click "Refresh from QBO" to sync.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {visibleRateCols.map((col) => (
                          <SortableTableHead
                            key={col.key}
                            columnKey={col.key}
                            label={col.label}
                            sortKey={ratesTp.prefs.sort.key}
                            sortDir={ratesTp.prefs.sort.dir}
                            onToggleSort={ratesTp.toggleSort}
                            align={col.align}
                          />
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedRates.map((rate) => (
                        <TableRow key={rate.id}>
                          {visibleRateCols.map((col) => (
                            <TableCell key={col.key} className={col.align === "right" ? "text-right" : ""}>
                              {renderRateCell(rate, col.key)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="codes">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-display text-base">Tax Codes</CardTitle>
                <ColumnSelector
                  allColumns={CODE_COLUMNS}
                  visibleColumns={codesTp.prefs.visibleColumns}
                  onToggleColumn={codesTp.toggleColumn}
                  onMoveColumn={codesTp.moveColumn}
                />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : codes.length === 0 ? (
                  <p className="font-body text-sm text-muted-foreground py-8 text-center">No tax codes found. Click "Refresh from QBO" to sync.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {visibleCodeCols.map((col) => (
                          <SortableTableHead
                            key={col.key}
                            columnKey={col.key}
                            label={col.label}
                            sortKey={codesTp.prefs.sort.key}
                            sortDir={codesTp.prefs.sort.dir}
                            onToggleSort={codesTp.toggleSort}
                            align={col.align}
                          />
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedCodes.map((tc) => (
                        <TableRow key={tc.id}>
                          {visibleCodeCols.map((col) => (
                            <TableCell key={col.key}>
                              {renderCodeCell(tc, col.key)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </BackOfficeLayout>
  );
}
