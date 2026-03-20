import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Link2, RefreshCw, Unplug, Square, Scale, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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
  const [salesSyncProgress, setSalesSyncProgress] = useState<{ current: number; total: number; month: string } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncingCustomers, setSyncingCustomers] = useState(false);
  const [syncingItems, setSyncingItems] = useState(false);
  const [reconcilingStock, setReconcilingStock] = useState(false);
  const [reconcileDetails, setReconcileDetails] = useState<any[] | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildPhase, setRebuildPhase] = useState<string | null>(null);
  const cancelPurchasesRef = useRef(false);
  const cancelSalesRef = useRef(false);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const data = await invokeWithAuth<{ connected: boolean; realm_id?: string; last_updated?: string }>("qbo-auth", { action: "status" });
      if (data && 'error' in data) throw new Error(String((data as any).error));
      setStatus(data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  const syncPurchases = async () => {
    if (!status?.connected) {
      toast({
        title: "QBO not connected",
        description: "Connect to QuickBooks Online first before syncing purchases.",
        variant: "destructive",
      });
      return;
    }
    setSyncing(true);
    cancelPurchasesRef.current = false;
    const months = generateMonthList();
    const totals = {
      total: 0, auto_processed: 0, left_pending: 0,
      skipped_existing: 0, skipped_no_items: 0, cleaned_up: 0,
      backfilled_tax_codes: 0, backfilled_stock_links: 0,
    };

    try {
      for (let i = 0; i < months.length; i++) {
        if (cancelPurchasesRef.current) break;
        const month = months[i];
        setSyncProgress({ current: i + 1, total: months.length, month });

        const data = await invokeWithAuth<Record<string, any>>("qbo-sync-purchases", { month });
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
        title: cancelPurchasesRef.current ? "Sync stopped" : "Sync complete",
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

  const stopPurchaseSync = () => { cancelPurchasesRef.current = true; };
  const stopSalesSync = () => { cancelSalesRef.current = true; };

  const connectQbo = async () => {
    try {
      const data = await invokeWithAuth<Record<string, any>>("qbo-auth", { action: "authorize_url" });
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
      const data = await invokeWithAuth<Record<string, any>>("qbo-auth", { action: "disconnect", realm_id: status.realm_id });
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
    if (!status?.connected) {
      toast({ title: "QBO not connected", description: "Connect to QuickBooks Online first.", variant: "destructive" });
      return;
    }
    setSyncingCustomers(true);
    try {
      const data = await invokeWithAuth<Record<string, any>>("qbo-sync-customers");
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
    if (!status?.connected) {
      toast({ title: "QBO not connected", description: "Connect to QuickBooks Online first.", variant: "destructive" });
      return;
    }
    setSyncingItems(true);
    try {
      const data = await invokeWithAuth<Record<string, any>>("qbo-sync-items");
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
    if (!status?.connected) {
      toast({
        title: "QBO not connected",
        description: "Connect to QuickBooks Online first before syncing sales.",
        variant: "destructive",
      });
      return;
    }
    setSyncingSales(true);
    cancelSalesRef.current = false;
    const months = generateMonthList();
    const totals = {
      sales_created: 0, sales_skipped: 0, stock_matched: 0,
      stock_missing: 0, refunds_created: 0, refunds_skipped: 0,
      channel_listings_updated: 0,
    };

    try {
      for (let i = 0; i < months.length; i++) {
        if (cancelSalesRef.current) break;
        const month = months[i];
        setSalesSyncProgress({ current: i + 1, total: months.length, month });

        // First invocation: land + process first chunk
        let isFirstCall = true;
        let hasMore = true;

        while (hasMore && !cancelSalesRef.current) {
          let data: Record<string, any>;
          try {
            data = await invokeWithAuth<Record<string, any>>("qbo-sync-sales", {
              month,
              chunk_size: 25,
              skip_landing: !isFirstCall, // Only land on first call per month
            });
          } catch {
            data = await invokeWithAuth<Record<string, any>>("admin-data", {
              action: "proxy-function",
              function: "qbo-sync-sales",
              body: { month, chunk_size: 25, skip_landing: !isFirstCall },
            });
          }
          if (data?.error) throw new Error(data.error);

          totals.sales_created += data.sales_created ?? 0;
          totals.sales_skipped += data.sales_skipped ?? 0;
          totals.stock_matched += data.stock_matched ?? 0;
          totals.stock_missing += data.stock_missing ?? 0;
          totals.refunds_created += data.refunds_created ?? 0;
          totals.refunds_skipped += data.refunds_skipped ?? 0;
          totals.channel_listings_updated += data.channel_listings_updated ?? 0;

          hasMore = data.has_more === true;
          isFirstCall = false;

          // Update progress with remaining count
          if (hasMore && data.remaining_pending) {
            setSalesSyncProgress({
              current: i + 1,
              total: months.length,
              month: `${month} (${data.remaining_pending} pending)`,
            });
          }
        }
      }

      const parts: string[] = [];
      if (totals.sales_created) parts.push(`${totals.sales_created} sales imported`);
      if (totals.sales_skipped) parts.push(`${totals.sales_skipped} sales unchanged`);
      if (totals.stock_matched) parts.push(`${totals.stock_matched} stock matched`);
      if (totals.stock_missing) parts.push(`${totals.stock_missing} stock missing`);
      if (totals.refunds_created) parts.push(`${totals.refunds_created} refunds imported`);
      if (totals.refunds_skipped) parts.push(`${totals.refunds_skipped} refunds unchanged`);
      if (totals.channel_listings_updated) parts.push(`${totals.channel_listings_updated} channel listings updated`);
      toast({
        title: cancelSalesRef.current ? "Sales sync stopped" : "Sales sync complete",
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
      setSalesSyncProgress(null);
    }
  };

  const reconcileStock = async () => {
    setReconcilingStock(true);
    setReconcileDetails(null);
    try {
      const data = await invokeWithAuth<Record<string, any>>("admin-data", { action: "reconcile-stock" });
      if (data?.error) throw new Error(data.error);
      const parts: string[] = [];
      if (data.stock_reopened) parts.push(`${data.stock_reopened} incorrectly closed units reopened`);
      if (data.stock_closed) parts.push(`${data.stock_closed} sold units closed`);
      parts.push(`${data.total_checked ?? 0} SKUs checked`);
      if (data.in_sync) parts.push(`${data.in_sync} in sync`);
      if (data.app_higher) parts.push(`${data.app_higher} app higher`);
      if (data.qbo_higher) parts.push(`${data.qbo_higher} QBO higher`);
      toast({
        title: "Stock reconciliation complete",
        description: parts.join(", ") + ".",
      });
      if (data.details?.length > 0) {
        setReconcileDetails(data.details);
      }
    } catch (err) {
      toast({
        title: "Stock reconciliation failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setReconcilingStock(false);
    }
  };

  const rebuildFromQbo = async () => {
    if (!status?.connected) return;
    setRebuilding(true);
    setRebuildPhase("Resetting data…");
    try {
      // Phase 1: Reset
      const resetData = await invokeWithAuth<Record<string, any>>("admin-data", { action: "rebuild-from-qbo" });
      if (resetData?.error) throw new Error(resetData.error);
      toast({
        title: "Reset complete",
        description: `${resetData.receipts_reset ?? 0} receipts reset, ${resetData.orders_deleted ?? 0} orders deleted, ${resetData.stock_written_off ?? 0} stock written off.`,
      });

      // Phase 2: Sync Purchases
      setRebuildPhase("Syncing purchases…");
      await syncPurchases();

      // Phase 3: Sync Sales
      setRebuildPhase("Syncing sales…");
      await syncSales();

      // Phase 4: Reconcile
      setRebuildPhase("Reconciling stock…");
      await reconcileStock();

      toast({ title: "Rebuild complete", description: "All QBO data has been resynchronised." });
    } catch (err) {
      toast({
        title: "Rebuild failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRebuilding(false);
      setRebuildPhase(null);
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
                    Syncing purchases {syncProgress.month}… ({syncProgress.current} of {syncProgress.total})
                  </p>
                  <Button size="sm" variant="ghost" onClick={stopPurchaseSync} className="h-6 px-2 text-xs">
                    <Square className="mr-1 h-3 w-3" />
                    Stop
                  </Button>
                </div>
                <Progress value={(syncProgress.current / syncProgress.total) * 100} className="h-2" />
              </div>
            )}

            {/* Progress indicator for sales sync */}
            {salesSyncProgress && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="font-body text-xs text-muted-foreground">
                    Syncing sales {salesSyncProgress.month}… ({salesSyncProgress.current} of {salesSyncProgress.total})
                  </p>
                  <Button size="sm" variant="ghost" onClick={stopSalesSync} className="h-6 px-2 text-xs">
                    <Square className="mr-1 h-3 w-3" />
                    Stop
                  </Button>
                </div>
                <Progress value={(salesSyncProgress.current / salesSyncProgress.total) * 100} className="h-2" />
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
              <Button size="sm" variant="secondary" onClick={reconcileStock} disabled={reconcilingStock || !user}>
                {reconcilingStock ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Scale className="mr-2 h-3.5 w-3.5" />}
                Reconcile Stock
              </Button>
              <Button size="sm" variant="outline" onClick={disconnectQbo} disabled={disconnecting || !user}>
                {disconnecting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Unplug className="mr-2 h-3.5 w-3.5" />}
                Disconnect
              </Button>
            </div>

            {/* Stock reconciliation discrepancy details */}
            {reconcileDetails && reconcileDetails.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-display text-sm font-medium">Stock Discrepancies</h4>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setReconcileDetails(null)}>
                    Dismiss
                  </Button>
                </div>
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left px-3 py-1.5 font-medium">SKU</th>
                        <th className="text-right px-3 py-1.5 font-medium">App</th>
                        <th className="text-right px-3 py-1.5 font-medium">QBO</th>
                        <th className="text-right px-3 py-1.5 font-medium">Diff</th>
                        <th className="text-left px-3 py-1.5 font-medium">Direction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconcileDetails.map((d: any, i: number) => {
                        const appQty = d.app_qty ?? d.app_available ?? 0;
                        const qboQty = d.qbo_qty ?? 0;
                        const diff = d.diff ?? Math.abs(appQty - qboQty);
                        const isAppHigher = d.direction === "app_higher" || appQty > qboQty;
                        return (
                          <tr key={i} className="border-b last:border-0">
                            <td className="px-3 py-1.5 font-mono">{d.sku_code}</td>
                            <td className="text-right px-3 py-1.5">{appQty}</td>
                            <td className="text-right px-3 py-1.5">{qboQty}</td>
                            <td className="text-right px-3 py-1.5 font-medium">{diff}</td>
                            <td className="px-3 py-1.5">
                              <Badge variant="outline" className={
                                isAppHigher
                                  ? "text-amber-600 border-amber-300 bg-amber-50"
                                  : "text-blue-600 border-blue-300 bg-blue-50"
                              }>
                                {isAppHigher ? "App higher" : "QBO higher"}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
