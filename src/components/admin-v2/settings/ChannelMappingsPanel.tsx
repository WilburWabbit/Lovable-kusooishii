// ============================================================
// ChannelMappingsPanel
// CRUD for channel_attribute_mapping. Each row maps one channel
// aspect (e.g. eBay "Number of Pieces") to either a canonical
// attribute key or a constant value, optionally scoped to a
// marketplace and/or category.
// ============================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useCanonicalAttributes,
  useChannelMappings,
  useUpsertChannelMapping,
  useDeleteChannelMapping,
  useEbayCategorySuggestions,
  useEbayCategoryAspects,
  type ChannelMappingRecord,
} from "@/hooks/admin/use-channel-taxonomy";
import { SurfaceCard, SectionHead } from "@/components/admin-v2/ui-primitives";

const MARKETPLACES = ["EBAY_GB", "EBAY_US", "EBAY_DE", "EBAY_AU"] as const;

export function ChannelMappingsPanel() {
  const [channel] = useState<"ebay">("ebay");
  const [marketplace, setMarketplace] = useState<string>("EBAY_GB");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryLabel, setCategoryLabel] = useState<string>("All categories (defaults)");

  const { data: mappings, isLoading } = useChannelMappings(channel, marketplace, categoryId);
  const { data: canonicalAttrs } = useCanonicalAttributes();
  const { data: schemaResult } = useEbayCategoryAspects(categoryId, marketplace);

  const upsert = useUpsertChannelMapping();
  const remove = useDeleteChannelMapping();

  const [editing, setEditing] = useState<ChannelMappingRecord | null>(null);

  // Combined view: every aspect from the chosen category schema, plus any
  // mappings that exist outside the schema (rare, but possible).
  const rows = useMemo(() => {
    const byKey = new Map<string, ChannelMappingRecord>();
    for (const m of mappings ?? []) {
      // Prefer most-specific (category > default).
      const cur = byKey.get(m.aspect_key);
      if (
        !cur ||
        (m.category_id && !cur.category_id) ||
        (m.marketplace && !cur.marketplace)
      ) {
        byKey.set(m.aspect_key, m);
      }
    }
    const aspects = (schemaResult?.attributes ?? []).map((a) => ({
      aspectKey: a.key,
      required: a.required,
      mapping: byKey.get(a.key) ?? null,
    }));
    // Append any orphan mappings not in schema.
    const inSchema = new Set(aspects.map((a) => a.aspectKey));
    for (const [key, mapping] of byKey) {
      if (!inSchema.has(key)) {
        aspects.push({ aspectKey: key, required: false, mapping });
      }
    }
    return aspects;
  }, [mappings, schemaResult]);

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.aspect_key) {
      toast.error("Aspect key is required");
      return;
    }
    if (!editing.canonical_key && !editing.constant_value) {
      toast.error("Set a canonical key or a constant value");
      return;
    }
    try {
      await upsert.mutateAsync(editing);
      toast.success("Mapping saved");
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this mapping?")) return;
    try {
      await remove.mutateAsync(id);
      toast.success("Mapping deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const startNew = (aspectKey: string) => {
    setEditing({
      channel,
      marketplace,
      category_id: categoryId,
      aspect_key: aspectKey,
      canonical_key: null,
      constant_value: null,
      transform: null,
      notes: null,
    });
  };

  return (
    <SurfaceCard>
      <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
        <div>
          <SectionHead>Channel Mappings · eBay</SectionHead>
          <p className="text-[11px] text-zinc-500 mt-1 max-w-2xl">
            Map each eBay item-specific to a canonical attribute or a constant
            value. Defaults apply to every category; pick a category to add an
            override.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <select
            value={marketplace}
            onChange={(e) => setMarketplace(e.target.value)}
            className="px-2 py-1.5 text-[12px] border border-zinc-200 rounded"
          >
            {MARKETPLACES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <CategoryPicker
            marketplace={marketplace}
            value={categoryId}
            label={categoryLabel}
            onChange={(id, label) => {
              setCategoryId(id);
              setCategoryLabel(label);
            }}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-[12px] text-zinc-500 py-4">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-200">
                <th className="py-2 px-2">Aspect</th>
                <th className="py-2 px-2">Mapped to</th>
                <th className="py-2 px-2">Scope</th>
                <th className="py-2 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ aspectKey, required, mapping }) => (
                <tr key={aspectKey} className="border-b border-zinc-100 hover:bg-zinc-50">
                  <td className="py-2 px-2">
                    {required && <span className="text-red-500 mr-1">*</span>}
                    <span className="font-mono text-zinc-900">{aspectKey}</span>
                  </td>
                  <td className="py-2 px-2">
                    {mapping?.canonical_key ? (
                      <span className="text-zinc-700">
                        canonical:{" "}
                        <span className="font-mono text-amber-700">
                          {mapping.canonical_key}
                        </span>
                      </span>
                    ) : mapping?.constant_value ? (
                      <span className="text-zinc-700">
                        constant:{" "}
                        <span className="font-mono text-zinc-900">
                          "{mapping.constant_value}"
                        </span>
                      </span>
                    ) : (
                      <span className="text-zinc-400 italic">unmapped</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-[11px] text-zinc-500">
                    {mapping
                      ? `${mapping.marketplace ?? "any mkt"} · ${mapping.category_id ?? "any cat"}`
                      : "—"}
                  </td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">
                    {mapping ? (
                      <>
                        <button
                          onClick={() => setEditing({ ...mapping })}
                          className="text-[11px] text-amber-600 hover:underline mr-3"
                        >
                          Edit
                        </button>
                        {mapping.id && (
                          <button
                            onClick={() => handleDelete(mapping.id!)}
                            className="text-[11px] text-red-500 hover:underline"
                          >
                            Delete
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        onClick={() => startNew(aspectKey)}
                        className="text-[11px] text-amber-600 hover:underline"
                      >
                        Map
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-zinc-500 text-[12px]">
                    {categoryId
                      ? "Schema not loaded. Open a product with this category once to cache it, or refresh."
                      : "Pick a category to see its eBay aspects, or add a default mapping below."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3">
        <button
          onClick={() =>
            setEditing({
              channel,
              marketplace,
              category_id: categoryId,
              aspect_key: "",
              canonical_key: null,
              constant_value: null,
              transform: null,
              notes: null,
            })
          }
          className="text-[12px] text-amber-600 hover:underline"
        >
          + Add custom mapping
        </button>
      </div>

      {editing && (
        <MappingEditor
          value={editing}
          onChange={setEditing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          saving={upsert.isPending}
          canonicalKeys={(canonicalAttrs ?? []).map((a) => a.key)}
        />
      )}
    </SurfaceCard>
  );
}

// ─── Category picker dropdown ──────────────────────────────

function CategoryPicker({
  marketplace,
  value,
  label,
  onChange,
}: {
  marketplace: string;
  value: string | null;
  label: string;
  onChange: (id: string | null, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  // Debounce
  useMemo(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data: suggestions, isFetching } = useEbayCategorySuggestions(debounced, marketplace);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-1.5 text-[12px] border border-zinc-200 rounded bg-white hover:bg-zinc-50 max-w-[280px] truncate"
      >
        {label}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-[360px] bg-white border border-zinc-200 rounded-md shadow-lg z-20 p-2">
          <div className="flex justify-between items-center mb-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search eBay categories…"
              className="flex-1 px-2 py-1.5 text-[12px] border border-zinc-200 rounded"
              autoFocus
            />
            <button
              onClick={() => {
                onChange(null, "All categories (defaults)");
                setOpen(false);
              }}
              className="ml-2 text-[11px] text-zinc-500 hover:text-zinc-700"
            >
              Clear
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {debounced.length < 2 ? (
              <div className="text-[11px] text-zinc-500 p-2">Type at least 2 characters.</div>
            ) : isFetching ? (
              <div className="text-[11px] text-zinc-500 p-2">Searching…</div>
            ) : suggestions && suggestions.length > 0 ? (
              <ul className="divide-y divide-zinc-100">
                {suggestions.map((s) => (
                  <li key={s.categoryId}>
                    <button
                      onClick={() => {
                        onChange(s.categoryId, `${s.categoryName} · ${s.categoryId}`);
                        setOpen(false);
                      }}
                      className="w-full text-left px-2 py-1.5 hover:bg-amber-50 rounded text-[12px]"
                    >
                      <div className="text-zinc-900">{s.categoryName}</div>
                      <div className="text-[10px] text-zinc-500">ID {s.categoryId}</div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-[11px] text-zinc-500 p-2">No suggestions.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Mapping editor modal ──────────────────────────────────

function MappingEditor({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  canonicalKeys,
}: {
  value: ChannelMappingRecord;
  onChange: (v: ChannelMappingRecord) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  canonicalKeys: string[];
}) {
  const set = <K extends keyof ChannelMappingRecord>(
    k: K,
    v: ChannelMappingRecord[K],
  ) => onChange({ ...value, [k]: v });

  const mode = value.constant_value != null ? "constant" : "canonical";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
          <h2 className="text-[14px] font-bold text-zinc-900">
            {value.id ? "Edit mapping" : "New mapping"}
          </h2>
          <button
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-700 text-[20px] leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4 text-[12px]">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
              Aspect key
            </label>
            <input
              value={value.aspect_key}
              onChange={(e) => set("aspect_key", e.target.value)}
              placeholder="e.g. Number of Pieces"
              className="w-full px-2 py-1.5 border border-zinc-200 rounded font-mono"
            />
          </div>

          <div className="flex gap-3">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === "canonical"}
                onChange={() => onChange({ ...value, constant_value: null })}
                className="accent-amber-500"
              />
              Canonical attribute
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === "constant"}
                onChange={() => onChange({ ...value, canonical_key: null })}
                className="accent-amber-500"
              />
              Constant value
            </label>
          </div>

          {mode === "canonical" ? (
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                Canonical key
              </label>
              <select
                value={value.canonical_key ?? ""}
                onChange={(e) => set("canonical_key", e.target.value || null)}
                className="w-full px-2 py-1.5 border border-zinc-200 rounded"
              >
                <option value="">— pick one —</option>
                {canonicalKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                Constant value
              </label>
              <input
                value={value.constant_value ?? ""}
                onChange={(e) => set("constant_value", e.target.value || null)}
                placeholder='e.g. "LEGO"'
                className="w-full px-2 py-1.5 border border-zinc-200 rounded font-mono"
              />
            </div>
          )}

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
              Notes
            </label>
            <input
              value={value.notes ?? ""}
              onChange={(e) => set("notes", e.target.value || null)}
              className="w-full px-2 py-1.5 border border-zinc-200 rounded"
            />
          </div>

          <div className="text-[11px] text-zinc-500">
            Scope: {value.marketplace ?? "any marketplace"} ·{" "}
            {value.category_id ?? "any category (default)"}
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
