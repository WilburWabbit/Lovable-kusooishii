import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Link2, RefreshCw, Unplug } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/** Invoke an edge function with the current session token explicitly */
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

export function QboSettingsPanel() {
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<{ connected: boolean; realm_id?: string; last_updated?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingSales, setSyncingSales] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      // Status check doesn't need auth, safe to use default invoke
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

  useEffect(() => {
    fetchStatus();
  }, []);

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

  const syncPurchases = async () => {
    setSyncing(true);
    try {
      const data = await invokeWithAuth("qbo-sync-purchases");
      if (data?.error) throw new Error(data.error);
      const parts = [`${data.auto_processed ?? 0} auto-processed`];
      if (data.left_pending) parts.push(`${data.left_pending} pending review`);
      if (data.skipped_existing) parts.push(`${data.skipped_existing} unchanged`);
      if (data.skipped_no_items) parts.push(`${data.skipped_no_items} non-stock skipped`);
      if (data.cleaned_up) parts.push(`${data.cleaned_up} empty receipts cleaned up`);
      toast({
        title: "Sync complete",
        description: `${data.total} purchases: ${parts.join(", ")}.`,
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
    }
  };

  const [syncingSales, setSyncingSales] = useState(false);

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
            <div className="flex gap-2">
              <Button size="sm" onClick={syncPurchases} disabled={syncing || !user}>
                {syncing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                Sync Purchases
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
