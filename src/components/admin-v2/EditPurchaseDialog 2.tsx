import { useState, useEffect } from "react";
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
import { Switch } from "@/components/ui/switch";
import { useUpdatePurchaseBatch } from "@/hooks/admin/use-purchase-batches";
import { useToast } from "@/hooks/use-toast";
import type { PurchaseBatchDetail, SharedCosts } from "@/lib/types/admin";

interface EditPurchaseDialogProps {
  open: boolean;
  onClose: () => void;
  batch: PurchaseBatchDetail;
}

export function EditPurchaseDialog({ open, onClose, batch }: EditPurchaseDialogProps) {
  const { toast } = useToast();
  const updateBatch = useUpdatePurchaseBatch();

  const [supplierName, setSupplierName] = useState(batch.supplierName);
  const [purchaseDate, setPurchaseDate] = useState(batch.purchaseDate);
  const [reference, setReference] = useState(batch.reference ?? "");
  const [vatRegistered, setVatRegistered] = useState(batch.supplierVatRegistered);
  const [shipping, setShipping] = useState(batch.sharedCosts.shipping ?? 0);
  const [brokerFee, setBrokerFee] = useState(batch.sharedCosts.broker_fee ?? 0);
  const [otherCost, setOtherCost] = useState(batch.sharedCosts.other ?? 0);
  const [otherLabel, setOtherLabel] = useState(batch.sharedCosts.other_label ?? "");

  // Reset local state when the dialog reopens against a different batch / fresh data
  useEffect(() => {
    if (open) {
      setSupplierName(batch.supplierName);
      setPurchaseDate(batch.purchaseDate);
      setReference(batch.reference ?? "");
      setVatRegistered(batch.supplierVatRegistered);
      setShipping(batch.sharedCosts.shipping ?? 0);
      setBrokerFee(batch.sharedCosts.broker_fee ?? 0);
      setOtherCost(batch.sharedCosts.other ?? 0);
      setOtherLabel(batch.sharedCosts.other_label ?? "");
    }
  }, [open, batch]);

  const totalShared = shipping + brokerFee + otherCost;
  const canSave = supplierName.trim().length > 0 && !!purchaseDate;

  const handleSave = async () => {
    const sharedCosts: SharedCosts = {
      shipping: Number(shipping) || 0,
      broker_fee: Number(brokerFee) || 0,
      other: Number(otherCost) || 0,
      other_label: otherLabel.trim(),
    };

    try {
      const result = await updateBatch.mutateAsync({
        batchId: batch.id,
        supplierName: supplierName.trim(),
        purchaseDate,
        reference: reference.trim() || null,
        supplierVatRegistered: vatRegistered,
        sharedCosts,
      });

      if (result.qbo_pushed) {
        toast({
          title: "Purchase updated",
          description: `${batch.id} saved and pushed to QuickBooks.`,
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
          title: "Purchase updated",
          description: `${batch.id} saved.`,
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit purchase {batch.id}</DialogTitle>
          <DialogDescription>
            Changes save to the database and{" "}
            {batch.qboPurchaseId ? (
              <>are pushed to QuickBooks (Purchase #{batch.qboPurchaseId}).</>
            ) : (
              <>will be pushed to QuickBooks the next time you push this batch.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ep-supplier">Supplier</Label>
              <Input
                id="ep-supplier"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="Vendor name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-date">Purchase date</Label>
              <Input
                id="ep-date"
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ep-ref">External receipt #</Label>
              <Input
                id="ep-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. 510963248"
              />
            </div>
            <div className="flex items-end gap-3 pb-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="ep-vat"
                  checked={vatRegistered}
                  onCheckedChange={setVatRegistered}
                />
                <Label htmlFor="ep-vat" className="cursor-pointer">
                  Supplier VAT registered
                </Label>
              </div>
            </div>
          </div>

          <div className="border-t border-zinc-200 pt-3">
            <div className="text-sm font-semibold text-zinc-900 mb-2">Shared costs</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ep-ship">Shipping (£)</Label>
                <Input
                  id="ep-ship"
                  type="number"
                  step="0.01"
                  min="0"
                  value={shipping}
                  onChange={(e) => setShipping(Number(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-broker">Broker fee (£)</Label>
                <Input
                  id="ep-broker"
                  type="number"
                  step="0.01"
                  min="0"
                  value={brokerFee}
                  onChange={(e) => setBrokerFee(Number(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-other">Other (£)</Label>
                <Input
                  id="ep-other"
                  type="number"
                  step="0.01"
                  min="0"
                  value={otherCost}
                  onChange={(e) => setOtherCost(Number(e.target.value) || 0)}
                />
              </div>
            </div>
            {otherCost > 0 && (
              <div className="space-y-1.5 mt-3">
                <Label htmlFor="ep-other-label">Other label</Label>
                <Input
                  id="ep-other-label"
                  value={otherLabel}
                  onChange={(e) => setOtherLabel(e.target.value)}
                  placeholder="e.g. Customs duty"
                />
              </div>
            )}
            <div className="text-xs text-zinc-500 mt-2">
              Total shared: <span className="font-mono text-teal-700">£{totalShared.toFixed(2)}</span>
              {" "}— landed costs will be re-apportioned across line items.
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={updateBatch.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || updateBatch.isPending}>
            {updateBatch.isPending
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
