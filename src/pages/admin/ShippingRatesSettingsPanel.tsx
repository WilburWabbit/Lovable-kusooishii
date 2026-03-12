import { useState, useEffect, useCallback } from "react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ShippingRate {
  id: string;
  channel: string;
  carrier: string;
  service_name: string;
  size_band: string | null;
  max_weight_kg: number;
  max_girth_cm: number | null;
  max_length_cm: number | null;
  max_width_cm: number | null;
  max_depth_cm: number | null;
  cost: number;
  price_ex_vat: number;
  price_inc_vat: number;
  vat_exempt: boolean;
  tracked: boolean;
  max_compensation: number | null;
  est_delivery: string | null;
  active: boolean;
}

const emptyRate: Omit<ShippingRate, "id"> = {
  channel: "default",
  carrier: "",
  service_name: "",
  size_band: null,
  max_weight_kg: 0,
  max_girth_cm: null,
  max_length_cm: null,
  max_width_cm: null,
  max_depth_cm: null,
  cost: 0,
  price_ex_vat: 0,
  price_inc_vat: 0,
  vat_exempt: false,
  tracked: false,
  max_compensation: null,
  est_delivery: null,
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

  const set = (patch: Partial<ShippingRate>) => setEditRate(p => ({ ...p, ...patch }));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="font-display text-base">Shipping Rate Table</CardTitle>
            <CardDescription className="font-body text-xs">
              Define outbound shipping costs by carrier, service, size band and weight.
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
                  <TableHead>Carrier</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Size Band</TableHead>
                  <TableHead className="text-right">Max Wt (kg)</TableHead>
                  <TableHead className="text-right">L×W×D (cm)</TableHead>
                  <TableHead className="text-right">Cost ex VAT</TableHead>
                  <TableHead className="text-right">Cost inc VAT</TableHead>
                  <TableHead>Tracked</TableHead>
                  <TableHead>Est. Delivery</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.carrier}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{r.service_name}</TableCell>
                    <TableCell>
                      {r.size_band && <Badge variant="secondary" className="text-xs">{r.size_band}</Badge>}
                    </TableCell>
                    <TableCell className="text-right">{r.max_weight_kg}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {r.max_length_cm ?? "—"}×{r.max_width_cm ?? "—"}×{r.max_depth_cm ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">£{Number(r.price_ex_vat).toFixed(2)}</TableCell>
                    <TableCell className="text-right">£{Number(r.price_inc_vat).toFixed(2)}</TableCell>
                    <TableCell>{r.tracked ? "✓" : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.est_delivery ?? "—"}</TableCell>
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
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editRate.id ? "Edit Rate" : "Add Rate"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            {/* Row 1: Carrier / Service / Size Band */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Carrier</Label>
                <Input value={editRate.carrier ?? ""} onChange={(e) => set({ carrier: e.target.value })} placeholder="e.g. Royal Mail" />
              </div>
              <div className="space-y-1.5">
                <Label>Service Name</Label>
                <Input value={editRate.service_name ?? ""} onChange={(e) => set({ service_name: e.target.value })} placeholder="e.g. Tracked 48 - Small Parcel" />
              </div>
              <div className="space-y-1.5">
                <Label>Size Band</Label>
                <Input value={editRate.size_band ?? ""} onChange={(e) => set({ size_band: e.target.value || null })} placeholder="e.g. Small Parcel" />
              </div>
            </div>

            {/* Row 2: Dimensions */}
            <div className="grid grid-cols-5 gap-3">
              <div className="space-y-1.5">
                <Label>Max Weight (kg)</Label>
                <Input type="number" step="0.01" value={editRate.max_weight_kg ?? 0} onChange={(e) => set({ max_weight_kg: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Max Length (cm)</Label>
                <Input type="number" step="0.1" value={editRate.max_length_cm ?? ""} onChange={(e) => set({ max_length_cm: e.target.value ? Number(e.target.value) : null })} />
              </div>
              <div className="space-y-1.5">
                <Label>Max Width (cm)</Label>
                <Input type="number" step="0.1" value={editRate.max_width_cm ?? ""} onChange={(e) => set({ max_width_cm: e.target.value ? Number(e.target.value) : null })} />
              </div>
              <div className="space-y-1.5">
                <Label>Max Depth (cm)</Label>
                <Input type="number" step="0.1" value={editRate.max_depth_cm ?? ""} onChange={(e) => set({ max_depth_cm: e.target.value ? Number(e.target.value) : null })} />
              </div>
              <div className="space-y-1.5">
                <Label>Max Girth (cm)</Label>
                <Input type="number" step="0.1" value={editRate.max_girth_cm ?? ""} onChange={(e) => set({ max_girth_cm: e.target.value ? Number(e.target.value) : null })} />
              </div>
            </div>

            {/* Row 3: Pricing */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Price ex VAT (£)</Label>
                <Input type="number" step="0.01" value={editRate.price_ex_vat ?? 0} onChange={(e) => set({ price_ex_vat: Number(e.target.value), cost: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Price inc VAT (£)</Label>
                <Input type="number" step="0.01" value={editRate.price_inc_vat ?? 0} onChange={(e) => set({ price_inc_vat: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Max Compensation (£)</Label>
                <Input type="number" step="0.01" value={editRate.max_compensation ?? ""} onChange={(e) => set({ max_compensation: e.target.value ? Number(e.target.value) : null })} />
              </div>
            </div>

            {/* Row 4: Toggles & delivery */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Channel</Label>
                <Input value={editRate.channel ?? "default"} onChange={(e) => set({ channel: e.target.value })} placeholder="default" />
              </div>
              <div className="space-y-1.5">
                <Label>Est. Delivery</Label>
                <Input value={editRate.est_delivery ?? ""} onChange={(e) => set({ est_delivery: e.target.value || null })} placeholder="e.g. 2-3 working days" />
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={editRate.tracked ?? false} onCheckedChange={(v) => set({ tracked: v })} />
                <Label>Tracked</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={editRate.vat_exempt ?? false} onCheckedChange={(v) => set({ vat_exempt: v })} />
                <Label>VAT Exempt</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={editRate.active ?? true} onCheckedChange={(v) => set({ active: v })} />
                <Label>Active</Label>
              </div>
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
