import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useUpdatePurchaseLineItem } from "@/hooks/admin/use-purchase-batches";
import { useToast } from "@/hooks/use-toast";
import type { PurchaseBatchDetail, PurchaseLineItem, StockUnit } from "@/lib/types/admin";

interface EditLineItemDialogProps {
  open: boolean;
  onClose: () => void;
  batch: PurchaseBatchDetail;
  line: (PurchaseLineItem & { units: StockUnit[]; productName?: string | null }) | null;
}

export function EditLineItemDialog({ open, onClose, batch, line }: EditLineItemDialogProps) {
  const { toast } = useToast();
  const updateLine = useUpdatePurchaseLineItem();

  const [name, setName] = useState("");
  const [unitCost, setUnitCost] = useState<number>(0);

  useEffect(() => {
    if (open && line) {
      setName(line.productName ?? "");
      setUnitCost(line.unitCost);
    }
  }, [open, line]);

  if (!line) return null;

  const lineHasMovement = line.units.some((u) =>
    ["sold", "shipped", "delivered", "listed", "reserved", "complete"].includes(String(u.status))
    || Boolean(u.orderId)
  );

  const nameChanged = (name.trim() || line.mpn) !== (line.productName ?? line.mpn);
  const costChanged = Number(unitCost) !== Number(line.unitCost);
  const hasChanges = nameChanged || costChanged;
  const canSave = !lineHasMovement && hasChanges && Number(unitCost) >= 0;

  const handleSave = async () => {
    try {
      const result = await updateLine.mutateAsync({
        batchId: batch.id,
        lineItemId: line.id,
        mpn: line.mpn,
        name: name.trim() || null,
        unitCost: Number(unitCost),
      });

      if (result.qbo_pushed) {
        toast({
          title: "Line item updated",
          description: `${line.mpn} saved and pushed to QuickBooks.`,
        });
      } else if (result.qbo_error) {
        toast({
          title: "Saved locally — QBO update failed",
          description: result.qbo_error,
          variant: "destructive",
          duration: 12000,
        });
      } else {
        toast({
          title: "Line item updated",
          description: `${line.mpn} saved.`,
        });
      }
      onClose();
    } catch (e) {
      toast({
        title: "Update failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
        duration: 10000,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit line item {line.mpn}</DialogTitle>
          <DialogDescription>
            {batch.qboPurchaseId ? (
              <>Changes save locally and push to QuickBooks (Purchase #{batch.qboPurchaseId} and Item).</>
            ) : (
              <>Changes save locally and will be pushed to QuickBooks the next time you push this batch.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="el-mpn">MPN</Label>
            <Input
              id="el-mpn"
              value={line.mpn}
              disabled
              className="font-mono"
            />
            <p className="text-[11px] text-zinc-500">
              MPN cannot be changed here. Delete and re-create the batch to swap MPN.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="el-name">Product name</Label>
            <Input
              id="el-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={line.mpn}
            />
            <p className="text-[11px] text-zinc-500">
              Updates the central product record — propagates to every SKU and the QBO Item name.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="el-cost">Unit cost (£)</Label>
              <Input
                id="el-cost"
                type="number"
                step="0.01"
                min="0"
                value={unitCost}
                onChange={(e) => setUnitCost(Number(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Quantity</Label>
              <Input value={line.quantity} disabled />
            </div>
          </div>
          <p className="text-[11px] text-zinc-500 -mt-2">
            Quantity is locked because stock units have already been generated for this line.
          </p>

          {lineHasMovement && (
            <div className="rounded border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-800">
              One or more units on this line have been listed, sold or shipped — line cannot be edited.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={updateLine.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || updateLine.isPending}>
            {updateLine.isPending
              ? batch.qboPurchaseId
                ? "Saving & pushing to QBO…"
                : "Saving…"
              : batch.qboPurchaseId
              ? "Save & push to QBO"
              : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
