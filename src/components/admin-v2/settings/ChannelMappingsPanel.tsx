// ============================================================
// ChannelMappingsPanel
// CRUD for channel_attribute_mapping. Each row maps one channel
// aspect (e.g. eBay "Number of Pieces") to either a canonical
// attribute key or a constant value, optionally scoped to a
// marketplace and/or category.
//
// Category selection has two paths:
//   1. A dropdown of categories ALREADY assigned to one or more
//      products (with counts) — fast path for the categories you
//      actually use.
//   2. A free-text search against the eBay taxonomy — for adding
//      mappings to categories you haven't assigned yet.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useCanonicalAttributes,
  useChannelMappings,
  useUpsertChannelMapping,
  useDeleteChannelMapping,
  useEbayCategorySuggestions,
  useEbayCategoryAspects,
  useProductChannelCategories,
  type ChannelMappingRecord,
} from "@/hooks/admin/use-channel-taxonomy";
import { SurfaceCard, SectionHead } from "@/components/admin-v2/ui-primitives";

const MARKETPLACES = ["EBAY_GB", "EBAY_US", "EBAY_DE", "EBAY_AU"] as const;

const ALL_SCOPE = "__all__";

type SortKey = "aspect" | "mapped" | "scope" | "status";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "mapped" | "unmapped" | "required-missing";

interface CategoryOption {
  categoryId: string | null; // null = "All categories (default)"
  label: string;
  productCount?: number;
}

export function ChannelMappingsPanel() {
  const [channel] = useState<"ebay">("ebay");
  const [marketplace, setMarketplace] = useState<string>("EBAY_GB");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryLabel, setCategoryLabel] = useState<string>("All categories (defaults)");

  const { data: mappings, isLoading } = useChannelMappings(channel, marketplace, categoryId);
  const { data: canonicalAttrs } = useCanonicalAttributes();
  const { data: schemaResult } = useEbayCategoryAspects(categoryId, marketplace);
  const { data: productCategories } = useProductChannelCategories(channel, marketplace);

  const upsert = useUpsertChannelMapping();
  const remove = useDeleteChannelMapping();

  const [editing, setEditing] = useState<ChannelMappingRecord | null>(null);

  // Filter / sort UI state
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("aspect");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Combined view: every aspect from the chosen category schema, plus any
  // mappings that exist outside the schema (rare, but possible).
  const baseRows = useMemo(() => {
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

  // Apply text + status filter, then sort
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = baseRows.filter((r) => {
      if (q) {
        const haystack = [
          r.aspectKey,
          r.mapping?.canonical_key ?? "",
          r.mapping?.constant_value ?? "",
          r.mapping?.notes ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (statusFilter === "mapped" && !r.mapping) return false;
      if (statusFilter === "unmapped" && r.mapping) return false;
      if (statusFilter === "required-missing" && (!r.required || r.mapping)) return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    const mappedTo = (r: (typeof baseRows)[number]) =>
      r.mapping?.canonical_key ?? r.mapping?.constant_value ?? "";
    const scope = (r: (typeof baseRows)[number]) =>
      r.mapping
        ? `${r.mapping.marketplace ?? "any"} ${r.mapping.category_id ?? "any"}`
        : "";
    const status = (r: (typeof baseRows)[number]) =>
      r.mapping ? "mapped" : r.required ? "required" : "unmapped";

    return filtered.sort((a, b) => {
      let va = "";
      let vb = "";
      if (sortKey === "aspect") {
        va = a.aspectKey;
        vb = b.aspectKey;
      } else if (sortKey === "mapped") {
        va = mappedTo(a);
        vb = mappedTo(b);
      } else if (sortKey === "scope") {
        va = scope(a);
        vb = scope(b);
      } else if (sortKey === "status") {
        va = status(a);
        vb = status(b);
      }
      return va.localeCompare(vb) * dir;
    });
  }, [baseRows, filter, statusFilter, sortKey, sortDir]);

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

  // Map of categoryId → friendly name from product usage list (for scope display)
  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of productCategories ?? []) {
      if (c.categoryName) m.set(c.categoryId, c.categoryName);
    }
    return m;
  }, [productCategories]);

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
        <div className="flex gap-2 items-center flex-wrap">
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
          <CategorySelector
            marketplace={marketplace}
            value={categoryId}
            label={categoryLabel}
            productCategories={productCategories ?? []}
            onChange={(id, label) => {
              setCategoryId(id);
              setCategoryLabel(label);
            }}
          />
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 items-center mb-3 flex-wrap">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter aspects, canonical keys, constants…"
          className="flex-1 min-w-[220px] px-2 py-1.5 text-[12px] border border-zinc-200 rounded"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="px-2 py-1.5 text-[12px] border border-zinc-200 rounded"
        >
          <option value="all">All ({baseRows.length})</option>
          <option value="mapped">Mapped ({baseRows.filter((r) => r.mapping).length})</option>
          <option value="unmapped">Unmapped ({baseRows.filter((r) => !r.mapping).length})</option>
          <option value="required-missing">
            Required missing ({baseRows.filter((r) => r.required && !r.mapping).length})
          </option>
        </select>
        <span className="text-[11px] text-zinc-500">{rows.length} shown</span>
      </div>

      {isLoading ? (
        <div className="text-[12px] text-zinc-500 py-4">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-200">
                <SortableTh active={sortKey === "aspect"} dir={sortDir} onClick={() => toggleSort("aspect")}>
                  Aspect
                </SortableTh>
                <SortableTh active={sortKey === "mapped"} dir={sortDir} onClick={() => toggleSort("mapped")}>
                  Mapped to
                </SortableTh>
                <SortableTh active={sortKey === "scope"} dir={sortDir} onClick={() => toggleSort("scope")}>
                  Scope
                </SortableTh>
                <SortableTh active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")}>
                  Status
                </SortableTh>
                <th className="py-2 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ aspectKey, required, mapping }) => (
                <tr key={aspectKey} className="border-b border-zinc-100 hover:bg-zinc-50">
                  <td className="py-2 px-2">
                    {required && <span className="text-red-500 mr-1" title="Required">*</span>}
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
                    <ScopeDisplay mapping={mapping} categoryNameById={categoryNameById} />
                  </td>
                  <td className="py-2 px-2">
                    <StatusPill mapping={mapping} required={required} />
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
                  <td colSpan={5} className="py-8 text-center text-zinc-500 text-[12px]">
                    {baseRows.length === 0
                      ? categoryId
                        ? "Schema not loaded. Open a product with this category once to cache it, or refresh."
                        : "Pick a category to see its eBay aspects, or add a default mapping below."
                      : "No rows match the current filter."}
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
          productCategories={productCategories ?? []}
          marketplaces={MARKETPLACES as unknown as string[]}
        />
      )}
    </SurfaceCard>
  );
}

