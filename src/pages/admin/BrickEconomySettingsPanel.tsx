import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw } from "lucide-react";
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

export function BrickEconomySettingsPanel() {
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [syncing, setSyncing] = useState(false);

  const syncCollection = async () => {
    setSyncing(true);
    try {
      const data = await invokeWithAuth("brickeconomy-sync");
      if (data?.error) throw new Error(data.error);
      const parts: string[] = [];
      if (data.sets_synced) parts.push(`${data.sets_synced} sets`);
      if (data.minifigs_synced) parts.push(`${data.minifigs_synced} minifigs`);
      if (data.catalog_matches) parts.push(`${data.catalog_matches} catalog matches`);
      toast({
        title: "BrickEconomy sync complete",
        description: parts.length > 0 ? parts.join(", ") + "." : "No items found.",
      });
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
        <CardTitle className="font-display text-base">BrickEconomy</CardTitle>
        <CardDescription className="font-body text-xs">
          Sync your BrickEconomy collection to pull set &amp; minifig valuations.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {authLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <Button size="sm" onClick={syncCollection} disabled={syncing || !user}>
            {syncing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
            Sync Collection
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
