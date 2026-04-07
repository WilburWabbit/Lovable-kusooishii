import { useState } from 'react';
import { AdminV2Layout } from '@/components/admin-v2/AdminV2Layout';
import { SurfaceCard, SectionHead } from '@/components/admin-v2/ui-primitives';
import { useShippingRates, useUpsertShippingRate, useDeleteShippingRate, type ShippingRate } from '@/hooks/admin/use-shipping-rates';
import { toast } from 'sonner';
import { Plus, Trash2, Check, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function emptyRate(carrier: string): Partial<ShippingRate> & { carrier: string; service_name: string } {
  return {
    carrier,
    service_name: '',
    size_band: '',
    max_weight_kg: 0,
    cost: 0,
    price_ex_vat: 0,
    price_inc_vat: 0,
    vat_exempt: false,
    tracked: false,
    active: true,
    channel: 'default',
    max_length_cm: null,
    max_width_cm: null,
    max_depth_cm: null,
  };
}

type EditFields = Record<string, any>;

function NumInput({ value, onChange, className = '' }: { value: any; onChange: (v: number | null) => void; className?: string }) {
  return (
    <input
      type="number"
      step="0.01"
      className={`px-1.5 py-1 border border-amber-300 rounded text-xs bg-white text-right font-mono ${className}`}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : null)}
    />
  );
}

