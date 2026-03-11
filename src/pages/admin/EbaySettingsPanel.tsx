import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Link2, Unplug, RefreshCw, Package, ArrowUpDown, Bell, BellRing, ShieldCheck, Stethoscope } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SubResult {
  subscriptionId?: string;
  topicId?: string;
  topic?: string;
  status?: string;
  error?: string;
  reason?: string;
  testStatus?: "passed" | "failed" | "skipped";
}

export function EbaySettingsPanel() {
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<{ connected: boolean; last_updated?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [syncingInventory, setSyncingInventory] = useState(false);
  const [pushingStock, setPushingStock] = useState(false);
  const [settingUpNotifs, setSettingUpNotifs] = useState(false);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [testingSubs, setTestingSubs] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [subscriptions, setSubscriptions] = useState<SubResult[] | null>(null);
  const [destinationUrl, setDestinationUrl] = useState<string | null>(null);
  const [diagReport, setDiagReport] = useState<any>(null);
  const [configIssues, setConfigIssues] = useState<string[]>([]);
  const [destinationInfo, setDestinationInfo] = useState<{ url: string | null; expectedUrl: string | null; destinationId: string | null } | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ebay-auth", {
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

  useEffect(() => {
    fetchStatus();
  }, []);

  const connectEbay = async () => {
    try {
      const data = await invokeWithAuth("ebay-auth", { action: "authorize_url" });
      if ((data as any)?.error) throw new Error((data as any).error);
      window.location.href = (data as any).url;
    } catch (err) {
      toast({
        title: "Connection failed",
        description: err instanceof Error ? err.message : "Could not generate authorization URL",
        variant: "destructive",
      });
    }
  };

  const disconnectEbay = async () => {
    setDisconnecting(true);
    try {
      const data = await invokeWithAuth("ebay-auth", { action: "disconnect" });
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Disconnected", description: "eBay connection removed." });
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

  const syncOrders = async () => {
    setSyncingOrders(true);
    try {
      const data = await invokeWithAuth("ebay-sync", { action: "sync_orders" });
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: "Orders synced",
        description: `Synced: ${(data as any).orders_synced ?? 0} | Enriched: ${(data as any).orders_enriched ?? 0}`,
      });
    } catch (err) {
      toast({
        title: "Order sync failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSyncingOrders(false);
    }
  };

  const syncInventory = async () => {
    setSyncingInventory(true);
    try {
      const data = await invokeWithAuth("ebay-sync", { action: "sync_inventory" });
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: "Inventory synced",
        description: `${(data as any).inventory_synced ?? 0} listings synced.`,
      });
    } catch (err) {
      toast({
        title: "Inventory sync failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSyncingInventory(false);
    }
  };

  const pushStock = async () => {
    setPushingStock(true);
    try {
      const data = await invokeWithAuth("ebay-sync", { action: "push_stock" });
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: "Stock pushed",
        description: `${(data as any).stock_pushed ?? 0} SKUs updated on eBay.`,
      });
    } catch (err) {
      toast({
        title: "Stock push failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPushingStock(false);
    }
  };

  const setupNotifications = async () => {
    setSettingUpNotifs(true);
    try {
      const data = await invokeWithAuth<any>("ebay-sync", { action: "setup_notifications" });
      if (data?.error) throw new Error(data.error);
      const subs = data?.subscriptions || [];
      setSubscriptions(subs);
      toast({
        title: "Notifications configured",
        description: `${subs.length} topic(s) processed. Destination: ${data?.destinationId ? "active" : "unknown"}`,
      });
    } catch (err) {
      toast({
        title: "Notification setup failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSettingUpNotifs(false);
    }
  };

  const getSubscriptions = async () => {
    setLoadingSubs(true);
    try {
      const data = await invokeWithAuth<any>("ebay-sync", { action: "get_subscriptions" });
      setSubscriptions(data?.subscriptions || []);
      if (data?.destinationUrl) setDestinationUrl(data.destinationUrl);
    } catch (err) {
      toast({
        title: "Failed to load subscriptions",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoadingSubs(false);
    }
  };

  const diagnoseNotifications = async () => {
    setDiagnosing(true);
    try {
      const data = await invokeWithAuth<any>("ebay-sync", { action: "diagnose_notifications" });
      setDiagReport(data);
      if (data?.issues?.length > 0) {
        toast({
          title: `${data.issues.length} issue(s) detected`,
          description: data.issues[0],
          variant: "destructive",
        });
      } else {
        toast({ title: "No issues detected", description: "Notification setup looks healthy." });
      }
    } catch (err) {
      toast({
        title: "Diagnosis failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDiagnosing(false);
    }
  };

  const testSubscriptions = async () => {
    setTestingSubs(true);
    try {
      const data = await invokeWithAuth<any>("ebay-sync", { action: "test_subscriptions" });
      if (data?.error) throw new Error(data.error);
      const results: any[] = data?.results || [];
      const issues: string[] = data?.configIssues || [];
      setConfigIssues(issues);
      if (data?.destination) setDestinationInfo(data.destination);

      const passed = results.filter((r: any) => r.status === "passed").length;
      const failed = results.filter((r: any) => r.status === "failed").length;
      const skipped = results.filter((r: any) => r.status === "skipped").length;

      // Merge test results into subscriptions display
      setSubscriptions((prev) => {
        if (!prev) return results.map((r: any) => ({ ...r, testStatus: r.status }));
        return prev.map((sub) => {
          const match = results.find(
            (r: any) => r.subscriptionId === sub.subscriptionId || r.topicId === (sub.topicId || sub.topic)
          );
          return match ? { ...sub, testStatus: match.status, error: match.error, reason: match.reason } : sub;
        });
      });

      if (failed > 0) {
        toast({
          title: "Subscription tests completed with failures",
          description: `${passed} passed, ${failed} failed, ${skipped} skipped`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "All subscription tests passed",
          description: `${passed} passed, ${skipped} skipped`,
        });
      }
    } catch (err) {
      toast({
        title: "Subscription test failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setTestingSubs(false);
    }
  };

  const getSubBadgeClass = (sub: SubResult) => {
    if (sub.testStatus === "passed") return "text-green-600 border-green-300 bg-green-50 text-xs";
    if (sub.testStatus === "failed") return "text-destructive border-destructive/30 bg-destructive/5 text-xs";
    if (sub.testStatus === "skipped") return "text-amber-600 border-amber-300 bg-amber-50 text-xs";
    if (sub.status === "ENABLED") return "text-green-600 border-green-300 bg-green-50 text-xs";
    if (sub.status === "error") return "text-destructive border-destructive/30 bg-destructive/5 text-xs";
    return "text-muted-foreground text-xs";
  };

  const getSubLabel = (sub: SubResult) => {
    const topic = sub.topicId || sub.topic || "Unknown";
    if (sub.testStatus === "passed") return `${topic}: ✓ passed`;
    if (sub.testStatus === "failed") return `${topic}: ✗ failed`;
    if (sub.testStatus === "skipped") return `${topic}: ⊘ ${sub.reason || "skipped"}`;
    return `${topic}: ${sub.status || "unknown"}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">eBay</CardTitle>
        <CardDescription className="font-body text-xs">
          Connect to eBay to sync orders, inventory, and listings.
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
            </div>
            {status.last_updated && (
              <p className="font-body text-xs text-muted-foreground">
                Last token update: {new Date(status.last_updated).toLocaleString()}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={syncOrders} disabled={syncingOrders || !user}>
                {syncingOrders ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                Sync Orders
              </Button>
              <Button size="sm" variant="outline" onClick={syncInventory} disabled={syncingInventory || !user}>
                {syncingInventory ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Package className="mr-2 h-3.5 w-3.5" />}
                Sync Inventory
              </Button>
              <Button size="sm" variant="outline" onClick={pushStock} disabled={pushingStock || !user}>
                {pushingStock ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <ArrowUpDown className="mr-2 h-3.5 w-3.5" />}
                Push Stock
              </Button>
              <Button size="sm" variant="outline" onClick={setupNotifications} disabled={settingUpNotifs || !user}>
                {settingUpNotifs ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Bell className="mr-2 h-3.5 w-3.5" />}
                Setup Notifications
              </Button>
              <Button size="sm" variant="outline" onClick={getSubscriptions} disabled={loadingSubs || !user}>
                {loadingSubs ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <BellRing className="mr-2 h-3.5 w-3.5" />}
                View Subscriptions
              </Button>
              <Button size="sm" variant="outline" onClick={testSubscriptions} disabled={testingSubs || !user}>
                {testingSubs ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-2 h-3.5 w-3.5" />}
                Test Subscriptions
              </Button>
              <Button size="sm" variant="outline" onClick={diagnoseNotifications} disabled={diagnosing || !user}>
                {diagnosing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="mr-2 h-3.5 w-3.5" />}
                Diagnose
              </Button>
              <Button size="sm" variant="outline" onClick={disconnectEbay} disabled={disconnecting || !user}>
                {disconnecting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Unplug className="mr-2 h-3.5 w-3.5" />}
                Disconnect
              </Button>
            </div>

            {/* Configuration issues from test */}
            {configIssues.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="font-body text-xs font-medium text-destructive">Configuration Issues</p>
                <div className="space-y-0.5">
                  {configIssues.map((issue, i) => (
                    <p key={i} className="font-body text-xs text-destructive">⚠ {issue}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Destination info from test */}
            {destinationInfo && (
              <div className="mt-2 space-y-0.5">
                <p className="font-body text-xs text-muted-foreground">
                  Registered endpoint: <code className="text-xs bg-muted px-1 py-0.5 rounded">{destinationInfo.url || "none"}</code>
                </p>
                <p className="font-body text-xs text-muted-foreground">
                  Expected endpoint: <code className="text-xs bg-muted px-1 py-0.5 rounded">{destinationInfo.expectedUrl || "unknown"}</code>
                </p>
              </div>
            )}

            {/* Subscription status display */}
            {subscriptions && (
              <div className="mt-3 space-y-1">
                <p className="font-body text-xs font-medium text-foreground">Notification Subscriptions</p>
                {subscriptions.length === 0 ? (
                  <p className="font-body text-xs text-muted-foreground">No active subscriptions.</p>
                ) : (
                  <div className="space-y-1">
                    <div className="flex flex-wrap gap-1.5">
                      {subscriptions.map((sub, i) => (
                        <Badge
                          key={sub.subscriptionId || i}
                          variant="outline"
                          className={getSubBadgeClass(sub)}
                          title={sub.error || sub.reason || undefined}
                        >
                          {getSubLabel(sub)}
                        </Badge>
                      ))}
                    </div>
                    {subscriptions.some((s) => s.testStatus === "failed") && (
                      <div className="mt-2 space-y-0.5">
                        {subscriptions
                          .filter((s) => s.testStatus === "failed")
                          .map((s, i) => (
                            <p key={i} className="font-body text-xs text-destructive">
                              {s.topicId || s.topic}: {s.error || "Verification failed"}
                            </p>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Destination URL from view subscriptions */}
            {destinationUrl && !destinationInfo && (
              <div className="mt-2">
                <p className="font-body text-xs text-muted-foreground">
                  Destination: <code className="text-xs bg-muted px-1 py-0.5 rounded">{destinationUrl}</code>
                </p>
              </div>
            )}

            {/* Diagnostic report */}
            {diagReport && (
              <div className="mt-3 space-y-1.5">
                <p className="font-body text-xs font-medium text-foreground">Diagnostic Report</p>
                {diagReport.issues?.length === 0 ? (
                  <p className="font-body text-xs text-muted-foreground">✓ No issues detected</p>
                ) : (
                  <div className="space-y-0.5">
                    {diagReport.issues?.map((issue: string, i: number) => (
                      <p key={i} className="font-body text-xs text-destructive">⚠ {issue}</p>
                    ))}
                  </div>
                )}
                <p className="font-body text-xs text-muted-foreground">
                  Notifications received: {diagReport.notificationCount ?? "unknown"}
                </p>
              </div>
            )}
          </div>
        ) : (
          <Button size="sm" onClick={connectEbay} disabled={!user}>
            <Link2 className="mr-2 h-3.5 w-3.5" />
            Connect to eBay
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
