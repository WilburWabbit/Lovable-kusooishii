import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Package, ChevronRight, Check, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Receipt {
  id: string;
  qbo_purchase_id: string;
  vendor_name: string | null;
  txn_date: string | null;
  total_amount: number;
  tax_total: number;
  global_tax_calculation: string | null;
  currency: string;
  status: string;
  created_at: string;
}

interface ReceiptLine {
  id: string;
  description: string | null;
  quantity: number;
  unit_cost: number;
  line_total: number;
  qbo_item_id: string | null;
  mpn: string | null;
  is_stock_line: boolean;
  condition_grade: string | null;
}

const statusColor: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700 border-yellow-300",
  processed: "bg-green-50 text-green-700 border-green-300",
  error: "bg-red-50 text-red-700 border-red-300",
};

export function IntakePage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [lineEdits, setLineEdits] = useState<Record<string, { mpn?: string; grade?: string }>>({});
  const [mpnValid, setMpnValid] = useState<Record<string, boolean | null>>({});
  const [processing, setProcessing] = useState(false);

  const { data: receipts, isLoading } = useQuery({
    queryKey: ["inbound-receipts"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-data", {
        body: { action: "list-receipts" },
      });
      if (error) throw error;
      return data as Receipt[];
    },
    enabled: !!user,
  });

  const { data: lines, isLoading: linesLoading } = useQuery({
    queryKey: ["receipt-lines", selectedReceipt?.id],
    queryFn: async () => {
      if (!selectedReceipt) return [];
      const { data, error } = await supabase.functions.invoke("admin-data", {
        body: { action: "receipt-lines", receipt_id: selectedReceipt.id },
      });
      if (error) throw error;
      return data as ReceiptLine[];
    },
    enabled: !!selectedReceipt,
  });

  // Compute apportionment preview
  const apportionment = useMemo(() => {
    if (!lines) return { stockLines: [], overheadLines: [], totalOverhead: 0, totalStockCost: 0 };
    const stockLines = lines.filter((l) => l.is_stock_line);
    const overheadLines = lines.filter((l) => !l.is_stock_line);
    const totalOverhead = overheadLines.reduce((s, l) => s + Number(l.line_total), 0);
    const totalStockCost = stockLines.reduce((s, l) => s + Number(l.line_total), 0);
    return { stockLines, overheadLines, totalOverhead, totalStockCost };
  }, [lines]);

  const getLandedCost = (line: ReceiptLine) => {
    const { totalOverhead, totalStockCost } = apportionment;
    if (totalStockCost <= 0 || !line.is_stock_line) return null;
    const lineOverhead = totalOverhead * (Number(line.line_total) / totalStockCost);
    const perUnit = line.quantity > 0 ? lineOverhead / line.quantity : 0;
    return Math.round((Number(line.unit_cost) + perUnit) * 100) / 100;
  };

  const handleMpnChange = (lineId: string, mpn: string) => {
    setLineEdits((prev) => ({ ...prev, [lineId]: { ...prev[lineId], mpn } }));
    setMpnValid((prev) => ({ ...prev, [lineId]: null }));
  };

  const handleGradeChange = (lineId: string, grade: string) => {
    setLineEdits((prev) => ({ ...prev, [lineId]: { ...prev[lineId], grade } }));
  };

  const saveMpnMapping = async (lineId: string) => {
    const edits = lineEdits[lineId];
    const mpn = edits?.mpn;
    const grade = edits?.grade;

    const updates: Record<string, any> = {};
    if (mpn !== undefined) updates.mpn = mpn;
    if (grade !== undefined) updates.condition_grade = grade;
    if (Object.keys(updates).length === 0) return;

    const { error } = await supabase
      .from("inbound_receipt_line")
      .update(updates)
      .eq("id", lineId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    if (mpn) {
      const { data: product } = await supabase
        .from("catalog_product")
        .select("id")
        .eq("mpn", mpn)
        .single();
      setMpnValid((prev) => ({ ...prev, [lineId]: !!product }));
      toast({ title: "Saved", description: product ? `Matched to catalog` : `Warning: MPN not found in catalog` });
    } else {
      toast({ title: "Saved" });
    }

    queryClient.invalidateQueries({ queryKey: ["receipt-lines", selectedReceipt?.id] });
  };

  const handleProcess = async () => {
    if (!selectedReceipt) return;
    setProcessing(true);

    try {
      const { data, error } = await supabase.functions.invoke("process-receipt", {
        body: { receipt_id: selectedReceipt.id },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const skippedMsg = data.skipped?.length
        ? ` (${data.skipped.length} lines skipped)`
        : "";
      const overheadMsg = data.total_overhead_apportioned > 0
        ? ` | £${data.total_overhead_apportioned.toFixed(2)} overhead apportioned`
        : "";

      toast({
        title: "Receipt processed",
        description: `${data.units_created} stock units created${skippedMsg}${overheadMsg}`,
      });

      queryClient.invalidateQueries({ queryKey: ["inbound-receipts"] });
      setSelectedReceipt(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const mappedCount = apportionment.stockLines.filter((l) => l.mpn && l.condition_grade).length;
  const canProcess = selectedReceipt?.status === "pending" && mappedCount > 0 && !processing;

  return (
    <BackOfficeLayout title="Intake">
      <div className="space-y-6 animate-fade-in">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base flex items-center gap-2">
              <Package className="h-4 w-4" />
              Inbound Receipts
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !receipts?.length ? (
              <p className="font-body text-sm text-muted-foreground text-center py-8">
                No receipts yet. Sync purchases from QuickBooks in Settings.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-display text-xs">QBO ID</TableHead>
                    <TableHead className="font-display text-xs">Vendor</TableHead>
                    <TableHead className="font-display text-xs">Date</TableHead>
                    <TableHead className="font-display text-xs text-right">Total</TableHead>
                    <TableHead className="font-display text-xs">Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedReceipt(r)}>
                      <TableCell className="font-body text-xs font-mono">{r.qbo_purchase_id}</TableCell>
                      <TableCell className="font-body text-xs">{r.vendor_name ?? "—"}</TableCell>
                      <TableCell className="font-body text-xs">{r.txn_date ?? "—"}</TableCell>
                      <TableCell className="font-body text-xs text-right">
                        {r.currency} {Number(r.total_amount).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${statusColor[r.status] ?? ""}`}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Receipt detail dialog */}
      <Dialog open={!!selectedReceipt} onOpenChange={(o) => !o && setSelectedReceipt(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-sm">
              Receipt: {selectedReceipt?.qbo_purchase_id} — {selectedReceipt?.vendor_name ?? "Unknown"}
            </DialogTitle>
          </DialogHeader>

          {linesLoading ? (
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-display text-xs">Type</TableHead>
                    <TableHead className="font-display text-xs">Description</TableHead>
                    <TableHead className="font-display text-xs text-right">Qty</TableHead>
                    <TableHead className="font-display text-xs text-right">Unit Cost</TableHead>
                    <TableHead className="font-display text-xs text-right">Total</TableHead>
                    <TableHead className="font-display text-xs text-right">Landed/unit</TableHead>
                    <TableHead className="font-display text-xs">MPN</TableHead>
                    <TableHead className="font-display text-xs">Grade</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Stock lines first */}
                  {apportionment.stockLines.map((line) => {
                    const isValid = mpnValid[line.id];
                    const currentMpn = lineEdits[line.id]?.mpn ?? line.mpn;
                    const currentGrade = lineEdits[line.id]?.grade ?? line.condition_grade ?? "1";
                    const hasMpn = !!currentMpn;
                    const landed = getLandedCost(line);
                    return (
                      <TableRow key={line.id}>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                            Item
                          </Badge>
                        </TableCell>
                        <TableCell className="font-body text-xs max-w-[180px] truncate">{line.description ?? "—"}</TableCell>
                        <TableCell className="font-body text-xs text-right">{line.quantity}</TableCell>
                        <TableCell className="font-body text-xs text-right">{Number(line.unit_cost).toFixed(2)}</TableCell>
                        <TableCell className="font-body text-xs text-right">{Number(line.line_total).toFixed(2)}</TableCell>
                        <TableCell className="font-body text-xs text-right font-medium">
                          {landed !== null ? `£${landed.toFixed(2)}` : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Input
                              className="h-7 text-xs w-24"
                              placeholder="e.g. 75192"
                              defaultValue={line.mpn ?? ""}
                              onChange={(e) => handleMpnChange(line.id, e.target.value)}
                              disabled={selectedReceipt?.status !== "pending"}
                            />
                            {isValid === true && <Check className="h-3.5 w-3.5 text-green-600" />}
                            {isValid === false && <AlertTriangle className="h-3.5 w-3.5 text-yellow-600" />}
                            {!hasMpn && <AlertTriangle className="h-3 w-3 text-muted-foreground/50" />}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={currentGrade}
                            onValueChange={(v) => handleGradeChange(line.id, v)}
                            disabled={selectedReceipt?.status !== "pending"}
                          >
                            <SelectTrigger className="h-7 w-14 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {["1", "2", "3", "4", "5"].map((g) => (
                                <SelectItem key={g} value={g} className="text-xs">{g}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {selectedReceipt?.status === "pending" && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => saveMpnMapping(line.id)}>
                              Save
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {/* Account/overhead lines */}
                  {apportionment.overheadLines.map((line) => (
                    <TableRow key={line.id} className="bg-muted/30">
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] bg-orange-50 text-orange-700 border-orange-200">
                          Acct
                        </Badge>
                      </TableCell>
                      <TableCell className="font-body text-xs max-w-[180px] truncate italic text-muted-foreground">
                        {line.description ?? "—"}
                      </TableCell>
                      <TableCell className="font-body text-xs text-right text-muted-foreground">—</TableCell>
                      <TableCell className="font-body text-xs text-right text-muted-foreground">—</TableCell>
                      <TableCell className="font-body text-xs text-right text-muted-foreground">
                        {Number(line.line_total).toFixed(2)}
                      </TableCell>
                      <TableCell className="font-body text-xs text-right text-muted-foreground italic">
                        apportioned
                      </TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell />
                    </TableRow>
                  ))}

                  {/* Summary row */}
                  {apportionment.totalOverhead > 0 && (
                    <TableRow className="border-t-2 border-border">
                      <TableCell colSpan={4} className="font-display text-xs text-right">
                        Overhead to apportion:
                      </TableCell>
                      <TableCell className="font-display text-xs text-right font-semibold">
                        £{apportionment.totalOverhead.toFixed(2)}
                      </TableCell>
                      <TableCell colSpan={4} className="font-body text-[10px] text-muted-foreground italic">
                        pro-rata by line total
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </>
          )}

          {selectedReceipt?.status === "pending" && (
            <DialogFooter className="flex items-center gap-3 sm:justify-between">
              <span className="font-body text-[10px] text-muted-foreground">
                {mappedCount}/{apportionment.stockLines.length} lines mapped
              </span>
              <Button size="sm" onClick={handleProcess} disabled={!canProcess} className="text-xs">
                {processing && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                Process Receipt
              </Button>
            </DialogFooter>
          )}

          {selectedReceipt?.status === "processed" && (
            <div className="text-center py-2">
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300 text-xs">
                ✓ Processed
              </Badge>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </BackOfficeLayout>
  );
}
