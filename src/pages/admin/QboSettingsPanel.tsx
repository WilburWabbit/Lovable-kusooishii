import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Link2, RefreshCw, Unplug } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function QboSettingsPanel() {
  const { toast } = useToast();
  const [status, setStatus] = useState<{ connected: boolean; realm_id?: string; last_updated?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

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

  useEffect(() => {
    fetchStatus();
  }, []);

  const connectQbo = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("qbo-auth", {
        body: { action: "authorize_url" },
      });
      if (error) throw error;
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
      const { data, error } = await supabase.functions.invoke("qbo-auth", {
        body: { action: "disconnect", realm_id: status.realm_id },
      });
      if (error) throw error;
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
      const { data, error } = await supabase.functions.invoke("qbo-sync-purchases");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({
        title: "Sync complete",
        description: `Synced ${data.total} purchases from QuickBooks.`,
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">QuickBooks Online</CardTitle>
        <CardDescription className="font-body text-xs">
          Connect to QBO to pull purchase receipts for inventory intake.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
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
              <Button size="sm" onClick={syncPurchases} disabled={syncing}>
                {syncing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                Sync Purchases
              </Button>
              <Button size="sm" variant="outline" onClick={disconnectQbo} disabled={disconnecting}>
                {disconnecting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Unplug className="mr-2 h-3.5 w-3.5" />}
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" onClick={connectQbo}>
            <Link2 className="mr-2 h-3.5 w-3.5" />
            Connect to QuickBooks
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
