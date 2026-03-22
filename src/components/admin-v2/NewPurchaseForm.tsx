import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useCreatePurchaseBatch } from "@/hooks/admin/use-purchase-batches";
import type { SharedCosts } from "@/lib/types/admin";
import { SurfaceCard, Mono, SectionHead, BackButton } from "./ui-primitives";
import { toast } from "sonner";

interface LineItemDraft {
  key: number;
  mpn: string;
  quantity: number;
  unitCost: number;
}

let nextKey = 1;

export function NewPurchaseForm() {
  const navigate = useNavigate();
  const createBatch = useCreatePurchaseBatch();

  // Batch header
  const [supplierName, setSupplierName] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [reference, setReference] = useState("");
  const [vatRegistered, setVatRegistered] = useState(false);

  // Shared costs
  const [shipping, setShipping] = useState(0);
  const [brokerFee, setBrokerFee] = useState(0);
  const [otherCost, setOtherCost] = useState(0);
  const [otherLabel, setOtherLabel] = useState("");

  // Line items
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([
    { key: nextKey++, mpn: "", quantity: 1, unitCost: 0 },
  ]);

  const totalSharedCosts = shipping + brokerFee + otherCost;
  const totalMerchandise = lineItems.reduce(
    (sum, li) => sum + li.unitCost * li.quantity,
    0
  );
  const totalAllUnitCosts = lineItems.reduce(
    (sum, li) => sum + li.unitCost * li.quantity,
    0
  );

  // Apportionment preview
  const apportionments = useMemo(() => {
    if (totalAllUnitCosts === 0) return lineItems.map(() => 0);
    return lineItems.map(
      (li) =>
        ((li.unitCost * li.quantity) / totalAllUnitCosts) * totalSharedCosts / li.quantity
    );
  }, [lineItems, totalAllUnitCosts, totalSharedCosts]);

  const addLine = () => {
    setLineItems((prev) => [
      ...prev,
      { key: nextKey++, mpn: "", quantity: 1, unitCost: 0 },
    ]);
  };

  const removeLine = (key: number) => {
    setLineItems((prev) => prev.filter((li) => li.key !== key));
  };

  const updateLine = (
    key: number,
    field: keyof Omit<LineItemDraft, "key">,
    value: string | number
  ) => {
    setLineItems((prev) =>
      prev.map((li) =>
        li.key === key ? { ...li, [field]: value } : li
      )
    );
  };

  const canSubmit =
    supplierName.trim() !== "" &&
    lineItems.length > 0 &&
    lineItems.every((li) => li.mpn.trim() !== "" && li.quantity > 0 && li.unitCost > 0);

  const handleSubmit = async () => {
    if (!canSubmit) return;

    const sharedCosts: SharedCosts = {
      shipping,
      broker_fee: brokerFee,
      other: otherCost,
      other_label: otherLabel,
    };

    try {
      const batchId = await createBatch.mutateAsync({
        supplierName: supplierName.trim(),
        purchaseDate,
        reference: reference.trim() || undefined,
        supplierVatRegistered: vatRegistered,
        sharedCosts,
        lineItems: lineItems.map((li) => ({
          mpn: li.mpn.trim(),
          quantity: li.quantity,
          unitCost: li.unitCost,
        })),
      });
      toast.success("Purchase batch created");
      navigate(`/admin/v2/purchases/${batchId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create batch";
      toast.error(message);
    }
  };

  return (
    <div>
      <BackButton onClick={() => navigate("/admin/v2/purchases")} label="Back to purchases" />
      <h1 className="text-[22px] font-bold text-zinc-50 mb-5">New Purchase</h1>

      {/* Batch header */}
      <SurfaceCard className="mb-4">
        <SectionHead>Batch Details</SectionHead>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Supplier" required>
            <input
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="e.g. ReturnsPal Ltd"
              className="form-input"
            />
          </FormField>
          <FormField label="Purchase Date">
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className="form-input"
            />
          </FormField>
          <FormField label="Reference">
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Optional PO reference"
              className="form-input"
            />
          </FormField>
          <FormField label="Supplier VAT registered?">
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer mt-1">
              <input
                type="checkbox"
                checked={vatRegistered}
                onChange={(e) => setVatRegistered(e.target.checked)}
                className="accent-amber-500"
              />
              Yes — unit costs are ex-VAT
            </label>
          </FormField>
        </div>
      </SurfaceCard>

      {/* Shared costs */}
      <SurfaceCard className="mb-4">
        <SectionHead>Shared Costs</SectionHead>
        <div className="grid grid-cols-4 gap-3">
          <FormField label="Shipping (£)">
            <input
              type="number"
              min={0}
              step={0.01}
              value={shipping || ""}
              onChange={(e) => setShipping(Number(e.target.value) || 0)}
              className="form-input"
            />
          </FormField>
          <FormField label="Broker Fee (£)">
            <input
              type="number"
              min={0}
              step={0.01}
              value={brokerFee || ""}
              onChange={(e) => setBrokerFee(Number(e.target.value) || 0)}
              className="form-input"
            />
          </FormField>
          <FormField label="Other (£)">
            <input
              type="number"
              min={0}
              step={0.01}
              value={otherCost || ""}
              onChange={(e) => setOtherCost(Number(e.target.value) || 0)}
              className="form-input"
            />
          </FormField>
          <FormField label="Other Label">
            <input
              value={otherLabel}
              onChange={(e) => setOtherLabel(e.target.value)}
              placeholder="e.g. Import duty"
              className="form-input"
            />
          </FormField>
        </div>
        <div className="mt-2 text-right text-xs text-zinc-500">
          Total shared costs: <Mono color="teal">£{totalSharedCosts.toFixed(2)}</Mono>
        </div>
      </SurfaceCard>

      {/* Line items */}
      <SurfaceCard noPadding className="mb-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-700/80 flex justify-between items-center">
          <SectionHead>Line Items</SectionHead>
          <button
            onClick={addLine}
            className="text-amber-500 text-xs font-semibold cursor-pointer hover:text-amber-400 transition-colors bg-transparent border-none"
          >
            + Add Line
          </button>
        </div>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-zinc-700/80">
              {["MPN", "Qty", "Unit Cost (£)", "Line Total", "Apport./Unit", "Landed/Unit", ""].map(
                (h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-zinc-500 font-medium text-[10px] uppercase tracking-wider"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {lineItems.map((li, idx) => {
              const lineTotal = li.unitCost * li.quantity;
              const apportPerUnit = apportionments[idx] ?? 0;
              const landedPerUnit = li.unitCost + apportPerUnit;

              return (
                <tr key={li.key} className="border-b border-zinc-700/80">
                  <td className="px-3 py-2">
                    <input
                      value={li.mpn}
                      onChange={(e) => updateLine(li.key, "mpn", e.target.value)}
                      placeholder="e.g. 75348-1"
                      className="w-28 px-2 py-1 bg-[#35353A] border border-zinc-700/80 rounded text-zinc-50 text-xs font-mono"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={1}
                      value={li.quantity}
                      onChange={(e) =>
                        updateLine(li.key, "quantity", Math.max(1, parseInt(e.target.value) || 1))
                      }
                      className="w-16 px-2 py-1 bg-[#35353A] border border-zinc-700/80 rounded text-zinc-50 text-xs text-center"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={li.unitCost || ""}
                      onChange={(e) =>
                        updateLine(li.key, "unitCost", Number(e.target.value) || 0)
                      }
                      className="w-20 px-2 py-1 bg-[#35353A] border border-zinc-700/80 rounded text-zinc-50 text-xs"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Mono>£{lineTotal.toFixed(2)}</Mono>
                  </td>
                  <td className="px-3 py-2">
                    <Mono color="dim">
                      {li.unitCost > 0 ? `£${apportPerUnit.toFixed(2)}` : "—"}
                    </Mono>
                  </td>
                  <td className="px-3 py-2">
                    <Mono color="teal">
                      {li.unitCost > 0 ? `£${landedPerUnit.toFixed(2)}` : "—"}
                    </Mono>
                  </td>
                  <td className="px-3 py-2">
                    {lineItems.length > 1 && (
                      <button
                        onClick={() => removeLine(li.key)}
                        className="text-zinc-500 hover:text-red-500 text-xs cursor-pointer bg-transparent border-none transition-colors"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-zinc-700/80 flex justify-between text-xs text-zinc-500">
          <span>
            {lineItems.length} line{lineItems.length !== 1 ? "s" : ""} ·{" "}
            {lineItems.reduce((s, li) => s + li.quantity, 0)} units
          </span>
          <span>
            Merchandise: <Mono color="teal">£{totalMerchandise.toFixed(2)}</Mono> + Shared:{" "}
            <Mono color="dim">£{totalSharedCosts.toFixed(2)}</Mono> ={" "}
            <Mono color="teal" className="font-semibold">
              £{(totalMerchandise + totalSharedCosts).toFixed(2)}
            </Mono>
          </span>
        </div>
      </SurfaceCard>

      {/* Submit */}
      <div className="flex gap-3">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || createBatch.isPending}
          className="bg-amber-500 text-zinc-900 border-none rounded-md px-6 py-2.5 font-bold text-[13px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-400 transition-colors"
        >
          {createBatch.isPending ? "Creating…" : "Create Purchase Batch"}
        </button>
        <button
          onClick={() => navigate("/admin/v2/purchases")}
          className="px-4 py-2.5 bg-[#3F3F46] text-zinc-400 border border-zinc-700/80 rounded-md text-[13px] cursor-pointer hover:text-zinc-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-1">
        {label}
        {required && <span className="text-amber-500 ml-0.5">*</span>}
      </label>
      {children}
      <style>{`
        .form-input {
          width: 100%;
          padding: 7px 9px;
          background: #35353A;
          border: 1px solid rgba(63,63,70,0.8);
          border-radius: 4px;
          color: #FAFAFA;
          font-size: 13px;
          box-sizing: border-box;
        }
        .form-input:focus {
          outline: none;
          border-color: #F59E0B;
        }
        .form-input::placeholder {
          color: #71717A;
        }
      `}</style>
    </div>
  );
}
