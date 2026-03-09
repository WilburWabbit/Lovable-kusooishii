import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2, Eye, Package, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Receipt {
  id: string;
  qbo_purchase_id: string;
  vendor_name: string | null;
  txn_date: string | null;
  total_amount: number;
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
}

const statusColor: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700 border-yellow-300",
  processed: "bg-green-50 text-green-700 border-green-300",
  error: "bg-red-50 text-red-700 border-red-300",
};

export function IntakePage() {
  const { toast } = useToast();
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [lineEdits, setLineEdits] = useState<Record<string, string>>({});

  const { data: receipts, isLoading } = useQuery({
    queryKey: ["inbound-receipts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inbound_receipt")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Receipt[];
    },
  });

  const { data: lines, isLoading: linesLoading } = useQuery({
    queryKey: ["receipt-lines", selectedReceipt?.id],
    queryFn: async () => {
      if (!selectedReceipt) return [];
      const { data, error } = await supabase
        .from("inbound_receipt_line")
        .select("*")
        .eq("inbound_receipt_id", selectedReceipt.id)
        .order("created_at");
      if (error) throw error;
      return data as ReceiptLine[];
    },
    enabled: !!selectedReceipt,
  });

  const handleMpnChange = (lineId: string, mpn: string) => {
    setLineEdits((prev) => ({ ...prev, [lineId]: mpn }));
  };

  const saveMpnMapping = async (lineId: string) => {
    const mpn = lineEdits[lineId];
    if (!mpn) return;

    const { error } = await supabase
      .from("inbound_receipt_line")
      .update({ mpn })
      .eq("id", lineId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "MPN mapped", description: `Line mapped to ${mpn}` });
    }
  };

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
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-sm">
              Receipt: {selectedReceipt?.qbo_purchase_id} — {selectedReceipt?.vendor_name ?? "Unknown"}
            </DialogTitle>
          </DialogHeader>

          {linesLoading ? (
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-display text-xs">Description</TableHead>
                  <TableHead className="font-display text-xs text-right">Qty</TableHead>
                  <TableHead className="font-display text-xs text-right">Unit Cost</TableHead>
                  <TableHead className="font-display text-xs text-right">Total</TableHead>
                  <TableHead className="font-display text-xs">MPN</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines?.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-body text-xs max-w-[200px] truncate">{line.description ?? "—"}</TableCell>
                    <TableCell className="font-body text-xs text-right">{line.quantity}</TableCell>
                    <TableCell className="font-body text-xs text-right">{Number(line.unit_cost).toFixed(2)}</TableCell>
                    <TableCell className="font-body text-xs text-right">{Number(line.line_total).toFixed(2)}</TableCell>
                    <TableCell>
                      <Input
                        className="h-7 text-xs w-24"
                        placeholder="e.g. 75192"
                        defaultValue={line.mpn ?? ""}
                        onChange={(e) => handleMpnChange(line.id, e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => saveMpnMapping(line.id)}>
                        Save
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </BackOfficeLayout>
  );
}
