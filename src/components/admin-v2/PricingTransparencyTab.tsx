import { useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Clock, Eye, ShieldAlert } from "lucide-react";
import {
  SheetContent,
  SheetDescription,
  SheetHeader,
  Sheet,
  SheetTitle,
} from "@/components/ui/sheet";
import { usePriceTransparency, useRecordPriceOverride, type PriceChannelTransparency, type PriceContributor } from "@/hooks/admin/use-price-transparency";
import { Badge, GradeBadge, Mono, SectionHead, SurfaceCard } from "./ui-primitives";
import { toast } from "sonner";

interface PricingTransparencyTabProps {
  mpn: string;
}

type SelectedChannel = {
  skuCode: string;
  grade: number | string;
  row: PriceChannelTransparency;
};

const STATUS_COLORS: Record<string, string> = {
  Auto: "#14B8A6",
  Manual: "#71717A",
  "Below floor": "#EF4444",
  "Review queued": "#F59E0B",
  "Stale snapshot": "#F59E0B",
};

const CONTRIBUTOR_COLORS: Record<string, string> = {
  pooled_carrying_value: "#475569",
  stock_cost_gross_paid: "#475569",
  stock_input_vat_reclaim: "#22C55E",
  packaging_cost: "#2563EB",
  packaging_gross_paid: "#2563EB",
  packaging_input_vat_reclaim: "#22C55E",
  delivery_cost: "#0EA5E9",
  delivery_gross_paid: "#0EA5E9",
  delivery_input_vat_reclaim: "#22C55E",
  estimated_channel_fees: "#7C3AED",
  channel_fees: "#7C3AED",
  payment_fees: "#A855F7",
  channel_fee_input_vat_reclaim: "#22C55E",
  program_commission: "#A855F7",
  floor_break_even_net_position: "#14B8A6",
  risk_reserve: "#F97316",
  minimum_profit: "#16A34A",
  margin_uplift: "#14B8A6",
  output_vat_payable: "#B91C1C",
  raw_rrp_gross: "#2563EB",
  raw_market_consensus_gross: "#F59E0B",
  target_anchor_gross: "#0F766E",
  market_consensus: "#F59E0B",
  brickeconomy_rrp: "#2563EB",
  condition_adjusted_anchor: "#0891B2",
  condition_adjusted_rrp: "#0891B2",
  market_weighted_rrp_undercut: "#EF4444",
  target_profit_safeguard_price: "#16A34A",
  target_margin_safeguard_price: "#14B8A6",
  condition_adjusted_market: "#0891B2",
  demand_multiplier: "#6366F1",
  age_multiplier: "#8B5CF6",
  turnaround_multiplier: "#0D9488",
  channel_undercut: "#EF4444",
  target_price: "#14B8A6",
  target_output_vat: "#B91C1C",
  target_net_receipts: "#0D9488",
  floor_gap: "#DC2626",
};

function money(value: number | string | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `£${Number(value).toFixed(2)}`;
}

function pct(value: number | string | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  const normalized = Math.abs(n) <= 1 ? n * 100 : n;
  return `${normalized.toFixed(1)}%`;
}

function compactDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function ageLabel(hours: number | null | undefined) {
  if (hours == null || !Number.isFinite(hours)) return "No snapshot";
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function confidenceColor(value: number | null | undefined) {
  const n = Number(value ?? 0);
  if (n >= 0.7) return "teal";
  if (n >= 0.45) return "amber";
  return "red";
}

function sourceName(source: PriceChannelTransparency["market_snapshots"][number]["source"]) {
  const row = Array.isArray(source) ? source[0] : source;
  return row?.source_code?.replace(/_/g, " ") ?? row?.name ?? "unknown";
}

function statusColor(status: string) {
  return STATUS_COLORS[status] ?? "#71717A";
}

function contributorColor(part: PriceContributor) {
  const amount = Number(part.amount);
  if (part.key === "floor_gap" && Number.isFinite(amount) && amount >= 0) return "#16A34A";
  if (part.key === "target_net_position" && Number.isFinite(amount)) return amount < 0 ? "#EF4444" : "#16A34A";
  if (CONTRIBUTOR_COLORS[part.key]) return CONTRIBUTOR_COLORS[part.key];
  if (amount < 0) return "#EF4444";
  if (part.kind === "profit" || part.kind === "margin" || part.kind === "result") return "#14B8A6";
  if (part.kind === "market") return "#F59E0B";
  if (part.kind === "rule") return "#6366F1";
  return "#71717A";
}

export function PriceContributionBar({ contributors }: { contributors: PriceContributor[] }) {
  const usable = contributors.filter((part) => Number.isFinite(Number(part.amount)) && Number(part.amount) !== 0);
  const total = usable.reduce((sum, part) => sum + Math.abs(Number(part.amount)), 0);

  if (usable.length === 0 || total <= 0) {
    return <div className="h-3 rounded bg-zinc-100" aria-label="No price contributors" />;
  }

  return (
    <div className="flex h-3 overflow-hidden rounded bg-zinc-100" aria-label="Price contribution bar">
      {usable.map((part) => {
        const amount = Number(part.amount);
        const width = `${Math.max(3, (Math.abs(amount) / total) * 100)}%`;
        return (
          <div
            key={part.key}
            className="h-full"
            style={{ width, backgroundColor: contributorColor(part) }}
            title={`${part.label}: ${money(amount)}`}
          />
        );
      })}
    </div>
  );
}

export function ContributorTable({ contributors }: { contributors: PriceContributor[] }) {
  return (
    <div className="overflow-hidden rounded border border-zinc-200">
      <table className="w-full text-[11px]">
        <tbody>
          {contributors.map((part) => {
            const color = contributorColor(part);
            return (
              <tr key={part.key} className="border-t border-zinc-100 first:border-t-0">
                <td className="px-2 py-1.5 text-zinc-600">
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-label={`Color key for ${part.label}`}
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: color }}
                    />
                    <span>{part.label}</span>
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Mono color={Number(part.amount) < 0 ? "red" : "default"}>{money(part.amount)}</Mono>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VatPositionPanel({ quote }: { quote: PriceChannelTransparency["quote"] }) {
  const vat = quote.vat_position;
  if (!vat) {
    return (
      <SurfaceCard className="p-3">
        <SectionHead>VAT Position</SectionHead>
        <p className="mt-2 text-xs text-zinc-500">No VAT breakdown is attached to this price decision.</p>
      </SurfaceCard>
    );
  }

  const netPosition = Number(vat.net_position_after_vat ?? 0);
  const vatRate = vat.vat_rate_percent == null ? "VAT" : `VAT ${Number(vat.vat_rate_percent).toFixed(1)}%`;
  const actualCostsNet = vat.actual_costs_net_after_reclaim ?? vat.cost_basis_net_paid;

  return (
    <SurfaceCard className="p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <SectionHead>VAT Position</SectionHead>
        <Mono>{vatRate}</Mono>
      </div>
      <div className="grid gap-2 text-[11px] sm:grid-cols-4">
        <Metric label="Costs Ex VAT" value={money(actualCostsNet)} />
        <Metric label="Received Gross" value={money(vat.sale_price_gross)} tone="amber" />
        <Metric label="Receipts Ex VAT" value={money(vat.sale_receipts_net_of_vat)} tone="teal" />
        <Metric label="Net Position" value={money(vat.net_position_after_vat)} tone={netPosition < 0 ? "red" : "teal"} />
      </div>
      <div className="mt-3 overflow-hidden rounded border border-zinc-200">
        <table className="w-full text-[11px]">
          <tbody>
            <tr className="border-t border-zinc-100 first:border-t-0">
              <td className="px-2 py-1.5 text-zinc-600">Stock cost paid gross</td>
              <td className="px-2 py-1.5 text-right"><Mono>{money(vat.stock_cost_gross_paid)}</Mono></td>
            </tr>
            <tr className="border-t border-zinc-100">
              <td className="px-2 py-1.5 text-zinc-600">Stock VAT reclaim</td>
              <td className="px-2 py-1.5 text-right">
                <Mono color="teal">
                  {vat.stock_input_vat_reclaim == null ? "—" : `-${money(vat.stock_input_vat_reclaim)}`}
                </Mono>
              </td>
            </tr>
            <tr className="border-t border-zinc-100">
              <td className="px-2 py-1.5 text-zinc-600">Actual costs after VAT reclaim</td>
              <td className="px-2 py-1.5 text-right"><Mono>{money(actualCostsNet)}</Mono></td>
            </tr>
            <tr className="border-t border-zinc-100">
              <td className="px-2 py-1.5 text-zinc-600">Customer/channel pays</td>
              <td className="px-2 py-1.5 text-right"><Mono>{money(vat.sale_price_gross)}</Mono></td>
            </tr>
            <tr className="border-t border-zinc-100">
              <td className="px-2 py-1.5 text-zinc-600">Output VAT payable</td>
              <td className="px-2 py-1.5 text-right"><Mono color="red">{money(vat.sale_output_vat)}</Mono></td>
            </tr>
            <tr className="border-t border-zinc-100">
              <td className="px-2 py-1.5 text-zinc-600">Receipts after VAT</td>
              <td className="px-2 py-1.5 text-right"><Mono color="teal">{money(vat.sale_receipts_net_of_vat)}</Mono></td>
            </tr>
            <tr className="border-t border-zinc-100">
              <td className="px-2 py-1.5 text-zinc-600">Channel fees paid gross</td>
              <td className="px-2 py-1.5 text-right"><Mono>{money(vat.channel_fees_gross_paid)}</Mono></td>
            </tr>
            <tr className="border-t border-zinc-100">
              <td className="px-2 py-1.5 text-zinc-600">Fee VAT reclaim</td>
              <td className="px-2 py-1.5 text-right">
                <Mono color="teal">
                  {vat.channel_fee_input_vat_reclaim == null ? "—" : `-${money(vat.channel_fee_input_vat_reclaim)}`}
                </Mono>
              </td>
            </tr>
            <tr className="border-t border-zinc-100">
              <td className="px-2 py-1.5 text-zinc-600">Net after VAT and fees</td>
              <td className="px-2 py-1.5 text-right"><Mono>{money(vat.estimated_net_after_vat_and_fees)}</Mono></td>
            </tr>
            <tr className="border-t border-zinc-100 bg-zinc-50">
              <td className="px-2 py-1.5 font-semibold text-zinc-700">Net position after VAT, fees, cost and risk</td>
              <td className="px-2 py-1.5 text-right"><Mono color={netPosition < 0 ? "red" : "teal"}>{money(vat.net_position_after_vat)}</Mono></td>
            </tr>
          </tbody>
        </table>
      </div>
    </SurfaceCard>
  );
}

function PriceExplanationPanel({ selected, mpn }: { selected: SelectedChannel; mpn: string }) {
  const quote = selected.row.quote;
  const floorContributors = quote.floor_contributors ?? [];
  const targetContributors = quote.target_contributors ?? [];
  const warnings = [...(quote.warning_reasons ?? []), ...(quote.blocking_reasons ?? [])];
  const recordOverride = useRecordPriceOverride();
  const [overridePrice, setOverridePrice] = useState(
    selected.row.final_price == null ? "" : Number(selected.row.final_price).toFixed(2),
  );
  const [reasonCode, setReasonCode] = useState("operator_override");
  const [reasonNote, setReasonNote] = useState("");
  const parsedOverridePrice = Number(overridePrice);
  const floorPrice = quote.floor_price == null ? null : Number(quote.floor_price);
  const overrideBelowFloor = Number.isFinite(parsedOverridePrice)
    && floorPrice != null
    && floorPrice > 0
    && parsedOverridePrice < floorPrice;

  const submitOverride = async () => {
    if (!Number.isFinite(parsedOverridePrice) || parsedOverridePrice <= 0) {
      toast.error("Enter a valid override price");
      return;
    }
    if (!reasonCode.trim()) {
      toast.error("Override reason is required");
      return;
    }

    try {
      await recordOverride.mutateAsync({
        mpn,
        skuId: quote.sku_id,
        channel: selected.row.channel,
        listingPrice: parsedOverridePrice,
        reasonCode,
        reasonNote: reasonNote.trim() || null,
      });
      toast.success("Price override recorded and reprice queued");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Price override failed");
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 sm:grid-cols-4">
        <Metric label="Final" value={money(selected.row.final_price)} tone={selected.row.below_floor ? "red" : "teal"} />
        <Metric label="Floor" value={money(quote.floor_price)} tone="red" />
        <Metric label="Target" value={money(quote.target_price)} tone="teal" />
        <Metric label="Ceiling" value={money(quote.ceiling_price)} tone="amber" />
      </div>

      <SurfaceCard className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <SectionHead>Floor Contributors</SectionHead>
          <Mono>{money(quote.floor_price)}</Mono>
        </div>
        <PriceContributionBar contributors={floorContributors} />
        <div className="mt-3">
          <ContributorTable contributors={floorContributors} />
        </div>
      </SurfaceCard>

      <SurfaceCard className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <SectionHead>Target Rules</SectionHead>
          <Mono>{money(quote.target_price)}</Mono>
        </div>
        <PriceContributionBar contributors={targetContributors} />
        <div className="mt-3">
          <ContributorTable contributors={targetContributors} />
        </div>
      </SurfaceCard>

      <VatPositionPanel quote={quote} />

      <SurfaceCard className="p-3">
        <SectionHead>Cost Basis</SectionHead>
        <div className="grid gap-2 text-[11px] sm:grid-cols-4">
          <Metric label="Basis" value={String(quote.cost_basis?.basis_strategy ?? "pool_wac")} />
          <Metric label="Pool WAC" value={money(quote.cost_basis?.pooled_carrying_value ?? quote.average_carrying_value)} />
          <Metric label="Highest Unit" value={money(quote.cost_basis?.highest_unit_carrying_value ?? quote.highest_unit_carrying_value)} />
          <Metric label="Units" value={String(quote.cost_basis?.unit_count ?? quote.stock_unit_count ?? 0)} />
        </div>
      </SurfaceCard>

      <SurfaceCard className="p-3">
        <SectionHead>Source Evidence</SectionHead>
        {selected.row.market_snapshots.length === 0 ? (
          <p className="text-xs text-zinc-500">No market snapshot evidence is attached to this quote.</p>
        ) : (
          <div className="overflow-hidden rounded border border-zinc-200">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-zinc-50 text-left text-zinc-500">
                  <th className="px-2 py-1.5 font-medium">Source</th>
                  <th className="px-2 py-1.5 text-right font-medium">Price</th>
                  <th className="px-2 py-1.5 text-right font-medium">Confidence</th>
                  <th className="px-2 py-1.5 text-right font-medium">Captured</th>
                </tr>
              </thead>
              <tbody>
                {selected.row.market_snapshots.map((snapshot) => (
                  <tr key={snapshot.id} className="border-t border-zinc-100">
                    <td className="px-2 py-1.5 capitalize">{sourceName(snapshot.source)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{money(snapshot.price)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{pct(snapshot.confidence_score)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-zinc-500">{compactDate(snapshot.captured_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      {warnings.length > 0 && (
        <SurfaceCard className="border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            Pricing warnings
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[...new Set(warnings)].map((warning) => (
              <Badge key={warning} label={warning.replace(/_/g, " ")} color="#D97706" small />
            ))}
          </div>
        </SurfaceCard>
      )}

      <SurfaceCard className="p-3">
        <SectionHead>Manual Override</SectionHead>
        <div className="mt-3 grid gap-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
            <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Listing price
              <input
                value={overridePrice}
                onChange={(event) => setOverridePrice(event.target.value)}
                inputMode="decimal"
                className="rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-zinc-900"
              />
            </label>
            <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Reason code
              <select
                value={reasonCode}
                onChange={(event) => setReasonCode(event.target.value)}
                className="rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-zinc-900"
              >
                <option value="operator_override">Operator override</option>
                <option value="clearance">Clearance</option>
                <option value="defect_disclosure">Defect disclosure</option>
                <option value="market_test">Market test</option>
                <option value="customer_commitment">Customer commitment</option>
              </select>
            </label>
          </div>
          <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Note
            <textarea
              value={reasonNote}
              onChange={(event) => setReasonNote(event.target.value)}
              rows={3}
              className="resize-y rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-zinc-900"
              placeholder="Record the operator rationale for this listing price"
            />
          </label>
          {overrideBelowFloor && (
            <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-semibold text-red-700">
              <ShieldAlert className="h-3.5 w-3.5" />
              This override is below floor and will be queued with below-floor approval evidence.
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={submitOverride}
              disabled={!reasonCode.trim() || recordOverride.isPending}
              className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {recordOverride.isPending ? "Queueing..." : "Record override"}
            </button>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "teal" | "amber" | "red" }) {
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 px-2.5 py-2">
      <div className="mb-0.5 text-[10px] font-medium uppercase text-zinc-500">{label}</div>
      <Mono color={tone} className="text-[13px]">{value}</Mono>
    </div>
  );
}

export function PricingTransparencyTab({ mpn }: PricingTransparencyTabProps) {
  const { data, isLoading, error } = usePriceTransparency(mpn);
  const [selected, setSelected] = useState<SelectedChannel | null>(null);

  const allChannels = useMemo(
    () => data?.variants.flatMap((variant) => variant.channels) ?? [],
    [data?.variants],
  );

  if (isLoading) {
    return (
      <SurfaceCard>
        <SectionHead>Pricing Transparency</SectionHead>
        <p className="text-sm text-zinc-500">Loading pricing evidence...</p>
      </SurfaceCard>
    );
  }

  if (error || !data) {
    return (
      <SurfaceCard>
        <SectionHead>Pricing Transparency</SectionHead>
        <p className="text-sm text-red-500">{error instanceof Error ? error.message : "Pricing transparency could not be loaded."}</p>
      </SurfaceCard>
    );
  }

  return (
    <>
      <div className="grid gap-4">
        <div className="grid gap-3 lg:grid-cols-5">
          <Metric label="Market" value={money(data.summary.average_market_price)} tone="amber" />
          <Metric label="Confidence" value={pct(data.summary.average_confidence)} tone={confidenceColor(data.summary.average_confidence)} />
          <Metric label="Overrides" value={String(data.summary.override_count)} tone={data.summary.override_count > 0 ? "amber" : "teal"} />
          <Metric label="Stale" value={String(data.summary.stale_snapshot_count)} tone={data.summary.stale_snapshot_count > 0 ? "amber" : "teal"} />
          <Metric label="Grades" value={data.summary.grade_spread || "—"} />
        </div>

        <SurfaceCard noPadding>
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
            <div>
              <SectionHead>MPN Pricing Matrix</SectionHead>
              <p className="text-xs text-zinc-500">{data.product.name ?? data.product.mpn} · {data.summary.sku_count} SKU(s) · {data.summary.source_count} source family(s)</p>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Clock className="h-3.5 w-3.5" />
              Last priced {compactDate(data.summary.latest_priced_at)}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-xs">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="px-3 py-2 font-medium">SKU</th>
                  <th className="px-3 py-2 text-right font-medium">Stock</th>
                  <th className="px-3 py-2 text-right font-medium">Pool WAC</th>
                  <th className="px-3 py-2 text-right font-medium">Highest</th>
                  <th className="px-3 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">Floor</th>
                  <th className="px-3 py-2 text-right font-medium">Target</th>
                  <th className="px-3 py-2 text-right font-medium">Margin</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 text-right font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {data.variants.map((variant) => (
                  variant.channels.map((channel, channelIndex) => (
                    <tr key={`${variant.sku_id}:${channel.channel}`} className="border-b border-zinc-100 hover:bg-zinc-50">
                      {channelIndex === 0 && (
                        <>
                          <td className="px-3 py-2 align-top" rowSpan={variant.channels.length}>
                            <div className="flex items-center gap-2">
                              <Mono color="amber">{variant.sku_code}</Mono>
                              <GradeBadge grade={Number(variant.condition_grade)} />
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right align-top font-mono" rowSpan={variant.channels.length}>{variant.stock_count}</td>
                          <td className="px-3 py-2 text-right align-top font-mono" rowSpan={variant.channels.length}>{money(variant.pooled_carrying_value)}</td>
                          <td className="px-3 py-2 text-right align-top font-mono" rowSpan={variant.channels.length}>{money(variant.highest_unit_carrying_value)}</td>
                        </>
                      )}
                      <td className="px-3 py-2 font-semibold text-zinc-800">{channel.channel_label}</td>
                      <td className="px-3 py-2 text-right"><Mono color={channel.below_floor ? "red" : "teal"}>{money(channel.final_price)}</Mono></td>
                      <td className="px-3 py-2 text-right"><Mono color="red">{money(channel.quote.floor_price)}</Mono></td>
                      <td className="px-3 py-2 text-right"><Mono color="teal">{money(channel.quote.target_price)}</Mono></td>
                      <td className="px-3 py-2 text-right"><Mono color={Number(channel.margin_amount ?? 0) >= 0 ? "teal" : "red"}>{money(channel.margin_amount)}</Mono></td>
                      <td className="px-3 py-2">
                        <Badge label={channel.override_status} color={statusColor(channel.override_status)} small />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setSelected({ skuCode: variant.sku_code, grade: variant.condition_grade, row: channel })}
                          className="inline-flex items-center gap-1 rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100"
                        >
                          <Eye className="h-3 w-3" />
                          Explain
                        </button>
                        <div className="mt-1 text-[10px] text-zinc-500">{ageLabel(channel.snapshot_age_hours)}</div>
                      </td>
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          </div>
        </SurfaceCard>

        {allChannels.some((channel) => channel.below_floor) && (
          <SurfaceCard className="border-red-200 bg-red-50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-red-700">
              <ShieldAlert className="h-4 w-4" />
              One or more listing prices are below their current floor and require visible override evidence.
            </div>
          </SurfaceCard>
        )}
      </div>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto bg-white p-4 sm:max-w-2xl">
          {selected && (
            <>
              <SheetHeader className="mb-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-amber-500" />
                  <SheetTitle className="text-base">{selected.skuCode} · {selected.row.channel_label}</SheetTitle>
                </div>
                <SheetDescription>
                  Floor, target, market evidence, and override state for grade {selected.grade}.
                </SheetDescription>
              </SheetHeader>
              <PriceExplanationPanel
                key={`${selected.row.quote.sku_id}:${selected.row.channel}`}
                selected={selected}
                mpn={mpn}
              />
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
