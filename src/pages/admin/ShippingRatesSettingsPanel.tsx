import { useState, useEffect, useCallback } from "react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ShippingRate {
  id: string;
  channel: string;
  carrier: string;
  service_name: string;
  max_weight_kg: number;
  max_length_cm: number | null;
  cost: number;
  active: boolean;
}

const emptyRate: Omit<ShippingRate, "id"> = {
  channel: "default",
  carrier: "",
  service_name: "",
  max_weight_kg: 0,
  max_length_cm: null,
  cost: 0,
  active: true,
};

export function ShippingRatesSettingsPanel() {
  const { toast } = useToast();
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRate, setEditRate] = useState<Partial<ShippingRate>>(emptyRate);

  const load = useCallback(async () => {
    try {
      const data = await invokeWithAuth<ShippingRate[]>("admin-data", { action: "list-shipping-rates" });
      setRates(data ?? []);
    } catch (err) {
      toast({ title: "Failed to load shipping rates", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditRate({ ...emptyRate }); setDialogOpen(true); };
  const openEdit = (r: ShippingRate) => { setEditRate({ ...r }); setDialogOpen(true); };

  const save = async () => {
    setSaving(true);
    try {
      await invokeWithAuth("admin-data", { action: "upsert-shipping-rate", ...editRate });
      toast({ title: "Rate saved" });
      setDialogOpen(false);
      load();
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await invokeWithAuth("admin-data", { action: "delete-shipping-rate", id });
      toast({ title: "Rate deleted" });
      load();
    } catch (err) {
      toast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="font-display text-base">Shipping Rate Table</CardTitle>
            <CardDescription className="font-body text-xs">
              Define outbound shipping costs by carrier, service, and weight band.
            </CardDescription>
          </div>
          <Button size="sm" onClick={openNew}><Plus className="mr-1.5 h-3.5 w-3.5" />Add Rate</Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : rates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shipping rates configured.</p>
        ) : (
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead className="text-right">Max Weight (kg)</TableHead>
                  <TableHead className="text-right">Cost (£)</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="capitalize">{r.channel}</TableCell>
                    <TableCell>{r.carrier}</TableCell>
                    <TableCell>{r.service_name}</TableCell>
                    <TableCell className="text-right">{r.max_weight_kg}</TableCell>
                    <TableCell className="text-right">£{Number(r.cost).toFixed(2)}</TableCell>
                    <TableCell>{r.active ? "✓" : "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editRate.id ? "Edit Rate" : "Add Rate"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Channel</Label>
                <Input value={editRate.channel ?? "default"} onChange={(e) => setEditRate(p => ({ ...p, channel: e.target.value }))} placeholder="default" />
              </div>
              <div className="space-y-1.5">
                <Label>Carrier</Label>
                <Input value={editRate.carrier ?? ""} onChange={(e) => setEditRate(p => ({ ...p, carrier: e.target.value }))} placeholder="e.g. Royal Mail" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Service Name</Label>
              <Input value={editRate.service_name ?? ""} onChange={(e) => setEditRate(p => ({ ...p, service_name: e.target.value }))} placeholder="e.g. 2nd Class Small Parcel" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Max Weight (kg)</Label>
                <Input type="number" step="0.01" value={editRate.max_weight_kg ?? 0} onChange={(e) => setEditRate(p => ({ ...p, max_weight_kg: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Max Length (cm)</Label>
                <Input type="number" step="0.1" value={editRate.max_length_cm ?? ""} onChange={(e) => setEditRate(p => ({ ...p, max_length_cm: e.target.value ? Number(e.target.value) : null }))} placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label>Cost (£)</Label>
                <Input type="number" step="0.01" value={editRate.cost ?? 0} onChange={(e) => setEditRate(p => ({ ...p, cost: Number(e.target.value) }))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={editRate.active ?? true} onCheckedChange={(v) => setEditRate(p => ({ ...p, active: v }))} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !editRate.carrier || !editRate.service_name}>
              {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
