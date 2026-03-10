import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Link2, Unplug, RefreshCw, Package, ArrowUpDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

export function EbaySettingsPanel() {
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<{ connected: boolean; last_updated?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [syncingInventory, setSyncingInventory] = useState(false);
  const [pushingStock, setPushingStock] = useState(false);

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

  const disconnectEbay = async () => {
    setDisconnecting(true);
    try {
      const data = await invokeWithAuth("ebay-auth", { action: "disconnect" });
      if (data?.error) throw new Error(data.error);
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
      if (data?.error) throw new Error(data.error);
      toast({
        title: "Orders synced",
        description: `Synced: ${data.orders_synced ?? 0} | Enriched: ${data.orders_enriched ?? 0}`,
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
      if (data?.error) throw new Error(data.error);
      toast({
        title: "Inventory synced",
        description: `${data.inventory_synced ?? 0} listings synced.`,
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
      if (data?.error) throw new Error(data.error);
      toast({
        title: "Stock pushed",
        description: `${data.stock_pushed ?? 0} SKUs updated on eBay.`,
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
              <Button size="sm" variant="outline" onClick={disconnectEbay} disabled={disconnecting || !user}>
                {disconnecting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Unplug className="mr-2 h-3.5 w-3.5" />}
                Disconnect
              </Button>
            </div>
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
