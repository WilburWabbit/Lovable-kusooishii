import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Link2, Unplug, RefreshCw, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function GmcSettingsPanel() {
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<{
    connected: boolean;
    merchant_id?: string;
    last_updated?: string;
    expired?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [syncingStatus, setSyncingStatus] = useState(false);
  const [merchantIdInput, setMerchantIdInput] = useState("");
  const [publishResult, setPublishResult] = useState<{
    published: number;
    errors: number;
    skipped: number;
  } | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const data = await invokeWithAuth<{
        connected: boolean;
        merchant_id?: string;
        last_updated?: string;
        expired?: boolean;
      }>("gmc-auth", { action: "status" });
      if ((data as any)?.error) throw new Error((data as any).error);
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

  const connectGmc = async () => {
    if (!merchantIdInput.trim()) {
      toast({
        title: "Merchant ID required",
        description: "Please enter your Google Merchant Centre account ID.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Store merchant_id for the callback page
      localStorage.setItem("gmc_merchant_id", merchantIdInput.trim());

      const data = await invokeWithAuth("gmc-auth", { action: "authorize_url" });
      if ((data as any)?.error) throw new Error((data as any).error);
      window.location.href = (data as any).url;
    } catch (err) {
      localStorage.removeItem("gmc_merchant_id");
      toast({
        title: "Connection failed",
        description: err instanceof Error ? err.message : "Could not generate authorization URL",
        variant: "destructive",
      });
    }
  };

  const disconnectGmc = async () => {
    setDisconnecting(true);
    try {
      const data = await invokeWithAuth("gmc-auth", { action: "disconnect" });
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Disconnected", description: "Google Merchant Centre connection removed." });
      setStatus({ connected: false });
      setPublishResult(null);
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

  const publishAll = async () => {
    setPublishing(true);
    setPublishResult(null);
    try {
      const data = await invokeWithAuth<{
        published: number;
        errors: number;
        skipped: number;
        errorDetails?: string[];
      }>("gmc-sync", { action: "publish_all" });
      if ((data as any)?.error) throw new Error((data as any).error);
      setPublishResult({
        published: data.published,
        errors: data.errors,
        skipped: data.skipped,
      });
      toast({
        title: "Publish complete",
        description: `Published: ${data.published} | Errors: ${data.errors} | Skipped: ${data.skipped}`,
      });
    } catch (err) {
      toast({
        title: "Publish failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPublishing(false);
    }
  };

  const syncStatus = async () => {
    setSyncingStatus(true);
    try {
      const data = await invokeWithAuth<{
        gmc_products: number;
        updated: number;
      }>("gmc-sync", { action: "sync_status" });
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: "Status synced",
        description: `${data.gmc_products} GMC products found, ${data.updated} local listings updated.`,
      });
    } catch (err) {
      toast({
        title: "Sync failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSyncingStatus(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">Google Merchant Centre</CardTitle>
        <CardDescription className="font-body text-xs">
          Publish products to Google Shopping via Merchant Centre.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || authLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : status?.connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={
                  status.expired
                    ? "text-amber-600 border-amber-300 bg-amber-50"
                    : "text-green-600 border-green-300 bg-green-50"
                }
              >
                {status.expired ? "Token Expired" : "Connected"}
              </Badge>
              {status.merchant_id && (
                <span className="font-body text-xs text-muted-foreground">
                  Merchant ID: {status.merchant_id}
                </span>
              )}
            </div>
            {status.last_updated && (
              <p className="font-body text-xs text-muted-foreground">
                Last token update: {new Date(status.last_updated).toLocaleString()}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={publishAll} disabled={publishing || !user}>
                {publishing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
                Publish All to GMC
              </Button>
              <Button size="sm" variant="outline" onClick={syncStatus} disabled={syncingStatus || !user}>
                {syncingStatus ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                Sync Status
              </Button>
              <Button size="sm" variant="outline" onClick={disconnectGmc} disabled={disconnecting || !user}>
                {disconnecting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Unplug className="mr-2 h-3.5 w-3.5" />}
                Disconnect
              </Button>
            </div>

            {publishResult && (
              <div className="mt-2 space-y-0.5">
                <p className="font-body text-xs text-muted-foreground">
                  Last publish: {publishResult.published} published, {publishResult.errors} errors, {publishResult.skipped} skipped
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="gmc-merchant-id" className="font-body text-xs">
                Merchant Centre Account ID
              </Label>
              <Input
                id="gmc-merchant-id"
                placeholder="e.g. 123456789"
                value={merchantIdInput}
                onChange={(e) => setMerchantIdInput(e.target.value)}
                className="max-w-xs"
              />
            </div>
            <Button size="sm" onClick={connectGmc} disabled={!user}>
              <Link2 className="mr-2 h-3.5 w-3.5" />
              Connect to Google Merchant Centre
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
