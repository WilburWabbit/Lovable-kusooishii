// ============================================================
// CanonicalAttributesPanel
// CRUD for the canonical_attribute registry. Each attribute lists
// its provider chain (product / brickeconomy / catalog / derived /
// constant) and an optional db_column used for editable writes.
// ============================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useCanonicalAttributes,
  useUpsertCanonicalAttribute,
  useDeleteCanonicalAttribute,
  type CanonicalAttributeRecord,
} from "@/hooks/admin/use-channel-taxonomy";
import { SurfaceCard, SectionHead } from "@/components/admin-v2/ui-primitives";

const PROVIDERS = [
  "product",
  "brickeconomy",
  "catalog",
  "rebrickable",
  "theme",
  "derived",
  "constant",
] as const;

const EDITORS = ["text", "number", "date", "textarea", "select", "readOnly"] as const;
const DATA_TYPES = ["string", "number", "date", "boolean"] as const;
const GROUPS = ["identity", "physical", "lifecycle", "marketing", "other"] as const;

const EMPTY: CanonicalAttributeRecord = {
  key: "",
  label: "",
  attribute_group: "identity",
  editor: "text",
  data_type: "string",
  unit: null,
  db_column: null,
  provider_chain: [{ provider: "product", field: "" }],
  editable: true,
  sort_order: 100,
  active: true,
};

