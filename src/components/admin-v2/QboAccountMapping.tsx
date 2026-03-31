// ============================================================
// QBO Account Mapping — Settings Panel
// Shows configured QBO account mappings for payout sync.
// Allows editing account IDs and names.
// ============================================================

import { useState } from "react";
import {
  useQboAccountMapping,
  useUpdateAccountMapping,
} from "@/hooks/admin/use-qbo-account-mapping";
import { SurfaceCard, Mono, SectionHead } from "./ui-primitives";
import { toast } from "sonner";

const PURPOSE_LABELS: Record<string, string> = {
  bank_account: "Bank Account",
  undeposited_funds: "Undeposited Funds",
  ebay_selling_fees: "eBay Selling Fees",
  ebay_advertising: "eBay Advertising",
  ebay_international_fees: "eBay International Fees",
  ebay_regulatory_fees: "eBay Regulatory Fees",
  ebay_shipping_labels: "eBay Shipping Labels",
  ebay_other_costs: "eBay Other Costs",
  ebay_vendor: "eBay Vendor",
};

export function QboAccountMapping() {
  const { data: mappings = [], isLoading } = useQboAccountMapping();
  const updateMapping = useUpdateAccountMapping();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{
    qboAccountId: string;
    qboAccountName: string;
  }>({ qboAccountId: "", qboAccountName: "" });

  const startEdit = (entry: { purpose: string; qboAccountId: string; qboAccountName: string }) => {
    setEditingId(entry.purpose);
    setEditValues({
      qboAccountId: entry.qboAccountId,
      qboAccountName: entry.qboAccountName,
    });
  };

  const saveEdit = async (purpose: string, accountType: string) => {
    if (!editValues.qboAccountId.trim()) {
      toast.error("Account ID is required");
      return;
    }
    try {
      await updateMapping.mutateAsync({
        purpose,
        qboAccountId: editValues.qboAccountId.trim(),
        qboAccountName: editValues.qboAccountName.trim() || purpose,
        accountType,
      });
      toast.success("Mapping updated");
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  if (isLoading) {
    return (
      <div>
        <SectionHead>QBO Account Mapping</SectionHead>
        <p className="text-zinc-500 text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <SectionHead>QBO Account Mapping</SectionHead>
      <p className="text-zinc-500 text-xs mb-3">
        Maps eBay fee categories to QBO expense accounts. Accounts are auto-created on first payout sync.
      </p>
      {mappings.length === 0 ? (
        <SurfaceCard>
          <p className="text-zinc-400 text-sm">
            No mappings configured yet. They will be created automatically when you sync your first payout to QBO.
          </p>
        </SurfaceCard>
      ) : (
        <SurfaceCard noPadding className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-zinc-200">
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-medium text-zinc-500">
                  Purpose
                </th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-medium text-zinc-500">
                  QBO Account Name
                </th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-medium text-zinc-500">
                  QBO ID
                </th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-medium text-zinc-500">
                  Type
                </th>
                <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-medium text-zinc-500">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((entry) => (
                <tr key={entry.purpose} className="border-b border-zinc-200">
                  <td className="px-3 py-2 text-zinc-700">
                    {PURPOSE_LABELS[entry.purpose] ?? entry.purpose}
                  </td>
                  {editingId === entry.purpose ? (
                    <>
                      <td className="px-3 py-2">
                        <input
                          value={editValues.qboAccountName}
                          onChange={(e) =>
                            setEditValues((v) => ({ ...v, qboAccountName: e.target.value }))
                          }
                          className="w-full px-1.5 py-1 text-xs border border-zinc-300 rounded bg-white text-zinc-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={editValues.qboAccountId}
                          onChange={(e) =>
                            setEditValues((v) => ({ ...v, qboAccountId: e.target.value }))
                          }
                          className="w-20 px-1.5 py-1 text-xs border border-zinc-300 rounded bg-white text-zinc-900 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-zinc-600">{entry.qboAccountName}</td>
                      <td className="px-3 py-2">
                        <Mono color="dim">{entry.qboAccountId}</Mono>
                      </td>
                    </>
                  )}
                  <td className="px-3 py-2 text-zinc-500">{entry.accountType}</td>
                  <td className="px-3 py-2 text-right">
                    {editingId === entry.purpose ? (
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => saveEdit(entry.purpose, entry.accountType)}
                          disabled={updateMapping.isPending}
                          className="text-amber-600 hover:text-amber-700 text-[11px] cursor-pointer bg-transparent border-none font-medium"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-zinc-400 hover:text-zinc-600 text-[11px] cursor-pointer bg-transparent border-none"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(entry)}
                        className="text-zinc-400 hover:text-zinc-700 text-[11px] cursor-pointer bg-transparent border-none transition-colors"
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SurfaceCard>
      )}
    </div>
  );
}
