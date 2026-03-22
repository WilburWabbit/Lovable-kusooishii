import { useState, useEffect } from "react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle } from "lucide-react";
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
} from "@/components/ui/alert-dialog";

export function StripeSettingsPanel() {
  const { toast } = useToast();
  const [testMode, setTestMode] = useState(false);
  const [testOrderCount, setTestOrderCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const fetchState = async () => {
    setLoading(true);
    try {
      const [modeData, countData] = await Promise.all([
        invokeWithAuth<{ stripe_test_mode: boolean }>("admin-data", { action: "get-stripe-test-mode" }),
        invokeWithAuth<{ count: number }>("admin-data", { action: "get-test-order-count" }),
      ]);
      setTestMode(modeData?.stripe_test_mode ?? false);
      setTestOrderCount(countData?.count ?? 0);
    } catch {
      toast({ title: "Failed to load Stripe settings", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchState(); }, []);

  const handleToggle = (checked: boolean) => {
    if (!checked && testOrderCount > 0) {
      // Turning off with existing test data — confirm deletion
      setShowConfirm(true);
      return;
    }
    applyToggle(checked);
  };

  const applyToggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      const data = await invokeWithAuth<{ success: boolean }>("admin-data", {
        action: "set-stripe-test-mode",
        enabled,
      });
      if (data?.success) {
        setTestMode(enabled);
        if (!enabled) setTestOrderCount(0);
        toast({
          title: enabled ? "Sandbox mode enabled" : "Sandbox mode disabled",
          description: enabled
            ? "Stripe transactions now use sandbox keys. Orders won't sync to QBO."
            : "Test data has been cleaned up. Stripe is back to live mode.",
        });
      }
    } catch (err) {
      toast({
        title: "Failed to update Stripe mode",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setToggling(false);
    }
  };

  const confirmDisable = () => {
    setShowConfirm(false);
    applyToggle(false);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base">Stripe Payments</CardTitle>
          <CardDescription className="font-body text-xs">
            Manage Stripe payment processing mode.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      testMode
                        ? "text-amber-600 border-amber-300 bg-amber-50"
                        : "text-green-600 border-green-300 bg-green-50"
                    }
                  >
                    {testMode ? "Sandbox" : "Live"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="stripe-test-mode" className="font-body text-sm">
                    Sandbox Mode
                  </Label>
                  <Switch
                    id="stripe-test-mode"
                    checked={testMode}
                    onCheckedChange={handleToggle}
                    disabled={toggling}
                  />
                </div>
              </div>

              {toggling && (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <p className="font-body text-xs text-muted-foreground">
                    {testMode ? "Cleaning up test data…" : "Switching to sandbox…"}
                  </p>
                </div>
              )}

              {testMode && !toggling && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="font-body text-xs text-amber-800">
                    <p>Stripe is in test mode. Transactions use sandbox keys and won't sync to QBO.</p>
                    {testOrderCount > 0 && (
                      <p className="mt-1 font-medium">
                        {testOrderCount} test order{testOrderCount !== 1 ? "s" : ""} exist{testOrderCount === 1 ? "s" : ""}.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable sandbox mode?</AlertDialogTitle>
            <AlertDialogDescription>
              {testOrderCount} test order{testOrderCount !== 1 ? "s" : ""} and all associated data
              (order lines, landing events, audit records) will be permanently deleted.
              Stock units closed by test orders will be reopened.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDisable}>
              Yes, disable and delete test data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