// ─── Sortable column header ────────────────────────────────

function SortableTh({
  active,
  dir,
  onClick,
  children,
}: {
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <th className="py-2 px-2">
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 text-left text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-900"
      >
        {children}
        <span className="text-zinc-400">
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

function StatusPill({
  mapping,
  required,
}: {
  mapping: ChannelMappingRecord | null;
  required: boolean;
}) {
  if (mapping) {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider border bg-emerald-50 border-emerald-200 text-emerald-700">
        Mapped
      </span>
    );
  }
  if (required) {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider border bg-red-50 border-red-200 text-red-700">
        Required
      </span>
    );
  }
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider border bg-zinc-50 border-zinc-200 text-zinc-500">
      Unmapped
    </span>
  );
}

function ScopeDisplay({
  mapping,
  categoryNameById,
}: {
  mapping: ChannelMappingRecord | null;
  categoryNameById: Map<string, string>;
}) {
  if (!mapping) return <span>—</span>;
  const mkt = mapping.marketplace ?? "any marketplace";
  let cat: string;
  if (!mapping.category_id) {
    cat = "all categories";
  } else {
    const name = categoryNameById.get(mapping.category_id);
    cat = name ? `${name} (${mapping.category_id})` : `cat ${mapping.category_id}`;
  }
  return (
    <span>
      {mkt} · {cat}
    </span>
  );
}

// ─── Category selector (dropdown of in-use + search) ───────

