import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Link2, RefreshCw, Unplug, Square, Scale, RotateCcw, Play } from "lucide-react";
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
  const [processing, setProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState<string | null>(null);
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

  // ── Land-only sync functions ──

  const syncPurchases = async () => {
    if (!status?.connected) {
      toast({ title: "QBO not connected", description: "Connect to QuickBooks Online first.", variant: "destructive" });
      return;
    }
    setSyncing(true);
    cancelPurchasesRef.current = false;
    const months = generateMonthList();
    let totalLanded = 0, totalSkipped = 0;

    try {
      for (let i = 0; i < months.length; i++) {
        if (cancelPurchasesRef.current) break;
        const month = months[i];
        setSyncProgress({ current: i + 1, total: months.length, month });
        const data = await invokeWithAuth<Record<string, any>>("qbo-sync-purchases", { month });
        if (data?.error) throw new Error(data.error);
        totalLanded += data.landed ?? 0;
        totalSkipped += data.skipped ?? 0;
      }
      toast({
        title: cancelPurchasesRef.current ? "Sync stopped" : "Purchases landed",
        description: `${totalLanded} landed, ${totalSkipped} unchanged.`,
      });
    } catch (err) {
      toast({ title: "Sync failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const syncSales = async () => {
    if (!status?.connected) {
      toast({ title: "QBO not connected", description: "Connect to QuickBooks Online first.", variant: "destructive" });
      return;
    }
    setSyncingSales(true);
    cancelSalesRef.current = false;
    const months = generateMonthList();
    let totalLanded = 0, totalSkipped = 0;

    try {
      for (let i = 0; i < months.length; i++) {
        if (cancelSalesRef.current) break;
        const month = months[i];
        setSalesSyncProgress({ current: i + 1, total: months.length, month });
        const data = await invokeWithAuth<Record<string, any>>("qbo-sync-sales", { month });
        if (data?.error) throw new Error(data.error);
        totalLanded += (data.sales_landed ?? 0) + (data.refunds_landed ?? 0);
        totalSkipped += (data.sales_skipped ?? 0) + (data.refunds_skipped ?? 0);
      }
      toast({
        title: cancelSalesRef.current ? "Sales sync stopped" : "Sales landed",
        description: `${totalLanded} landed, ${totalSkipped} unchanged.`,
      });
    } catch (err) {
      toast({ title: "Sales sync failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSyncingSales(false);
      setSalesSyncProgress(null);
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
      toast({ title: "Customers landed", description: `${data.landed ?? 0} landed, ${data.skipped ?? 0} unchanged.` });
    } catch (err) {
      toast({ title: "Customer sync failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
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
      toast({ title: "Items landed", description: `${data.landed ?? 0} landed, ${data.skipped ?? 0} unchanged.` });
    } catch (err) {
      toast({ title: "Item sync failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSyncingItems(false);
    }
  };

  // ── Process pending (centralized processor) ──

  const processPending = async (entityType?: string) => {
    setProcessing(true);
    setProcessProgress(entityType ? `Processing ${entityType}…` : "Processing all pending…");
    try {
      const params: Record<string, any> = { batch_size: 50 };
      if (entityType) params.entity_type = entityType;
      const data = await invokeWithAuth<Record<string, any>>("qbo-process-pending", params);
      if (data?.error) throw new Error(data.error);

      const r = data.results ?? {};
      const parts: string[] = [];
      if (r.items?.processed) parts.push(`${r.items.processed} items`);
      if (r.purchases?.processed) parts.push(`${r.purchases.processed} purchases`);
      if (r.sales?.processed) parts.push(`${r.sales.processed} sales`);
      if (r.refunds?.processed) parts.push(`${r.refunds.processed} refunds`);
      if (r.customers?.processed) parts.push(`${r.customers.processed} customers`);
      if (data.total_remaining) parts.push(`${data.total_remaining} remaining`);

      toast({
        title: "Processing complete",
        description: parts.length > 0 ? parts.join(", ") + "." : "Nothing to process.",
      });
    } catch (err) {
      toast({ title: "Processing failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setProcessing(false);
      setProcessProgress(null);
    }
  };

  // ── Reconcile stock ──

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
      toast({ title: "Stock reconciliation complete", description: parts.join(", ") + "." });
      if (data.details?.length > 0) setReconcileDetails(data.details);
    } catch (err) {
      toast({ title: "Stock reconciliation failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setReconcilingStock(false);
    }
  };

  // ── Connection ──

  const connectQbo = async () => {
    try {
      const data = await invokeWithAuth<Record<string, any>>("qbo-auth", { action: "authorize_url" });
      if (data?.error) throw new Error(data.error);
      window.location.href = data.url;
    } catch (err) {
      toast({ title: "Connection failed", description: err instanceof Error ? err.message : "Could not generate authorization URL", variant: "destructive" });
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
      toast({ title: "Disconnect failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setDisconnecting(false);
    }
  };

  // ── Rebuild from QBO ──

  const rebuildFromQbo = async () => {
    if (!status?.connected) return;
    setRebuilding(true);
    try {
      // Phase 1: Reset canonical data
      setRebuildPhase("Resetting canonical data…");
      const resetData = await invokeWithAuth<Record<string, any>>("admin-data", { action: "rebuild-from-qbo" });
      if (resetData?.error) throw new Error(resetData.error);
      toast({
        title: "Reset complete",
        description: `${resetData.receipts_deleted ?? 0} receipts deleted, ${resetData.orders_deleted ?? 0} orders deleted, ${resetData.stock_deleted ?? 0} stock deleted. Landing tables reset: ${resetData.purchases_reset ?? 0} purchases, ${resetData.sales_reset ?? 0} sales, ${resetData.refunds_reset ?? 0} refunds.`,
      });

      // Phase 2: Process all pending (items → purchases → sales → refunds → customers)
      setRebuildPhase("Processing all pending records…");
      // Process in a loop until nothing remains
      let totalProcessed = 0;
      for (let iteration = 0; iteration < 200; iteration++) {
        const data = await invokeWithAuth<Record<string, any>>("qbo-process-pending", { batch_size: 50 });
        if (data?.error) throw new Error(data.error);
        const r = data.results ?? {};
        const committed = (r.items?.processed ?? 0) + (r.purchases?.processed ?? 0) +
          (r.sales?.processed ?? 0) + (r.refunds?.processed ?? 0) + (r.customers?.processed ?? 0);
        totalProcessed += committed;
        setRebuildPhase(`Processed ${totalProcessed} records (${data.total_remaining ?? 0} remaining)…`);
        if (!data.has_more) break;
      }

      // Phase 3: Reconcile stock
      setRebuildPhase("Reconciling stock…");
      await reconcileStock();

      toast({ title: "Rebuild complete", description: `All QBO data has been reprocessed. ${totalProcessed} records committed.` });
    } catch (err) {
      toast({ title: "Rebuild failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setRebuilding(false);
      setRebuildPhase(null);
    }
  };

  const stopPurchaseSync = () => { cancelPurchasesRef.current = true; };
  const stopSalesSync = () => { cancelSalesRef.current = true; };

  const anyBusy = syncing || syncingSales || syncingCustomers || syncingItems || processing || reconcilingStock || rebuilding;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">QuickBooks Online</CardTitle>
        <CardDescription className="font-body text-xs">
          Connect to QBO to sync purchases, sales, items, and customers. Data lands in staging tables then gets processed centrally.
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

            {/* Progress indicators */}
            {syncProgress && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="font-body text-xs text-muted-foreground">
                    Landing purchases {syncProgress.month}… ({syncProgress.current} of {syncProgress.total})
                  </p>
                  <Button size="sm" variant="ghost" onClick={stopPurchaseSync} className="h-6 px-2 text-xs">
                    <Square className="mr-1 h-3 w-3" /> Stop
                  </Button>
                </div>
                <Progress value={(syncProgress.current / syncProgress.total) * 100} className="h-2" />
              </div>
            )}

            {salesSyncProgress && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="font-body text-xs text-muted-foreground">
                    Landing sales {salesSyncProgress.month}… ({salesSyncProgress.current} of {salesSyncProgress.total})
                  </p>
                  <Button size="sm" variant="ghost" onClick={stopSalesSync} className="h-6 px-2 text-xs">
                    <Square className="mr-1 h-3 w-3" /> Stop
                  </Button>
                </div>
                <Progress value={(salesSyncProgress.current / salesSyncProgress.total) * 100} className="h-2" />
              </div>
            )}

            {processProgress && (
              <p className="font-body text-xs text-muted-foreground">{processProgress}</p>
            )}

            {rebuildPhase && (
              <p className="font-body text-xs text-muted-foreground">{rebuildPhase}</p>
            )}

            {/* Action buttons */}
            <div className="space-y-2">
              {/* Row 1: Land data */}
              <div>
                <p className="font-body text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Land Data</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={syncPurchases} disabled={anyBusy || !user}>
                    {syncing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                    Purchases
                  </Button>
                  <Button size="sm" onClick={syncSales} disabled={anyBusy || !user}>
                    {syncingSales ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                    Sales
                  </Button>
                  <Button size="sm" onClick={syncCustomers} disabled={anyBusy || !user}>
                    {syncingCustomers ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                    Customers
                  </Button>
                  <Button size="sm" onClick={syncItems} disabled={anyBusy || !user}>
                    {syncingItems ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                    Items
                  </Button>
                </div>
              </div>

              {/* Row 2: Process & Reconcile */}
              <div>
                <p className="font-body text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Process & Reconcile</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => processPending()} disabled={anyBusy || !user}>
                    {processing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-2 h-3.5 w-3.5" />}
                    Process Pending
                  </Button>
                  <Button size="sm" variant="secondary" onClick={reconcileStock} disabled={anyBusy || !user}>
                    {reconcilingStock ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Scale className="mr-2 h-3.5 w-3.5" />}
                    Reconcile Stock
                  </Button>
                </div>
              </div>

              {/* Row 3: Dangerous actions */}
              <div>
                <p className="font-body text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Admin</p>
                <div className="flex flex-wrap gap-2">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="destructive" disabled={anyBusy || !user}>
                        {rebuilding ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-2 h-3.5 w-3.5" />}
                        Rebuild from QBO
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Rebuild from QBO?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will delete all receipts, stock units, and QBO sales orders, reset all landing tables to pending, then reprocess everything from staged data. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={rebuildFromQbo}>Yes, rebuild</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button size="sm" variant="outline" onClick={disconnectQbo} disabled={anyBusy || !user}>
                    {disconnecting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Unplug className="mr-2 h-3.5 w-3.5" />}
                    Disconnect
                  </Button>
                </div>
              </div>
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
                        <th className="text-left px-3 py-1.5 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconcileDetails.map((d: any, i: number) => {
                        const isAppHigher = d.direction === "app_higher";
                        return (
                          <tr key={i} className="border-b last:border-0">
                            <td className="px-3 py-1.5 font-mono">{d.sku_code}</td>
                            <td className="text-right px-3 py-1.5">{d.app_qty ?? 0}</td>
                            <td className="text-right px-3 py-1.5">{d.qbo_qty ?? 0}</td>
                            <td className="text-right px-3 py-1.5 font-medium">{d.diff ?? 0}</td>
                            <td className="px-3 py-1.5">
                              <Badge variant="outline" className={
                                isAppHigher
                                  ? "text-amber-600 border-amber-300 bg-amber-50"
                                  : "text-blue-600 border-blue-300 bg-blue-50"
                              }>
                                {d.action ?? (isAppHigher ? "write-off" : "backfill")}
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
