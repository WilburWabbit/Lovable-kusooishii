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

type SortKey = "name" | "qbo_tax_rate_id" | "rate_percent" | "description" | "active" | "synced_at";
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

export default function VatRatesSettingsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [rates, setRates] = useState<VatRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortedRates = [...rates].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    if (typeof av === "boolean" && typeof bv === "boolean") return (Number(av) - Number(bv)) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground/50" />;
    return sortDir === "asc"
      ? <ArrowUp className="ml-1 inline h-3 w-3" />
      : <ArrowDown className="ml-1 inline h-3 w-3" />;
  };

  const fetchRates = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("vat_rate")
      .select("*")
      .order("name");
    if (!error && data) setRates(data as unknown as VatRate[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchRates();
  }, []);

  const syncFromQbo = async () => {
    setSyncing(true);
    try {
      const data = await invokeWithAuth("qbo-sync-tax-rates");
      if (data?.error) throw new Error(data.error);
      toast({
        title: "Sync complete",
        description: `${data.synced} tax rate(s) synced from QBO.`,
      });
      fetchRates();
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
    <BackOfficeLayout title="VAT Rates">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="font-body text-sm text-muted-foreground">
            Tax rates synced from QuickBooks Online. These are read-only.
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
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("name")}>
                      Name <SortIcon col="name" />
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("qbo_tax_rate_id")}>
                      QBO Rate ID <SortIcon col="qbo_tax_rate_id" />
                    </TableHead>
                    <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort("rate_percent")}>
                      Rate % <SortIcon col="rate_percent" />
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("description")}>
                      Description <SortIcon col="description" />
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("active")}>
                      Status <SortIcon col="active" />
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("synced_at")}>
                      Last Synced <SortIcon col="synced_at" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRates.map((rate) => (
                    <TableRow key={rate.id}>
                      <TableCell className="font-medium">{rate.name}</TableCell>
                      <TableCell className="font-mono text-muted-foreground text-xs">{rate.qbo_tax_rate_id}</TableCell>
                      <TableCell className="text-right font-mono">
                        {Number(rate.rate_percent).toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {rate.description ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            rate.active
                              ? "border-green-300 bg-green-50 text-green-700"
                              : "border-muted bg-muted text-muted-foreground"
                          }
                        >
                          {rate.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {new Date(rate.synced_at).toLocaleString()}
                      </TableCell>
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