export default function ShippingRatesPage() {
  const { data: rates, isLoading } = useShippingRates();
  const upsert = useUpsertShippingRate();
  const deleteRate = useDeleteShippingRate();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<EditFields>({});
  const [addingCarrier, setAddingCarrier] = useState<string | null>(null);
  const [newRate, setNewRate] = useState<EditFields>({});
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const grouped = (rates ?? []).reduce<Record<string, ShippingRate[]>>((acc, r) => {
    (acc[r.carrier] ??= []).push(r);
    return acc;
  }, {});
  const carriers = Object.keys(grouped).sort();

  const startEdit = (r: ShippingRate) => { setEditingId(r.id); setEditData({ ...r }); };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await upsert.mutateAsync({ id: editingId, ...editData } as any);
      toast.success('Rate updated');
      setEditingId(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  const startAdd = (carrier: string) => { setAddingCarrier(carrier); setNewRate(emptyRate(carrier)); };

  const saveNew = async () => {
    if (!newRate.service_name?.trim()) { toast.error('Service name required'); return; }
    try {
      await upsert.mutateAsync(newRate as any);
      toast.success('Rate added');
      setAddingCarrier(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteRate.mutateAsync(deleteTarget); toast.success('Deleted'); } catch (e) { toast.error('Failed'); }
    setDeleteTarget(null);
  };

  const toggleActive = async (r: ShippingRate) => {
    try { await upsert.mutateAsync({ id: r.id, carrier: r.carrier, service_name: r.service_name, active: !r.active }); } catch { toast.error('Failed'); }
  };

  const set = (setter: React.Dispatch<React.SetStateAction<EditFields>>, key: string, value: any) => setter(d => ({ ...d, [key]: value }));

  const renderRow = (r: ShippingRate) => {
    const editing = editingId === r.id;
    const d = editing ? editData : r;
    const s = setEditData;

    return (
      <tr key={r.id} className="border-b border-zinc-100 hover:bg-zinc-50 transition-colors cursor-pointer" onClick={() => !editing && startEdit(r)}>
        {editing ? (
          <>
            <td className="py-1.5 px-2"><input className="w-full px-1.5 py-1 border border-amber-300 rounded text-xs bg-white" value={d.service_name} onChange={(e) => set(s, 'service_name', e.target.value)} /></td>
            <td className="py-1.5 px-2"><input className="w-20 px-1.5 py-1 border border-amber-300 rounded text-xs bg-white" value={d.size_band} onChange={(e) => set(s, 'size_band', e.target.value)} /></td>
            <td className="py-1.5 px-2"><NumInput className="w-14" value={d.max_weight_kg} onChange={(v) => set(s, 'max_weight_kg', v ?? 0)} /></td>
            <td className="py-1.5 px-2 font-mono text-zinc-500 text-[10px]">
              <div className="flex gap-0.5 items-center">
                <NumInput className="w-10" value={d.max_length_cm} onChange={(v) => set(s, 'max_length_cm', v)} />×
                <NumInput className="w-10" value={d.max_width_cm} onChange={(v) => set(s, 'max_width_cm', v)} />×
                <NumInput className="w-10" value={d.max_depth_cm} onChange={(v) => set(s, 'max_depth_cm', v)} />
              </div>
            </td>
            <td className="py-1.5 px-2"><NumInput className="w-16" value={d.cost} onChange={(v) => set(s, 'cost', v ?? 0)} /></td>
            <td className="py-1.5 px-2"><NumInput className="w-16" value={d.price_inc_vat} onChange={(v) => set(s, 'price_inc_vat', v ?? 0)} /></td>
            <td className="py-1.5 px-2"><Switch checked={d.tracked} onCheckedChange={(v) => set(s, 'tracked', v)} /></td>
            <td className="py-1.5 px-2"><Switch checked={d.active} onCheckedChange={(v) => set(s, 'active', v)} /></td>
            <td className="py-1.5 px-2">
              <div className="flex gap-1">
                <button onClick={(e) => { e.stopPropagation(); saveEdit(); }} className="text-amber-600"><Check className="h-3.5 w-3.5" /></button>
                <button onClick={(e) => { e.stopPropagation(); setEditingId(null); }} className="text-zinc-400"><X className="h-3.5 w-3.5" /></button>
              </div>
            </td>
          </>
        ) : (
          <>
            <td className="py-2 px-2 text-zinc-800 font-medium">{r.service_name}</td>
            <td className="py-2 px-2 text-zinc-500">{r.size_band}</td>
            <td className="py-2 px-2 text-right font-mono text-zinc-700">{r.max_weight_kg}kg</td>
            <td className="py-2 px-2 font-mono text-zinc-400 text-[10px]">
              {r.max_length_cm && r.max_width_cm && r.max_depth_cm
                ? `${r.max_length_cm}×${r.max_width_cm}×${r.max_depth_cm}`
                : '—'}
            </td>
            <td className="py-2 px-2 text-right font-mono text-zinc-700">£{Number(r.cost).toFixed(2)}</td>
            <td className="py-2 px-2 text-right font-mono text-zinc-700">£{Number(r.price_inc_vat).toFixed(2)}</td>
            <td className="py-2 px-2">{r.tracked ? '✓' : '—'}</td>
            <td className="py-2 px-2">
              <Switch checked={r.active} onCheckedChange={() => toggleActive(r)} onClick={(e) => e.stopPropagation()} />
            </td>
            <td className="py-2 px-2">
              <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(r.id); }} className="text-zinc-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
            </td>
          </>
        )}
      </tr>
    );
  };

  if (isLoading) {
    return <AdminV2Layout><div className="p-4 text-zinc-500 text-sm">Loading...</div></AdminV2Layout>;
  }

  return (
    <AdminV2Layout>
      <div>
        <h1 className="text-[22px] font-bold text-zinc-900 mb-1">Shipping Rates</h1>
        <p className="text-zinc-500 text-[13px] mb-5">
          Carrier rates used by the pricing engine for shipping cost estimation.
        </p>

        {carriers.map((carrier) => (
          <div key={carrier} className="mb-6">
            <SectionHead>{carrier}</SectionHead>
            <SurfaceCard>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 text-zinc-500 text-left">
                      <th className="py-2 px-2 font-medium">Service</th>
                      <th className="py-2 px-2 font-medium">Size Band</th>
                      <th className="py-2 px-2 font-medium text-right">Max Weight</th>
                      <th className="py-2 px-2 font-medium">Dimensions (cm)</th>
                      <th className="py-2 px-2 font-medium text-right">Cost (ex-VAT)</th>
                      <th className="py-2 px-2 font-medium text-right">Price (inc-VAT)</th>
                      <th className="py-2 px-2 font-medium">Tracked</th>
                      <th className="py-2 px-2 font-medium">Active</th>
                      <th className="py-2 px-2 font-medium w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[carrier].map(renderRow)}

                    {addingCarrier === carrier && (
                      <tr className="border-b border-amber-200 bg-amber-50/50">
                        <td className="py-1.5 px-2"><input autoFocus className="w-full px-1.5 py-1 border border-amber-300 rounded text-xs bg-white" placeholder="Service name" value={newRate.service_name} onChange={(e) => set(setNewRate, 'service_name', e.target.value)} /></td>
                        <td className="py-1.5 px-2"><input className="w-20 px-1.5 py-1 border border-amber-300 rounded text-xs bg-white" placeholder="Size band" value={newRate.size_band} onChange={(e) => set(setNewRate, 'size_band', e.target.value)} /></td>
                        <td className="py-1.5 px-2"><NumInput className="w-14" value={newRate.max_weight_kg} onChange={(v) => set(setNewRate, 'max_weight_kg', v ?? 0)} /></td>
                        <td className="py-1.5 px-2">
                          <div className="flex gap-0.5 items-center text-[10px]">
                            <NumInput className="w-10" value={newRate.max_length_cm} onChange={(v) => set(setNewRate, 'max_length_cm', v)} />×
                            <NumInput className="w-10" value={newRate.max_width_cm} onChange={(v) => set(setNewRate, 'max_width_cm', v)} />×
                            <NumInput className="w-10" value={newRate.max_depth_cm} onChange={(v) => set(setNewRate, 'max_depth_cm', v)} />
                          </div>
                        </td>
                        <td className="py-1.5 px-2"><NumInput className="w-16" value={newRate.cost} onChange={(v) => set(setNewRate, 'cost', v ?? 0)} /></td>
                        <td className="py-1.5 px-2"><NumInput className="w-16" value={newRate.price_inc_vat} onChange={(v) => set(setNewRate, 'price_inc_vat', v ?? 0)} /></td>
                        <td className="py-1.5 px-2"><Switch checked={newRate.tracked} onCheckedChange={(v) => set(setNewRate, 'tracked', v)} /></td>
                        <td className="py-1.5 px-2"><Switch checked={newRate.active} onCheckedChange={(v) => set(setNewRate, 'active', v)} /></td>
                        <td className="py-1.5 px-2">
                          <div className="flex gap-1">
                            <button onClick={saveNew} className="text-amber-600"><Check className="h-3.5 w-3.5" /></button>
                            <button onClick={() => setAddingCarrier(null)} className="text-zinc-400"><X className="h-3.5 w-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {addingCarrier !== carrier && (
                <button onClick={() => startAdd(carrier)} className="mt-2 flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-500 font-medium">
                  <Plus className="h-3 w-3" /> Add rate
                </button>
              )}
            </SurfaceCard>
          </div>
        ))}

        {!addingCarrier && (
          <button
            onClick={() => {
              const name = prompt('Enter carrier name:');
              if (name?.trim()) startAdd(name.trim());
            }}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-amber-600 font-medium mt-2"
          >
            <Plus className="h-3.5 w-3.5" /> Add carrier
          </button>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete rate?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminV2Layout>
  );
}