function CategorySelector({
  marketplace,
  value,
  label,
  productCategories,
  onChange,
}: {
  marketplace: string;
  value: string | null;
  label: string;
  productCategories: { categoryId: string; categoryName: string | null; productCount: number }[];
  onChange: (id: string | null, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  // Proper debounce (the previous useMemo version never actually fired the
  // setTimeout, which made search feel broken)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data: suggestions, isFetching } = useEbayCategorySuggestions(debounced, marketplace);

  const handleSelect = (id: string | null, label: string) => {
    onChange(id, label);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-1.5 text-[12px] border border-zinc-200 rounded bg-white hover:bg-zinc-50 max-w-[300px] truncate"
        title={label}
      >
        {label}
      </button>
      {open && (
        <>
          {/* Click-away backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 mt-1 w-[min(400px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] bg-white border border-zinc-200 rounded-md shadow-lg z-20 p-2">
          {/* Quick "All" option */}
          <button
            onClick={() => handleSelect(null, "All categories (defaults)")}
            className={`w-full text-left px-2 py-1.5 rounded text-[12px] ${
              value === null ? "bg-amber-50 text-amber-700 font-semibold" : "hover:bg-zinc-50"
            }`}
          >
            All categories (defaults)
          </button>

          {/* In-use categories */}
          {productCategories.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-zinc-400 mt-2 mb-1 px-2">
                Categories used by products
              </div>
              <ul className="max-h-48 overflow-y-auto divide-y divide-zinc-100">
                {productCategories.map((c) => {
                  const lbl = c.categoryName ?? `Category ${c.categoryId}`;
                  return (
                    <li key={c.categoryId}>
                      <button
                        onClick={() =>
                          handleSelect(c.categoryId, `${lbl} · ${c.categoryId}`)
                        }
                        className={`w-full text-left px-2 py-1.5 rounded text-[12px] flex justify-between items-center ${
                          value === c.categoryId
                            ? "bg-amber-50 text-amber-700 font-semibold"
                            : "hover:bg-zinc-50"
                        }`}
                      >
                        <span>
                          <span className="text-zinc-900">{lbl}</span>
                          <span className="text-[10px] text-zinc-500 ml-1">{c.categoryId}</span>
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {c.productCount} product{c.productCount === 1 ? "" : "s"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {/* Search any eBay category */}
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 mt-3 mb-1 px-2">
            Or search the full eBay taxonomy
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type at least 2 characters…"
            className="w-full px-2 py-1.5 text-[12px] border border-zinc-200 rounded mb-1"
          />
          <div className="max-h-40 overflow-y-auto">
            {debounced.length < 2 ? (
              <div className="text-[11px] text-zinc-400 p-2">Type to search.</div>
            ) : isFetching ? (
              <div className="text-[11px] text-zinc-500 p-2">Searching…</div>
            ) : suggestions && suggestions.length > 0 ? (
              <ul className="divide-y divide-zinc-100">
                {suggestions.map((s) => (
                  <li key={s.categoryId}>
                    <button
                      onClick={() =>
                        handleSelect(s.categoryId, `${s.categoryName} · ${s.categoryId}`)
                      }
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
        </>
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
  productCategories,
  marketplaces,
}: {
  value: ChannelMappingRecord;
  onChange: (v: ChannelMappingRecord) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  canonicalKeys: string[];
  productCategories: { categoryId: string; categoryName: string | null; productCount: number }[];
  marketplaces: string[];
}) {
  const set = <K extends keyof ChannelMappingRecord>(
    k: K,
    v: ChannelMappingRecord[K],
  ) => onChange({ ...value, [k]: v });

  const mode = value.constant_value != null ? "constant" : "canonical";

  // Build the scope dropdown options from in-use categories
  const categoryOptions: CategoryOption[] = useMemo(
    () => [
      { categoryId: null, label: "All categories (default)" },
      ...productCategories.map((c) => ({
        categoryId: c.categoryId,
        label: `${c.categoryName ?? "Category"} · ${c.categoryId}`,
        productCount: c.productCount,
      })),
    ],
    [productCategories],
  );

  // If the current value.category_id isn't in the in-use list, surface it
  // anyway so the editor doesn't silently change scope.
  const hasCurrentCategory =
    value.category_id == null ||
    categoryOptions.some((o) => o.categoryId === value.category_id);

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

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-100">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                Marketplace scope
              </label>
              <select
                value={value.marketplace ?? ALL_SCOPE}
                onChange={(e) =>
                  set("marketplace", e.target.value === ALL_SCOPE ? null : e.target.value)
                }
                className="w-full px-2 py-1.5 border border-zinc-200 rounded"
              >
                <option value={ALL_SCOPE}>Any marketplace</option>
                {marketplaces.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                Category scope
              </label>
              <select
                value={value.category_id ?? ALL_SCOPE}
                onChange={(e) =>
                  set("category_id", e.target.value === ALL_SCOPE ? null : e.target.value)
                }
                className="w-full px-2 py-1.5 border border-zinc-200 rounded"
              >
                {categoryOptions.map((o) => (
                  <option key={o.categoryId ?? ALL_SCOPE} value={o.categoryId ?? ALL_SCOPE}>
                    {o.label}
                  </option>
                ))}
                {!hasCurrentCategory && (
                  <option value={value.category_id ?? ""}>
                    Category {value.category_id} (current)
                  </option>
                )}
              </select>
            </div>
          </div>

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
