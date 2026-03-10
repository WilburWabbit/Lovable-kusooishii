import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Rate %</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Synced</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rates.map((rate) => (
                    <TableRow key={rate.id}>
                      <TableCell className="font-medium">{rate.name}</TableCell>
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
