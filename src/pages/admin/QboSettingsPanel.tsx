import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Link2, RefreshCw, Unplug, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/** Generate month labels from current month back to April 2023 */
function generateMonthList(): string[] {
  const months: string[] = [];
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  const endYear = 2023;
  const endMonth = 4;

  while (year > endYear || (year === endYear && month >= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month--;
    if (month < 1) { month = 12; year--; }
  }
  return months;
}

export function QboSettingsPanel() {
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<{ connected: boolean; realm_id?: string; last_updated?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; month: string } | null>(null);
  const [syncingSales, setSyncingSales] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncingCustomers, setSyncingCustomers] = useState(false);
  const [syncingItems, setSyncingItems] = useState(false);
  const [cancelSync, setCancelSync] = useState(false);
  const cancelRef = useRef(false);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("qbo-auth", {
        body: { action: "status" },
      });
      if (error) throw error;
      setStatus(data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  const syncPurchases = async () => {
    setSyncing(true);
    cancelRef.current = false;
    const months = generateMonthList();
    const totals = {
      total: 0, auto_processed: 0, left_pending: 0,
      skipped_existing: 0, skipped_no_items: 0, cleaned_up: 0,
      backfilled_tax_codes: 0, backfilled_stock_links: 0,
    };

    try {
      for (let i = 0; i < months.length; i++) {
        if (cancelRef.current) break;
        const month = months[i];
        setSyncProgress({ current: i + 1, total: months.length, month });

        const data = await invokeWithAuth("qbo-sync-purchases", { month });
        if (data?.error) throw new Error(data.error);

        totals.total += data.total ?? 0;
        totals.auto_processed += data.auto_processed ?? 0;
        totals.left_pending += data.left_pending ?? 0;
        totals.skipped_existing += data.skipped_existing ?? 0;
        totals.skipped_no_items += data.skipped_no_items ?? 0;
        totals.cleaned_up += data.cleaned_up ?? 0;
        totals.backfilled_tax_codes += data.backfilled_tax_codes ?? 0;
        totals.backfilled_stock_links += data.backfilled_stock_links ?? 0;
      }

      const parts = [`${totals.auto_processed} auto-processed`];
      if (totals.left_pending) parts.push(`${totals.left_pending} pending review`);
      if (totals.skipped_existing) parts.push(`${totals.skipped_existing} unchanged`);
      if (totals.skipped_no_items) parts.push(`${totals.skipped_no_items} non-stock skipped`);
      if (totals.cleaned_up) parts.push(`${totals.cleaned_up} empty receipts cleaned up`);
      if (totals.backfilled_tax_codes) parts.push(`${totals.backfilled_tax_codes} tax codes backfilled`);
      if (totals.backfilled_stock_links) parts.push(`${totals.backfilled_stock_links} stock units linked`);

      toast({
        title: cancelRef.current ? "Sync stopped" : "Sync complete",
        description: `${totals.total} purchases: ${parts.join(", ")}.`,
      });
      fetchStatus();
    } catch (err) {
      toast({
        title: "Sync failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const stopSync = () => { cancelRef.current = true; };

  const connectQbo = async () => {
    try {
      const data = await invokeWithAuth("qbo-auth", { action: "authorize_url" });
      if (data?.error) throw new Error(data.error);
      window.location.href = data.url;
    } catch (err) {
      toast({
        title: "Connection failed",
        description: err instanceof Error ? err.message : "Could not generate authorization URL",
        variant: "destructive",
      });
    }
  };

  const disconnectQbo = async () => {
    if (!status?.realm_id) return;
    setDisconnecting(true);
    try {
      const data = await invokeWithAuth("qbo-auth", { action: "disconnect", realm_id: status.realm_id });
      if (data?.error) throw new Error(data.error);
      toast({ title: "Disconnected", description: "QuickBooks connection removed." });
      setStatus({ connected: false });
    } catch (err) {
      toast({
        title: "Disconnect failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDisconnecting(false);
    }
  };

  const syncCustomers = async () => {
    setSyncingCustomers(true);
    try {
      const data = await invokeWithAuth("qbo-sync-customers");
      if (data?.error) throw new Error(data.error);
      const parts: string[] = [];
      if (data.upserted) parts.push(`${data.upserted} customers synced`);
      if (data.skipped) parts.push(`${data.skipped} skipped`);
      if (data.orders_linked) parts.push(`${data.orders_linked} orders linked`);
      toast({
        title: "Customer sync complete",
        description: parts.length > 0 ? parts.join(", ") + "." : "No changes.",
      });
    } catch (err) {
      toast({
        title: "Customer sync failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSyncingCustomers(false);
    }
  };

  const syncItems = async () => {
    setSyncingItems(true);
    try {
      const data = await invokeWithAuth("qbo-sync-items");
      if (data?.error) throw new Error(data.error);
      const parts: string[] = [];
      if (data.upserted) parts.push(`${data.upserted} items upserted`);
      if (data.linked) parts.push(`${data.linked} linked to existing SKUs`);
      if (data.skipped_no_mpn) parts.push(`${data.skipped_no_mpn} skipped (no MPN)`);
      if (data.errors) parts.push(`${data.errors} errors`);
      toast({
        title: "Item sync complete",
        description: parts.length > 0 ? `${data.total} items: ${parts.join(", ")}.` : "No items found.",
      });
      fetchStatus();
    } catch (err) {
      toast({
        title: "Item sync failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSyncingItems(false);
    }
  };

  const syncSales = async () => {
    setSyncingSales(true);
    try {
      const data = await invokeWithAuth("qbo-sync-sales");
      if (data?.error) throw new Error(data.error);
      const parts: string[] = [];
      if (data.sales_created) parts.push(`${data.sales_created} sales imported`);
      if (data.sales_skipped) parts.push(`${data.sales_skipped} sales unchanged`);
      if (data.stock_matched) parts.push(`${data.stock_matched} stock matched`);
      if (data.stock_missing) parts.push(`${data.stock_missing} stock missing`);
      if (data.refunds_created) parts.push(`${data.refunds_created} refunds imported`);
      if (data.refunds_skipped) parts.push(`${data.refunds_skipped} refunds unchanged`);
      if (data.vat_backfilled) parts.push(`${data.vat_backfilled} VAT codes backfilled`);
      toast({
        title: "Sales sync complete",
        description: parts.length > 0 ? parts.join(", ") + "." : "No new records.",
      });
      fetchStatus();
    } catch (err) {
      toast({
        title: "Sales sync failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSyncingSales(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">QuickBooks Online</CardTitle>
        <CardDescription className="font-body text-xs">
          Connect to QBO to pull purchase receipts for inventory intake.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || authLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : status?.connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50">
                Connected
              </Badge>
              <span className="font-body text-xs text-muted-foreground">
                Realm: {status.realm_id}
              </span>
            </div>
            {status.last_updated && (
              <p className="font-body text-xs text-muted-foreground">
                Last token update: {new Date(status.last_updated).toLocaleString()}
              </p>
            )}

            {/* Progress indicator for purchase sync */}
            {syncProgress && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="font-body text-xs text-muted-foreground">
                    Syncing {syncProgress.month}… ({syncProgress.current} of {syncProgress.total})
                  </p>
                  <Button size="sm" variant="ghost" onClick={stopSync} className="h-6 px-2 text-xs">
                    <Square className="mr-1 h-3 w-3" />
                    Stop
                  </Button>
                </div>
                <Progress value={(syncProgress.current / syncProgress.total) * 100} className="h-2" />
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={syncPurchases} disabled={syncing || !user}>
                {syncing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                Sync Purchases
              </Button>
              <Button size="sm" onClick={syncSales} disabled={syncingSales || !user}>
                {syncingSales ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                Sync Sales
              </Button>
              <Button size="sm" onClick={syncCustomers} disabled={syncingCustomers || !user}>
                {syncingCustomers ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                Sync Customers
              </Button>
              <Button size="sm" onClick={syncItems} disabled={syncingItems || !user}>
                {syncingItems ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                Sync Items
              </Button>
              <Button size="sm" variant="outline" onClick={disconnectQbo} disabled={disconnecting || !user}>
                {disconnecting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Unplug className="mr-2 h-3.5 w-3.5" />}
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" onClick={connectQbo} disabled={!user}>
            <Link2 className="mr-2 h-3.5 w-3.5" />
            Connect to QuickBooks
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
