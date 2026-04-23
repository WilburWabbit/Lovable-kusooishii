import { useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useCreatePurchaseBatch } from "@/hooks/admin/use-purchase-batches";
import { useProducts } from "@/hooks/admin/use-products";
import type { SharedCosts, Product, ProductVariant } from "@/lib/types/admin";
import { SurfaceCard, Mono, SectionHead, BackButton } from "./ui-primitives";
import { toast } from "sonner";

interface LineItemDraft {
  key: number;
  mpn: string;
  name: string;
  quantity: number;
  unitCost: number;
}

let nextKey = 1;

export function NewPurchaseForm() {
  const navigate = useNavigate();
  const createBatch = useCreatePurchaseBatch();
  const { data: products = [] } = useProducts();

  // Persistent error banner — toasts auto-hide too quickly to read DB errors
  const [submitError, setSubmitError] = useState<string | null>(null);

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
    { key: nextKey++, mpn: "", name: "", quantity: 1, unitCost: 0 },
  ]);

  // For each line: lookup the existing product by MPN (case-insensitive)
  const lineProductMatches = useMemo(() => {
    return lineItems.map((li) => {
      const mpn = li.mpn.trim().toLowerCase();
      if (!mpn) return null;
      return products.find((p) => p.mpn.toLowerCase() === mpn) ?? null;
    });
  }, [lineItems, products]);

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
      { key: nextKey++, mpn: "", name: "", quantity: 1, unitCost: 0 },
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

  // For new MPNs (not in catalog), the operator must enter a Product Name so it
  // flows correctly into QBO. Existing MPNs reuse the stored name automatically.
  const canSubmit =
    supplierName.trim() !== "" &&
    lineItems.length > 0 &&
    lineItems.every((li, idx) => {
      const baseValid = li.mpn.trim() !== "" && li.quantity > 0 && li.unitCost > 0;
      if (!baseValid) return false;
      const isNew = !lineProductMatches[idx];
      if (isNew && li.name.trim() === "") return false;
      return true;
    });

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitError(null);

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
        lineItems: lineItems.map((li, idx) => ({
          mpn: li.mpn.trim(),
          name: lineProductMatches[idx]
            ? lineProductMatches[idx]!.name
            : li.name.trim() || undefined,
          quantity: li.quantity,
          unitCost: li.unitCost,
        })),
      });
      toast.success("Purchase batch created");
      navigate(`/admin/purchases/${batchId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create batch";
      toast.error(message, { duration: 10000 });
      setSubmitError(message);
    }
  };

  return (
    <div>
      <BackButton onClick={() => navigate("/admin/purchases")} label="Back to purchases" />
      <h1 className="text-[22px] font-bold text-zinc-900 mb-5">New Purchase</h1>

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
            <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer mt-1">
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
        <div className="px-4 py-3 border-b border-zinc-200 flex justify-between items-center">
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
            <tr className="border-b border-zinc-200">
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
                <tr key={li.key} className="border-b border-zinc-200">
                  <td className="px-3 py-2">
                    <MpnAutocomplete
                      value={li.mpn}
                      onChange={(v) => updateLine(li.key, "mpn", v)}
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
                      className="w-16 px-2 py-1 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-xs text-center"
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
                      className="w-20 px-2 py-1 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-xs"
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
        <div className="px-4 py-3 border-t border-zinc-200 flex justify-between text-xs text-zinc-500">
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

      {/* Persistent error banner — DB errors need time to read */}
      {submitError && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 flex items-start gap-3">
          <div className="flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-red-700 mb-1">
              Purchase batch creation failed
            </div>
            <div className="text-xs text-red-900 whitespace-pre-wrap break-words font-mono">
              {submitError}
            </div>
          </div>
          <button
            onClick={() => setSubmitError(null)}
            className="text-red-700 hover:text-red-900 text-sm bg-transparent border-none cursor-pointer"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

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
          onClick={() => navigate("/admin/purchases")}
          className="px-4 py-2.5 bg-zinc-200 text-zinc-600 border border-zinc-200 rounded-md text-[13px] cursor-pointer hover:text-zinc-800 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────

// ─── MPN Autocomplete ───────────────────────────────────────

function MpnAutocomplete({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { data: products = [] } = useProducts();
  const [focused, setFocused] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    if (!value || value.length < 2) return [];
    const q = value.toLowerCase();
    return products
      .filter((p) => p.mpn.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [value, products]);

  const matchedProduct = products.find(
    (p) => p.mpn.toLowerCase() === value.toLowerCase()
  );

  const totalOnHand = matchedProduct
    ? (matchedProduct as Product & { variants: ProductVariant[] }).variants.reduce(
        (s: number, v: ProductVariant) => s + v.qtyOnHand,
        0
      )
    : 0;
  const avgCost = matchedProduct
    ? (matchedProduct as Product & { variants: ProductVariant[] }).variants.reduce(
        (s: number, v: ProductVariant) => s + (v.avgCost ?? 0) * v.qtyOnHand,
        0
      ) / (totalOnHand || 1)
    : 0;

  return (
    <div ref={wrapperRef} className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="e.g. 75348-1"
        className="w-32 px-2 py-1 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-xs font-mono"
      />
      {focused && suggestions.length > 0 && (
        <div className="absolute z-20 top-full left-0 w-56 mt-1 bg-white border border-zinc-200 rounded-md shadow-lg max-h-40 overflow-auto">
          {suggestions.map((p) => (
            <button
              key={p.mpn}
              onMouseDown={() => onChange(p.mpn)}
              className="w-full text-left px-2.5 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 transition-colors border-none bg-transparent cursor-pointer"
            >
              <span className="font-mono text-amber-500">{p.mpn}</span>{" "}
              <span className="text-zinc-500">{p.name}</span>
            </button>
          ))}
        </div>
      )}
      {value && matchedProduct && (
        <div className="text-[10px] text-zinc-500 mt-0.5">
          {totalOnHand > 0 ? (
            <span>
              {totalOnHand} on hand at £{avgCost.toFixed(2)} avg
            </span>
          ) : (
            <span className="text-amber-500/70">New to catalogue</span>
          )}
        </div>
      )}
      {value && value.length >= 3 && !matchedProduct && (
        <div className="text-[10px] text-amber-500/70 mt-0.5">New to catalogue</div>
      )}
    </div>
  );
}

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
          background: #F9FAFB;
          border: 1px solid #E4E4E7;
          border-radius: 4px;
          color: #18181B;
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