export function CanonicalAttributesPanel() {
  const { data: attrs, isLoading } = useCanonicalAttributes();
  const upsert = useUpsertCanonicalAttribute();
  const remove = useDeleteCanonicalAttribute();
  const [editing, setEditing] = useState<CanonicalAttributeRecord | null>(null);

  const sorted = useMemo(
    () => [...(attrs ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [attrs],
  );

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.key || !editing.label) {
      toast.error("Key and label are required");
      return;
    }
    try {
      await upsert.mutateAsync(editing);
      toast.success(`Saved attribute: ${editing.key}`);
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  const handleDelete = async (key: string) => {
    if (!confirm(`Delete canonical attribute "${key}"? This will break any mappings that use it.`)) return;
    try {
      await remove.mutateAsync(key);
      toast.success(`Deleted: ${key}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between mb-3">
        <div>
          <SectionHead>Canonical Attributes</SectionHead>
          <p className="text-[11px] text-zinc-500 mt-1">
            Master registry of product facts. Each attribute resolves through its
            provider chain at read time. Add a new entry here to surface it on
            every product's Specifications tab.
          </p>
        </div>
        <button
          onClick={() => setEditing({ ...EMPTY })}
          className="bg-amber-500 text-zinc-900 rounded-md px-3 py-1.5 font-bold text-[12px] hover:bg-amber-400"
        >
          + New attribute
        </button>
      </div>

      {isLoading ? (
        <div className="text-[12px] text-zinc-500 py-4">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-200">
                <th className="py-2 px-2">Key</th>
                <th className="py-2 px-2">Label</th>
                <th className="py-2 px-2">Group</th>
                <th className="py-2 px-2">Editor</th>
                <th className="py-2 px-2">DB column</th>
                <th className="py-2 px-2">Provider chain</th>
                <th className="py-2 px-2">Order</th>
                <th className="py-2 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => (
                <tr key={a.key} className="border-b border-zinc-100 hover:bg-zinc-50">
                  <td className="py-2 px-2 font-mono text-zinc-900">{a.key}</td>
                  <td className="py-2 px-2 text-zinc-700">{a.label}</td>
                  <td className="py-2 px-2 text-zinc-600">{a.attribute_group}</td>
                  <td className="py-2 px-2 text-zinc-600">{a.editor}</td>
                  <td className="py-2 px-2 font-mono text-zinc-500">{a.db_column ?? "—"}</td>
                  <td className="py-2 px-2 text-zinc-500">
                    {(a.provider_chain ?? [])
                      .map((s) => `${s.provider}.${s.field || "*"}`)
                      .join(" → ")}
                  </td>
                  <td className="py-2 px-2 text-zinc-500">{a.sort_order}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => setEditing({ ...a })}
                      className="text-[11px] text-amber-600 hover:underline mr-3"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(a.key)}
                      className="text-[11px] text-red-500 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-zinc-500 text-[12px]">
                    No attributes yet — click "New attribute" to seed the registry.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <AttributeEditor
          value={editing}
          onChange={setEditing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          saving={upsert.isPending}
        />
      )}
    </SurfaceCard>
  );
}

function AttributeEditor({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  value: CanonicalAttributeRecord;
  onChange: (v: CanonicalAttributeRecord) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const set = <K extends keyof CanonicalAttributeRecord>(
    k: K,
    v: CanonicalAttributeRecord[K],
  ) => onChange({ ...value, [k]: v });

  const updateChain = (idx: number, field: "provider" | "field", v: string) => {
    const next = [...(value.provider_chain ?? [])];
    next[idx] = { ...next[idx], [field]: v };
    set("provider_chain", next);
  };

  const addChainStep = () =>
    set("provider_chain", [
      ...(value.provider_chain ?? []),
      { provider: "product", field: "" },
    ]);

  const removeChainStep = (idx: number) =>
    set(
      "provider_chain",
      (value.provider_chain ?? []).filter((_, i) => i !== idx),
    );

  const moveChainStep = (idx: number, dir: -1 | 1) => {
    const chain = [...(value.provider_chain ?? [])];
    const target = idx + dir;
    if (target < 0 || target >= chain.length) return;
    [chain[idx], chain[target]] = [chain[target], chain[idx]];
    set("provider_chain", chain);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
          <h2 className="text-[14px] font-bold text-zinc-900">
            {value.id ? "Edit attribute" : "New canonical attribute"}
          </h2>
          <button
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-700 text-[20px] leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4 text-[12px]">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Key (snake_case)">
              <input
                value={value.key}
                onChange={(e) => set("key", e.target.value)}
                placeholder="e.g. age_mark"
                className="w-full px-2 py-1.5 border border-zinc-200 rounded font-mono"
              />
            </Field>
            <Field label="Label">
              <input
                value={value.label}
                onChange={(e) => set("label", e.target.value)}
                placeholder="e.g. Age Mark"
                className="w-full px-2 py-1.5 border border-zinc-200 rounded"
              />
            </Field>
            <Field label="Group">
              <select
                value={value.attribute_group}
                onChange={(e) => set("attribute_group", e.target.value)}
                className="w-full px-2 py-1.5 border border-zinc-200 rounded"
              >
                {GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sort order">
              <input
                type="number"
                value={value.sort_order}
                onChange={(e) => set("sort_order", Number(e.target.value))}
                className="w-full px-2 py-1.5 border border-zinc-200 rounded font-mono"
              />
            </Field>
            <Field label="Editor">
              <select
                value={value.editor}
                onChange={(e) => set("editor", e.target.value)}
                className="w-full px-2 py-1.5 border border-zinc-200 rounded"
              >
                {EDITORS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Data type">
              <select
                value={value.data_type}
                onChange={(e) => set("data_type", e.target.value)}
                className="w-full px-2 py-1.5 border border-zinc-200 rounded"
              >
                {DATA_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Unit (optional)">
              <input
                value={value.unit ?? ""}
                onChange={(e) => set("unit", e.target.value || null)}
                placeholder="e.g. cm, g"
                className="w-full px-2 py-1.5 border border-zinc-200 rounded"
              />
            </Field>
            <Field label="DB column (for writes)">
              <input
                value={value.db_column ?? ""}
                onChange={(e) => set("db_column", e.target.value || null)}
                placeholder="e.g. age_mark"
                className="w-full px-2 py-1.5 border border-zinc-200 rounded font-mono"
              />
            </Field>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={value.editable}
                onChange={(e) => set("editable", e.target.checked)}
                className="accent-amber-500"
              />
              Editable
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={value.active}
                onChange={(e) => set("active", e.target.checked)}
                className="accent-amber-500"
              />
              Active
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
                Provider chain (first non-empty wins)
              </div>
              <button
                onClick={addChainStep}
                className="text-[11px] text-amber-600 hover:underline"
              >
                + Add step
              </button>
            </div>
            <div className="space-y-2">
              {(value.provider_chain ?? []).map((step, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <span className="text-zinc-400 text-[11px] w-4">{idx + 1}.</span>
                  <select
                    value={step.provider}
                    onChange={(e) => updateChain(idx, "provider", e.target.value)}
                    className="px-2 py-1.5 border border-zinc-200 rounded"
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <input
                    value={step.field}
                    onChange={(e) => updateChain(idx, "field", e.target.value)}
                    placeholder={
                      step.provider === "constant"
                        ? "constant value"
                        : step.provider === "derived"
                          ? "derive rule (e.g. mpn_base)"
                          : "field name"
                    }
                    className="flex-1 px-2 py-1.5 border border-zinc-200 rounded font-mono"
                  />
                  <button
                    onClick={() => removeChainStep(idx)}
                    className="text-red-500 hover:text-red-700 px-2"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-zinc-200 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-[12px] border border-zinc-200 rounded hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-4 py-1.5 text-[12px] font-bold bg-amber-500 text-zinc-900 rounded hover:bg-amber-400 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
