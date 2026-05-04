import { useState } from 'react';
import { AdminV2Layout } from '@/components/admin-v2/AdminV2Layout';
import { SurfaceCard, SectionHead } from '@/components/admin-v2/ui-primitives';
import { useShippingRates, useUpsertShippingRate, useDeleteShippingRate, type ShippingRate } from '@/hooks/admin/use-shipping-rates';
import { useSellingCostDefaults } from '@/hooks/admin/use-selling-cost-defaults';
import { toast } from 'sonner';
import { Plus, Trash2, Check, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
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

function emptyRate(carrier: string, channel: string, destination: string, tier: string | null): Partial<ShippingRate> & { carrier: string; service_name: string } {
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
    channel,
    tier,
    destination,
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

interface RateRowProps {
  rate: ShippingRate;
  editing: boolean;
  editData: EditFields;
  onStartEdit: (r: ShippingRate) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onToggleActive: (r: ShippingRate) => void;
  onSetEditData: React.Dispatch<React.SetStateAction<EditFields>>;
  showTier?: boolean;
}

function RateRow({ rate, editing, editData, onStartEdit, onSave, onCancel, onDelete, onToggleActive, onSetEditData, showTier }: RateRowProps) {
  const d = editing ? editData : rate;
  const set = (key: string, value: any) => onSetEditData(prev => ({ ...prev, [key]: value }));

  return (
    <tr className="border-b border-zinc-100 hover:bg-zinc-50 transition-colors cursor-pointer" onClick={() => !editing && onStartEdit(rate)}>
      {editing ? (
        <>
          <td className="py-1.5 px-2"><input className="w-full px-1.5 py-1 border border-amber-300 rounded text-xs bg-white" value={d.service_name} onChange={(e) => set('service_name', e.target.value)} /></td>
          <td className="py-1.5 px-2"><input className="w-20 px-1.5 py-1 border border-amber-300 rounded text-xs bg-white" value={d.size_band} onChange={(e) => set('size_band', e.target.value)} /></td>
          <td className="py-1.5 px-2"><NumInput className="w-14" value={d.max_weight_kg} onChange={(v) => set('max_weight_kg', v ?? 0)} /></td>
          <td className="py-1.5 px-2 font-mono text-zinc-500 text-[10px]">
            <div className="flex gap-0.5 items-center">
              <NumInput className="w-10" value={d.max_length_cm} onChange={(v) => set('max_length_cm', v)} />×
              <NumInput className="w-10" value={d.max_width_cm} onChange={(v) => set('max_width_cm', v)} />×
              <NumInput className="w-10" value={d.max_depth_cm} onChange={(v) => set('max_depth_cm', v)} />
            </div>
          </td>
          <td className="py-1.5 px-2"><NumInput className="w-16" value={d.cost} onChange={(v) => set('cost', v ?? 0)} /></td>
          <td className="py-1.5 px-2"><NumInput className="w-16" value={d.price_inc_vat} onChange={(v) => set('price_inc_vat', v ?? 0)} /></td>
          {showTier && <td className="py-1.5 px-2"><input className="w-14 px-1.5 py-1 border border-amber-300 rounded text-xs bg-white" value={d.tier ?? ''} onChange={(e) => set('tier', e.target.value || null)} /></td>}
          <td className="py-1.5 px-2"><Switch checked={d.tracked} onCheckedChange={(v) => set('tracked', v)} /></td>
          <td className="py-1.5 px-2"><Switch checked={d.active} onCheckedChange={(v) => set('active', v)} /></td>
          <td className="py-1.5 px-2">
            <div className="flex gap-1">
              <button onClick={(e) => { e.stopPropagation(); onSave(); }} className="text-amber-600"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={(e) => { e.stopPropagation(); onCancel(); }} className="text-zinc-400"><X className="h-3.5 w-3.5" /></button>
            </div>
          </td>
        </>
      ) : (
        <>
          <td className="py-2 px-2 text-zinc-800 font-medium">{rate.service_name}</td>
          <td className="py-2 px-2 text-zinc-500">{rate.size_band}</td>
          <td className="py-2 px-2 text-right font-mono text-zinc-700">{rate.max_weight_kg}kg</td>
          <td className="py-2 px-2 font-mono text-zinc-400 text-[10px]">
            {rate.max_length_cm && rate.max_width_cm && rate.max_depth_cm
              ? `${rate.max_length_cm}×${rate.max_width_cm}×${rate.max_depth_cm}`
              : '—'}
          </td>
          <td className="py-2 px-2 text-right font-mono text-zinc-700">£{Number(rate.cost).toFixed(2)}</td>
          <td className="py-2 px-2 text-right font-mono text-zinc-700">£{Number(rate.price_inc_vat).toFixed(2)}</td>
          {showTier && <td className="py-2 px-2 text-zinc-500 text-[10px]">{rate.tier ?? '—'}</td>}
          <td className="py-2 px-2">{rate.tracked ? '✓' : '—'}</td>
          <td className="py-2 px-2">
            <Switch checked={rate.active} onCheckedChange={() => onToggleActive(rate)} onClick={(e) => e.stopPropagation()} />
          </td>
          <td className="py-2 px-2">
            <button onClick={(e) => { e.stopPropagation(); onDelete(rate.id); }} className="text-zinc-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
          </td>
        </>
      )}
    </tr>
  );
}

export default function ShippingRatesPage() {
  const { data: rates, isLoading } = useShippingRates();
  const { data: defaults } = useSellingCostDefaults();
  const upsert = useUpsertShippingRate();
  const deleteRate = useDeleteShippingRate();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<EditFields>({});
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [newRate, setNewRate] = useState<EditFields>({});
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const activeTierNum = defaults?.find(d => d.key === 'evri_active_tier')?.value ?? 1;
  const activeTier = `tier_${activeTierNum}`;

  // Group rates: Evri Domestic (default channel), Evri International, eBay Carriers
  const evriDomestic = (rates ?? []).filter(r => r.channel === 'default' && r.destination === 'domestic');
  const evriInternational = (rates ?? []).filter(r => r.channel === 'default' && r.destination === 'international');
  const ebayRates = (rates ?? []).filter(r => r.channel === 'ebay');

  // For Evri domestic, group by size_band+service_name to show tier comparison
  type TierGroup = { service_name: string; size_band: string; max_weight_kg: number; dims: string; tiers: Record<string, ShippingRate> };
  const evriGroups: TierGroup[] = [];
  const groupMap = new Map<string, TierGroup>();
  for (const r of evriDomestic) {
    const key = `${r.size_band}|${r.service_name}`;
    if (!groupMap.has(key)) {
      const g: TierGroup = { service_name: r.service_name, size_band: r.size_band, max_weight_kg: r.max_weight_kg, dims: r.max_length_cm && r.max_width_cm && r.max_depth_cm ? `${r.max_length_cm}×${r.max_width_cm}×${r.max_depth_cm}` : '—', tiers: {} };
      groupMap.set(key, g);
      evriGroups.push(g);
    }
    if (r.tier) groupMap.get(key)!.tiers[r.tier] = r;
  }

  // eBay rates grouped by carrier
  const ebayByCarrier: Record<string, ShippingRate[]> = {};
  for (const r of ebayRates) {
    (ebayByCarrier[r.carrier] ??= []).push(r);
  }

  const startEdit = (r: ShippingRate) => { setEditingId(r.id); setEditData({ ...r }); };
  const cancelEdit = () => setEditingId(null);

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await upsert.mutateAsync({ id: editingId, ...editData } as any);
      toast.success('Rate updated');
      setEditingId(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  const startAdd = (channel: string, carrier: string, destination: string, tier: string | null) => {
    const key = `${channel}|${carrier}|${destination}`;
    setAddingKey(key);
    setNewRate(emptyRate(carrier, channel, destination, tier));
  };

  const saveNew = async () => {
    if (!newRate.service_name?.trim()) { toast.error('Service name required'); return; }
    try {
      await upsert.mutateAsync(newRate as any);
      toast.success('Rate added');
      setAddingKey(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteRate.mutateAsync(deleteTarget); toast.success('Deleted'); } catch { toast.error('Failed'); }
    setDeleteTarget(null);
  };

  const toggleActive = async (r: ShippingRate) => {
    try { await upsert.mutateAsync({ id: r.id, carrier: r.carrier, service_name: r.service_name, active: !r.active }); } catch { toast.error('Failed'); }
  };

  if (isLoading) {
    return <AdminV2Layout><div className="p-4 text-zinc-500 text-sm">Loading...</div></AdminV2Layout>;
  }

  return (
    <AdminV2Layout>
      <div>
        <h1 className="text-[22px] font-bold text-zinc-900 mb-1">Shipping Rates</h1>
        <p className="text-zinc-500 text-[13px] mb-5">
          Carrier rates used by the pricing engine. Evri-first strategy: all orders default to Evri direct to accumulate volume for higher tier discounts.
        </p>

        {/* Evri Domestic — Tier Comparison */}
        <div className="mb-6">
          <SectionHead>
            <span className="flex items-center gap-2">
              Evri Domestic
              <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700">Active: Tier {activeTierNum}</Badge>
            </span>
          </SectionHead>
          <SurfaceCard>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 text-zinc-500 text-left">
                    <th className="py-2 px-2 font-medium">Service</th>
                    <th className="py-2 px-2 font-medium">Size Band</th>
                    <th className="py-2 px-2 font-medium text-right">Max Weight</th>
                    <th className="py-2 px-2 font-medium">Dimensions</th>
                    <th className="py-2 px-2 font-medium text-right">Tier 1</th>
                    <th className="py-2 px-2 font-medium text-right">Tier 2</th>
                    <th className="py-2 px-2 font-medium text-right">Tier 3</th>
                  </tr>
                </thead>
                <tbody>
                  {evriGroups.map((g, i) => (
                    <tr key={i} className="border-b border-zinc-100 hover:bg-zinc-50">
                      <td className="py-2 px-2 text-zinc-800 font-medium">{g.service_name}</td>
                      <td className="py-2 px-2 text-zinc-500">{g.size_band}</td>
                      <td className="py-2 px-2 text-right font-mono text-zinc-700">{g.max_weight_kg}kg</td>
                      <td className="py-2 px-2 font-mono text-zinc-400 text-[10px]">{g.dims}</td>
                      {['tier_1', 'tier_2', 'tier_3'].map(t => {
                        const r = g.tiers[t];
                        const isActive = t === activeTier;
                        return (
                          <td key={t} className={`py-2 px-2 text-right font-mono cursor-pointer ${isActive ? 'text-amber-700 font-bold bg-amber-50/50' : 'text-zinc-500'}`}
                              onClick={() => r && startEdit(r)}>
                            {r ? `£${Number(r.cost).toFixed(2)}` : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SurfaceCard>
        </div>

        {/* Evri International */}
        {evriInternational.length > 0 && (
          <div className="mb-6">
            <SectionHead>Evri International</SectionHead>
            <SurfaceCard>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 text-zinc-500 text-left">
                      <th className="py-2 px-2 font-medium">Service</th>
                      <th className="py-2 px-2 font-medium">Size Band</th>
                      <th className="py-2 px-2 font-medium text-right">Max Weight</th>
                      <th className="py-2 px-2 font-medium">Dimensions</th>
                      <th className="py-2 px-2 font-medium text-right">Cost (ex-VAT)</th>
                      <th className="py-2 px-2 font-medium text-right">Price (inc-VAT)</th>
                      <th className="py-2 px-2 font-medium">Tracked</th>
                      <th className="py-2 px-2 font-medium">Active</th>
                      <th className="py-2 px-2 font-medium w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {evriInternational.map(r => (
                      <RateRow key={r.id} rate={r} editing={editingId === r.id} editData={editData}
                        onStartEdit={startEdit} onSave={saveEdit} onCancel={cancelEdit}
                        onDelete={id => setDeleteTarget(id)} onToggleActive={toggleActive}
                        onSetEditData={setEditData} />
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={() => startAdd('default', 'Evri', 'international', null)} className="mt-2 flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-500 font-medium">
                <Plus className="h-3 w-3" /> Add rate
              </button>
            </SurfaceCard>
          </div>
        )}

        {/* eBay Carrier Rates */}
        <div className="mb-6">
          <SectionHead>
            <span className="flex items-center gap-2">
              eBay Carrier Rates
              <Badge variant="outline" className="text-[10px] border-blue-400 text-blue-700">Channel: eBay</Badge>
            </span>
          </SectionHead>
          {Object.keys(ebayByCarrier).sort().map(carrier => (
            <SurfaceCard key={carrier} className="mb-3">
              <h3 className="text-xs font-semibold text-zinc-700 mb-2">{carrier}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 text-zinc-500 text-left">
                      <th className="py-2 px-2 font-medium">Service</th>
                      <th className="py-2 px-2 font-medium">Size Band</th>
                      <th className="py-2 px-2 font-medium text-right">Max Weight</th>
                      <th className="py-2 px-2 font-medium">Dimensions</th>
                      <th className="py-2 px-2 font-medium text-right">Cost (ex-VAT)</th>
                      <th className="py-2 px-2 font-medium text-right">Price (inc-VAT)</th>
                      <th className="py-2 px-2 font-medium">Tracked</th>
                      <th className="py-2 px-2 font-medium">Active</th>
                      <th className="py-2 px-2 font-medium w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ebayByCarrier[carrier].map(r => (
                      <RateRow key={r.id} rate={r} editing={editingId === r.id} editData={editData}
                        onStartEdit={startEdit} onSave={saveEdit} onCancel={cancelEdit}
                        onDelete={id => setDeleteTarget(id)} onToggleActive={toggleActive}
                        onSetEditData={setEditData} />
                    ))}
                  </tbody>
                </table>
              </div>
              {addingKey !== `ebay|${carrier}|domestic` && (
                <button onClick={() => startAdd('ebay', carrier, 'domestic', null)} className="mt-2 flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-500 font-medium">
                  <Plus className="h-3 w-3" /> Add rate
                </button>
              )}
            </SurfaceCard>
          ))}
        </div>

        <button
          onClick={() => {
            const name = prompt('Enter carrier name:');
            if (name?.trim()) startAdd('ebay', name.trim(), 'domestic', null);
          }}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-amber-600 font-medium mt-2"
        >
          <Plus className="h-3.5 w-3.5" /> Add eBay carrier
        </button>
      </div>

      {/* Edit dialog for Evri tiered rates */}
      {editingId && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={cancelEdit}>
          <div className="bg-white rounded-lg p-4 shadow-lg max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-3">Edit Rate</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="text-zinc-500">Service Name</label>
              <input className="px-2 py-1 border rounded text-xs" value={editData.service_name ?? ''} onChange={e => setEditData(d => ({ ...d, service_name: e.target.value }))} />
              <label className="text-zinc-500">Cost (ex-VAT)</label>
              <NumInput value={editData.cost} onChange={v => setEditData(d => ({ ...d, cost: v ?? 0 }))} />
              <label className="text-zinc-500">Price (inc-VAT)</label>
              <NumInput value={editData.price_inc_vat} onChange={v => setEditData(d => ({ ...d, price_inc_vat: v ?? 0 }))} />
              <label className="text-zinc-500">Max Weight (kg)</label>
              <NumInput value={editData.max_weight_kg} onChange={v => setEditData(d => ({ ...d, max_weight_kg: v ?? 0 }))} />
              <label className="text-zinc-500">Tracked</label>
              <Switch checked={editData.tracked ?? false} onCheckedChange={v => setEditData(d => ({ ...d, tracked: v }))} />
              <label className="text-zinc-500">Active</label>
              <Switch checked={editData.active ?? true} onCheckedChange={v => setEditData(d => ({ ...d, active: v }))} />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={cancelEdit} className="text-xs text-zinc-500 px-3 py-1.5 border rounded">Cancel</button>
              <button onClick={saveEdit} className="text-xs text-white bg-amber-600 px-3 py-1.5 rounded">Save</button>
            </div>
          </div>
        </div>
      )}

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
