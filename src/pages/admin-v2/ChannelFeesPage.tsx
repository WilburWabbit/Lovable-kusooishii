import { useState } from 'react';
import { AdminV2Layout } from '@/components/admin-v2/AdminV2Layout';
import { SurfaceCard, SectionHead } from '@/components/admin-v2/ui-primitives';
import { useChannelFees, useUpsertChannelFee, useDeleteChannelFee, type ChannelFee } from '@/hooks/admin/use-channel-fees';
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

const APPLIES_TO_OPTIONS = ['sale_price', 'sale_plus_shipping', 'sale_price_inc_vat'];

function emptyFee(channel: string): Partial<ChannelFee> & { channel: string; fee_name: string } {
  return { channel, fee_name: '', rate_percent: 0, fixed_amount: 0, applies_to: 'sale_price', active: true, notes: '' };
}

export default function ChannelFeesPage() {
  const { data: fees, isLoading } = useChannelFees();
  const upsert = useUpsertChannelFee();
  const deleteFee = useDeleteChannelFee();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [addingChannel, setAddingChannel] = useState<string | null>(null);
  const [newFee, setNewFee] = useState<Record<string, any>>({});
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const grouped = (fees ?? []).reduce<Record<string, ChannelFee[]>>((acc, f) => {
    (acc[f.channel] ??= []).push(f);
    return acc;
  }, {});

  const channels = Object.keys(grouped).sort();

  const startEdit = (fee: ChannelFee) => {
    setEditingId(fee.id);
    setEditData({ ...fee });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await upsert.mutateAsync({ id: editingId, ...editData } as any);
      toast.success('Fee updated');
      setEditingId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const startAdd = (channel: string) => {
    setAddingChannel(channel);
    setNewFee(emptyFee(channel));
  };

  const saveNew = async () => {
    if (!newFee.fee_name?.trim()) { toast.error('Fee name required'); return; }
    try {
      await upsert.mutateAsync(newFee as any);
      toast.success('Fee added');
      setAddingChannel(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteFee.mutateAsync(deleteTarget);
      toast.success('Fee deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
    setDeleteTarget(null);
  };

  const toggleActive = async (fee: ChannelFee) => {
    try {
      await upsert.mutateAsync({ id: fee.id, channel: fee.channel, fee_name: fee.fee_name, active: !fee.active });
    } catch (e) {
      toast.error('Failed to toggle');
    }
  };

  if (isLoading) {
    return (
      <AdminV2Layout>
        <div className="p-4 text-zinc-500 text-sm">Loading...</div>
      </AdminV2Layout>
    );
  }

  return (
    <AdminV2Layout>
      <div>
        <h1 className="text-[22px] font-bold text-zinc-900 mb-1">Selling Fees</h1>
        <p className="text-zinc-500 text-[13px] mb-5">
          Channel fee schedules used by the pricing engine.
        </p>

        {channels.map((ch) => (
          <div key={ch} className="mb-6">
            <SectionHead>{ch.charAt(0).toUpperCase() + ch.slice(1)}</SectionHead>
            <SurfaceCard>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 text-zinc-500 text-left">
                      <th className="py-2 px-2 font-medium">Fee Name</th>
                      <th className="py-2 px-2 font-medium text-right">Rate %</th>
                      <th className="py-2 px-2 font-medium text-right">Fixed £</th>
                      <th className="py-2 px-2 font-medium">Applies To</th>
                      <th className="py-2 px-2 font-medium text-right">Min</th>
                      <th className="py-2 px-2 font-medium text-right">Max</th>
                      <th className="py-2 px-2 font-medium">Active</th>
                      <th className="py-2 px-2 font-medium">Notes</th>
                      <th className="py-2 px-2 font-medium w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[ch].map((fee) => (
                      <tr
                        key={fee.id}
                        className="border-b border-zinc-100 hover:bg-zinc-50 transition-colors cursor-pointer"
                        onClick={() => editingId !== fee.id && startEdit(fee)}
                      >
                        {editingId === fee.id ? (
                          <>
                            <td className="py-1.5 px-2">
                              <input className="w-full px-1.5 py-1 border border-amber-300 rounded text-xs bg-white" value={editData.fee_name} onChange={(e) => setEditData(d => ({ ...d, fee_name: e.target.value }))} />
                            </td>
                            <td className="py-1.5 px-2">
                              <input type="number" step="0.01" className="w-16 px-1.5 py-1 border border-amber-300 rounded text-xs bg-white text-right font-mono" value={editData.rate_percent} onChange={(e) => setEditData(d => ({ ...d, rate_percent: parseFloat(e.target.value) || 0 }))} />
                            </td>
                            <td className="py-1.5 px-2">
                              <input type="number" step="0.01" className="w-16 px-1.5 py-1 border border-amber-300 rounded text-xs bg-white text-right font-mono" value={editData.fixed_amount} onChange={(e) => setEditData(d => ({ ...d, fixed_amount: parseFloat(e.target.value) || 0 }))} />
                            </td>
                            <td className="py-1.5 px-2">
                              <select className="px-1.5 py-1 border border-amber-300 rounded text-xs bg-white" value={editData.applies_to} onChange={(e) => setEditData(d => ({ ...d, applies_to: e.target.value }))}>
                                {APPLIES_TO_OPTIONS.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                              </select>
                            </td>
                            <td className="py-1.5 px-2">
                              <input type="number" step="0.01" className="w-14 px-1.5 py-1 border border-amber-300 rounded text-xs bg-white text-right font-mono" value={editData.min_amount ?? ''} onChange={(e) => setEditData(d => ({ ...d, min_amount: e.target.value ? parseFloat(e.target.value) : null }))} />
                            </td>
                            <td className="py-1.5 px-2">
                              <input type="number" step="0.01" className="w-14 px-1.5 py-1 border border-amber-300 rounded text-xs bg-white text-right font-mono" value={editData.max_amount ?? ''} onChange={(e) => setEditData(d => ({ ...d, max_amount: e.target.value ? parseFloat(e.target.value) : null }))} />
                            </td>
                            <td className="py-1.5 px-2">
                              <Switch checked={editData.active} onCheckedChange={(v) => setEditData(d => ({ ...d, active: v }))} />
                            </td>
                            <td className="py-1.5 px-2">
                              <input className="w-full px-1.5 py-1 border border-amber-300 rounded text-xs bg-white" value={editData.notes ?? ''} onChange={(e) => setEditData(d => ({ ...d, notes: e.target.value }))} />
                            </td>
                            <td className="py-1.5 px-2">
                              <div className="flex gap-1">
                                <button onClick={(e) => { e.stopPropagation(); saveEdit(); }} className="text-amber-600 hover:text-amber-500"><Check className="h-3.5 w-3.5" /></button>
                                <button onClick={(e) => { e.stopPropagation(); setEditingId(null); }} className="text-zinc-400 hover:text-zinc-600"><X className="h-3.5 w-3.5" /></button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-2 px-2 text-zinc-800 font-medium">{fee.fee_name}</td>
                            <td className="py-2 px-2 text-right font-mono text-zinc-700">{fee.rate_percent}%</td>
                            <td className="py-2 px-2 text-right font-mono text-zinc-700">£{Number(fee.fixed_amount).toFixed(2)}</td>
                            <td className="py-2 px-2 text-zinc-500">{fee.applies_to.replace(/_/g, ' ')}</td>
                            <td className="py-2 px-2 text-right font-mono text-zinc-500">{fee.min_amount != null ? `£${Number(fee.min_amount).toFixed(2)}` : '—'}</td>
                            <td className="py-2 px-2 text-right font-mono text-zinc-500">{fee.max_amount != null ? `£${Number(fee.max_amount).toFixed(2)}` : '—'}</td>
                            <td className="py-2 px-2">
                              <Switch checked={fee.active} onCheckedChange={() => toggleActive(fee)} onClick={(e) => e.stopPropagation()} />
                            </td>
                            <td className="py-2 px-2 text-zinc-400 truncate max-w-[120px]">{fee.notes || '—'}</td>
                            <td className="py-2 px-2">
                              <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(fee.id); }} className="text-zinc-300 hover:text-red-500 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}

                    {addingChannel === ch && (
                      <tr className="border-b border-amber-200 bg-amber-50/50">
                        <td className="py-1.5 px-2">
                          <input autoFocus className="w-full px-1.5 py-1 border border-amber-300 rounded text-xs bg-white" placeholder="Fee name" value={newFee.fee_name} onChange={(e) => setNewFee(d => ({ ...d, fee_name: e.target.value }))} />
                        </td>
                        <td className="py-1.5 px-2">
                          <input type="number" step="0.01" className="w-16 px-1.5 py-1 border border-amber-300 rounded text-xs bg-white text-right font-mono" value={newFee.rate_percent} onChange={(e) => setNewFee(d => ({ ...d, rate_percent: parseFloat(e.target.value) || 0 }))} />
                        </td>
                        <td className="py-1.5 px-2">
                          <input type="number" step="0.01" className="w-16 px-1.5 py-1 border border-amber-300 rounded text-xs bg-white text-right font-mono" value={newFee.fixed_amount} onChange={(e) => setNewFee(d => ({ ...d, fixed_amount: parseFloat(e.target.value) || 0 }))} />
                        </td>
                        <td className="py-1.5 px-2">
                          <select className="px-1.5 py-1 border border-amber-300 rounded text-xs bg-white" value={newFee.applies_to} onChange={(e) => setNewFee(d => ({ ...d, applies_to: e.target.value }))}>
                            {APPLIES_TO_OPTIONS.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                          </select>
                        </td>
                        <td className="py-1.5 px-2">
                          <input type="number" step="0.01" className="w-14 px-1.5 py-1 border border-amber-300 rounded text-xs bg-white text-right font-mono" value={newFee.min_amount ?? ''} onChange={(e) => setNewFee(d => ({ ...d, min_amount: e.target.value ? parseFloat(e.target.value) : null }))} />
                        </td>
                        <td className="py-1.5 px-2">
                          <input type="number" step="0.01" className="w-14 px-1.5 py-1 border border-amber-300 rounded text-xs bg-white text-right font-mono" value={newFee.max_amount ?? ''} onChange={(e) => setNewFee(d => ({ ...d, max_amount: e.target.value ? parseFloat(e.target.value) : null }))} />
                        </td>
                        <td className="py-1.5 px-2">
                          <Switch checked={newFee.active} onCheckedChange={(v) => setNewFee(d => ({ ...d, active: v }))} />
                        </td>
                        <td className="py-1.5 px-2">
                          <input className="w-full px-1.5 py-1 border border-amber-300 rounded text-xs bg-white" placeholder="Notes" value={newFee.notes ?? ''} onChange={(e) => setNewFee(d => ({ ...d, notes: e.target.value }))} />
                        </td>
                        <td className="py-1.5 px-2">
                          <div className="flex gap-1">
                            <button onClick={saveNew} className="text-amber-600 hover:text-amber-500"><Check className="h-3.5 w-3.5" /></button>
                            <button onClick={() => setAddingChannel(null)} className="text-zinc-400 hover:text-zinc-600"><X className="h-3.5 w-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {addingChannel !== ch && (
                <button
                  onClick={() => startAdd(ch)}
                  className="mt-2 flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-500 font-medium"
                >
                  <Plus className="h-3 w-3" /> Add fee
                </button>
              )}
            </SurfaceCard>
          </div>
        ))}

        {/* Add new channel section */}
        {!addingChannel && (
          <button
            onClick={() => {
              const name = prompt('Enter new channel name (e.g. brickowl):');
              if (name?.trim()) startAdd(name.trim().toLowerCase());
            }}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-amber-600 font-medium mt-2"
          >
            <Plus className="h-3.5 w-3.5" /> Add channel
          </button>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete fee?</AlertDialogTitle>
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
