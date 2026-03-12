import { useState, useEffect, useCallback } from "react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ChannelFee {
  id: string;
  channel: string;
  fee_name: string;
  rate_percent: number;
  fixed_amount: number;
  min_amount: number | null;
  max_amount: number | null;
  applies_to: string;
  active: boolean;
  notes: string | null;
}

const CHANNELS = ["ebay", "web", "bricklink", "brickowl"];
const APPLIES_TO = [
  { value: "sale_price", label: "Sale price (ex VAT)" },
  { value: "sale_plus_shipping", label: "Sale + shipping" },
  { value: "sale_price_inc_vat", label: "Sale price (inc VAT)" },
];

const emptyFee: Omit<ChannelFee, "id"> = {
  channel: "ebay",
  fee_name: "",
  rate_percent: 0,
  fixed_amount: 0,
  min_amount: null,
  max_amount: null,
  applies_to: "sale_price",
  active: true,
  notes: null,
};

export function ChannelFeesSettingsPanel() {
  const { toast } = useToast();
  const [fees, setFees] = useState<ChannelFee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editFee, setEditFee] = useState<Partial<ChannelFee>>(emptyFee);

  const load = useCallback(async () => {
    try {
      const data = await invokeWithAuth<ChannelFee[]>("admin-data", { action: "list-channel-fees" });
      setFees(data ?? []);
    } catch (err) {
      toast({ title: "Failed to load fees", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditFee({ ...emptyFee }); setDialogOpen(true); };
  const openEdit = (fee: ChannelFee) => { setEditFee({ ...fee }); setDialogOpen(true); };

  const save = async () => {
    setSaving(true);
    try {
      await invokeWithAuth("admin-data", { action: "upsert-channel-fee", ...editFee });
      toast({ title: "Fee saved" });
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
      await invokeWithAuth("admin-data", { action: "delete-channel-fee", id });
      toast({ title: "Fee deleted" });
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
            <CardTitle className="font-display text-base">Channel Fee Schedules</CardTitle>
            <CardDescription className="font-body text-xs">
              Define fees charged by each sales channel (commissions, payment processing, etc.)
            </CardDescription>
          </div>
          <Button size="sm" onClick={openNew}><Plus className="mr-1.5 h-3.5 w-3.5" />Add Fee</Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : fees.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fee schedules configured.</p>
        ) : (
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Fee Name</TableHead>
                  <TableHead className="text-right">Rate %</TableHead>
                  <TableHead className="text-right">Fixed £</TableHead>
                  <TableHead>Applies To</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fees.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="capitalize">{f.channel}</TableCell>
                    <TableCell>{f.fee_name}</TableCell>
                    <TableCell className="text-right">{f.rate_percent}%</TableCell>
                    <TableCell className="text-right">£{Number(f.fixed_amount).toFixed(2)}</TableCell>
                    <TableCell className="text-xs">{APPLIES_TO.find(a => a.value === f.applies_to)?.label ?? f.applies_to}</TableCell>
                    <TableCell>{f.active ? "✓" : "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(f)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(f.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
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
          <DialogHeader><DialogTitle>{editFee.id ? "Edit Fee" : "Add Fee"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Channel</Label>
                <Select value={editFee.channel} onValueChange={(v) => setEditFee(p => ({ ...p, channel: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CHANNELS.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Fee Name</Label>
                <Input value={editFee.fee_name ?? ""} onChange={(e) => setEditFee(p => ({ ...p, fee_name: e.target.value }))} placeholder="e.g. Final Value Fee" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Rate %</Label>
                <Input type="number" step="0.01" value={editFee.rate_percent ?? 0} onChange={(e) => setEditFee(p => ({ ...p, rate_percent: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Fixed Amount (£)</Label>
                <Input type="number" step="0.01" value={editFee.fixed_amount ?? 0} onChange={(e) => setEditFee(p => ({ ...p, fixed_amount: Number(e.target.value) }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Min Amount (£)</Label>
                <Input type="number" step="0.01" value={editFee.min_amount ?? ""} onChange={(e) => setEditFee(p => ({ ...p, min_amount: e.target.value ? Number(e.target.value) : null }))} placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label>Max Amount (£)</Label>
                <Input type="number" step="0.01" value={editFee.max_amount ?? ""} onChange={(e) => setEditFee(p => ({ ...p, max_amount: e.target.value ? Number(e.target.value) : null }))} placeholder="Optional" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Applies To</Label>
              <Select value={editFee.applies_to} onValueChange={(v) => setEditFee(p => ({ ...p, applies_to: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{APPLIES_TO.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input value={editFee.notes ?? ""} onChange={(e) => setEditFee(p => ({ ...p, notes: e.target.value || null }))} placeholder="Optional" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={editFee.active ?? true} onCheckedChange={(v) => setEditFee(p => ({ ...p, active: v }))} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !editFee.fee_name}>
              {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
