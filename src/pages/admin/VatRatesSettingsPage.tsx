import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SortDir = "asc" | "desc";

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

type RateSortKey = "name" | "qbo_tax_rate_id" | "rate_percent" | "description" | "active" | "synced_at";
type CodeSortKey = "name" | "qbo_tax_code_id" | "active" | "synced_at";

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

function useSortable<K extends string>(defaultKey: K) {
  const [sortKey, setSortKey] = useState<K>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const toggleSort = (key: K) => {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };
  return { sortKey, sortDir, toggleSort };
}

function sortRows<T>(rows: T[], key: keyof T, dir: SortDir): T[] {
  return [...rows].sort((a, b) => {
    const d = dir === "asc" ? 1 : -1;
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * d;
    if (typeof av === "boolean" && typeof bv === "boolean") return (Number(av) - Number(bv)) * d;
    return String(av).localeCompare(String(bv)) * d;
  });
}

function SortIcon<K extends string>({ col, sortKey, sortDir }: { col: K; sortKey: K; sortDir: SortDir }) {
  if (sortKey !== col) return <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground/50" />;
  return sortDir === "asc"
    ? <ArrowUp className="ml-1 inline h-3 w-3" />
    : <ArrowDown className="ml-1 inline h-3 w-3" />;
}

export default function VatRatesSettingsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [rates, setRates] = useState<VatRate[]>([]);
  const [codes, setCodes] = useState<TaxCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const rateSorter = useSortable<RateSortKey>("name");
  const codeSorter = useSortable<CodeSortKey>("name");

  const sortedRates = sortRows(rates, rateSorter.sortKey, rateSorter.sortDir);
  const sortedCodes = sortRows(codes, codeSorter.sortKey, codeSorter.sortDir);

  const fetchData = async () => {
    setLoading(true);
    const [ratesRes, codesRes, allRates] = await Promise.all([
      supabase.from("vat_rate").select("*").order("name"),
      supabase.from("tax_code").select("*").order("name"),
      supabase.from("vat_rate").select("id, name, rate_percent"),
    ]);

    if (!ratesRes.error && ratesRes.data) setRates(ratesRes.data as unknown as VatRate[]);

    // Enrich tax codes with rate names
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
            {syncing ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
            )}
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
              <CardHeader>
                <CardTitle className="font-display text-base">Tax Rates</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : rates.length === 0 ? (
                  <p className="font-body text-sm text-muted-foreground py-8 text-center">
                    No VAT rates found. Click "Refresh from QBO" to sync.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {(["name", "qbo_tax_rate_id", "rate_percent", "description", "active", "synced_at"] as RateSortKey[]).map(col => (
                          <TableHead
                            key={col}
                            className={`cursor-pointer select-none ${col === "rate_percent" ? "text-right" : ""}`}
                            onClick={() => rateSorter.toggleSort(col)}
                          >
                            {{ name: "Name", qbo_tax_rate_id: "QBO Rate ID", rate_percent: "Rate %", description: "Description", active: "Status", synced_at: "Last Synced" }[col]}
                            <SortIcon col={col} sortKey={rateSorter.sortKey} sortDir={rateSorter.sortDir} />
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedRates.map(rate => (
                        <TableRow key={rate.id}>
                          <TableCell className="font-medium">{rate.name}</TableCell>
                          <TableCell className="font-mono text-muted-foreground text-xs">{rate.qbo_tax_rate_id}</TableCell>
                          <TableCell className="text-right font-mono">{Number(rate.rate_percent).toFixed(2)}%</TableCell>
                          <TableCell className="text-muted-foreground">{rate.description ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={rate.active ? "border-green-300 bg-green-50 text-green-700" : "border-muted bg-muted text-muted-foreground"}>
                              {rate.active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">{new Date(rate.synced_at).toLocaleString()}</TableCell>
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
              <CardHeader>
                <CardTitle className="font-display text-base">Tax Codes</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : codes.length === 0 ? (
                  <p className="font-body text-sm text-muted-foreground py-8 text-center">
                    No tax codes found. Click "Refresh from QBO" to sync.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="cursor-pointer select-none" onClick={() => codeSorter.toggleSort("name")}>
                          Name <SortIcon col="name" sortKey={codeSorter.sortKey} sortDir={codeSorter.sortDir} />
                        </TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => codeSorter.toggleSort("qbo_tax_code_id")}>
                          QBO Code ID <SortIcon col="qbo_tax_code_id" sortKey={codeSorter.sortKey} sortDir={codeSorter.sortDir} />
                        </TableHead>
                        <TableHead>Sales Rate</TableHead>
                        <TableHead>Purchase Rate</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => codeSorter.toggleSort("active")}>
                          Status <SortIcon col="active" sortKey={codeSorter.sortKey} sortDir={codeSorter.sortDir} />
                        </TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => codeSorter.toggleSort("synced_at")}>
                          Last Synced <SortIcon col="synced_at" sortKey={codeSorter.sortKey} sortDir={codeSorter.sortDir} />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedCodes.map(tc => (
                        <TableRow key={tc.id}>
                          <TableCell className="font-medium">{tc.name}</TableCell>
                          <TableCell className="font-mono text-muted-foreground text-xs">{tc.qbo_tax_code_id}</TableCell>
                          <TableCell className="text-sm">
                            {tc.sales_rate_name
                              ? <span>{tc.sales_rate_name} <span className="font-mono text-muted-foreground">({tc.sales_rate_percent?.toFixed(2)}%)</span></span>
                              : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-sm">
                            {tc.purchase_rate_name
                              ? <span>{tc.purchase_rate_name} <span className="font-mono text-muted-foreground">({tc.purchase_rate_percent?.toFixed(2)}%)</span></span>
                              : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={tc.active ? "border-green-300 bg-green-50 text-green-700" : "border-muted bg-muted text-muted-foreground"}>
                              {tc.active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">{new Date(tc.synced_at).toLocaleString()}</TableCell>
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
