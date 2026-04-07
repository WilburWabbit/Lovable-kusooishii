import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, SkipForward, Eye, EyeOff, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";

interface StagingError {
  id: string;
  external_id: string;
  table_name: string;
  entity_type: string;
  error_message: string | null;
  received_at: string;
  raw_payload: any;
}

export function StagingErrorsPanel() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: errors = [], isLoading } = useQuery({
    queryKey: ["staging-errors"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-data", {
        body: { action: "list-staging-errors" },
      });
      if (error) throw error;
      return (data as StagingError[]) ?? [];
    },
    refetchInterval: 30_000,
  });

  const retryMutation = useMutation({
    mutationFn: async ({ table, id }: { table: string; id: string }) => {
      const { error } = await supabase.functions.invoke("admin-data", {
        body: { action: "retry-landing-record", table, id },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Record reset to pending — will be retried on next process run");
      queryClient.invalidateQueries({ queryKey: ["staging-errors"] });
    },
    onError: (err: any) => toast.error(`Retry failed: ${err.message}`),
  });

  const skipMutation = useMutation({
    mutationFn: async ({ table, id }: { table: string; id: string }) => {
      const { error } = await supabase.functions.invoke("admin-data", {
        body: { action: "skip-landing-record", table, id },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Record skipped — will not be retried");
      queryClient.invalidateQueries({ queryKey: ["staging-errors"] });
    },
    onError: (err: any) => toast.error(`Skip failed: ${err.message}`),
  });

  const resetPurchaseMutation = useMutation({
    mutationFn: async ({ externalId }: { externalId: string }) => {
      const { data, error } = await supabase.functions.invoke("admin-data", {
        body: { action: "reset-qbo-purchase", ids: [externalId] },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast.success(data?.message ?? "Purchase reset — run Process Pending to retry");
      queryClient.invalidateQueries({ queryKey: ["staging-errors"] });
    },
    onError: (err: any) => toast.error(`Reset failed: ${err.message}`),
  });

  const isPurchaseError = (err: StagingError) =>
    err.table_name === "landing_raw_qbo_purchase" &&
    err.error_message?.toLowerCase().includes("duplicate key");

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-card-foreground mb-2">Staging Errors</h3>
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (errors.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-card-foreground mb-2">Staging Errors</h3>
        <p className="text-xs text-muted-foreground">No errors in staging tables.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-destructive/30 bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        <h3 className="text-sm font-medium text-card-foreground">
          Staging Errors ({errors.length})
        </h3>
      </div>

      <div className="overflow-auto max-h-[400px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs w-[100px]">Entity</TableHead>
              <TableHead className="text-xs w-[80px]">Ext ID</TableHead>
              <TableHead className="text-xs">Error</TableHead>
              <TableHead className="text-xs w-[100px]">Received</TableHead>
              <TableHead className="text-xs w-[140px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {errors.map((err) => (
              <>
                <TableRow key={err.id}>
                  <TableCell className="text-xs">
                    <Badge variant="outline" className="text-[10px]">{err.entity_type}</Badge>
                  </TableCell>
                  <TableCell className="text-xs font-mono">{err.external_id}</TableCell>
                  <TableCell className="text-xs text-destructive max-w-[300px] truncate" title={err.error_message ?? ""}>
                    {err.error_message ?? "Unknown error"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(err.received_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title="View payload"
                        onClick={() => setExpandedId(expandedId === err.id ? null : err.id)}
                      >
                        {expandedId === err.id ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </Button>
                      {isPurchaseError(err) ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-amber-500"
                          title="Reset & Retry (cleans up partial data)"
                          onClick={() => resetPurchaseMutation.mutate({ externalId: err.external_id })}
                          disabled={resetPurchaseMutation.isPending}
                        >
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          title="Retry"
                          onClick={() => retryMutation.mutate({ table: err.table_name, id: err.id })}
                          disabled={retryMutation.isPending}
                        >
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title="Skip"
                        onClick={() => skipMutation.mutate({ table: err.table_name, id: err.id })}
                        disabled={skipMutation.isPending}
                      >
                        <SkipForward className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {expandedId === err.id && (
                  <TableRow key={`${err.id}-payload`}>
                    <TableCell colSpan={5}>
                      <pre className="text-[10px] bg-muted p-2 rounded overflow-auto max-h-[200px] whitespace-pre-wrap">
                        {JSON.stringify(err.raw_payload, null, 2)}
                      </pre>
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}