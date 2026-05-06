import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileText,
  Megaphone,
  PackageCheck,
  Play,
  RefreshCcw,
  Store,
  Tags,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  useCancelListingCommand,
  useListingCommands,
  useOperationsHealth,
  useRetryListingCommand,
  useRunListingCommandNow,
  useRunSubledgerScheduledJobs,
  type ListingCommandRow,
} from "@/hooks/admin/use-operations";
import { useOrders } from "@/hooks/admin/use-orders";
import { usePayouts } from "@/hooks/admin/use-payouts";
import {
  useEbayLandingSummary,
  useEbayNotifications,
  useEbayStorefrontListings,
  useQueueEbayListingCommand,
  type EbayListingCommandType,
  type EbayStorefrontListing,
} from "@/hooks/admin/use-ebay-storefront";
import { TraceMetadata } from "./TraceMetadata";
import { Badge, Mono, SectionHead, SurfaceCard } from "./ui-primitives";
import { cn } from "@/lib/utils";

type TabId =
  | "overview"
  | "listings"
  | "orders"
  | "policies"
  | "promotions"
  | "categories"
  | "compliance"
  | "finance"
  | "jobs"
  | "audit";

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: Store },
  { id: "listings", label: "Listings", icon: Tags },
  { id: "orders", label: "Orders", icon: PackageCheck },
  { id: "policies", label: "Policies", icon: ClipboardList },
  { id: "promotions", label: "Promotions", icon: Megaphone },
  { id: "categories", label: "Categories", icon: Store },
  { id: "compliance", label: "Compliance", icon: AlertTriangle },
  { id: "finance", label: "Finance", icon: Wallet },
  { id: "jobs", label: "Jobs", icon: Play },
  { id: "audit", label: "Audit", icon: Activity },
];

const statusColors: Record<string, string> = {
  ready: "#16A34A",
  live: "#16A34A",
  draft: "#71717A",
  paused: "#D97706",
  ended: "#71717A",
  missing_policy: "#D97706",
  compliance_risk: "#DC2626",
  revision_cap_risk: "#EA580C",
  pending: "#D97706",
  processing: "#2563EB",
  sent: "#2563EB",
  acknowledged: "#16A34A",
  failed: "#DC2626",
  cancelled: "#71717A",
  error: "#DC2626",
  warning: "#D97706",
  healthy: "#16A34A",
  blocked: "#DC2626",
};

function formatMoney(value: number | null | undefined): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

function shortId(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : "-";
}

function StatCard({
  label,
  value,
  tone = "default",
  sub,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "good" | "warn" | "bad" | "info";
  sub?: string;
}) {
  const toneClass = {
    default: "text-zinc-900",
    good: "text-green-600",
    warn: "text-amber-600",
    bad: "text-red-600",
    info: "text-blue-600",
  }[tone];

  return (
    <SurfaceCard className="p-3">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className={cn("mt-1 font-mono text-2xl font-bold", toneClass)}>{value}</div>
      {sub ? <div className="mt-1 text-[11px] text-zinc-500">{sub}</div> : null}
    </SurfaceCard>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "border border-amber-500 bg-amber-500 text-zinc-950 hover:bg-amber-400",
        variant === "danger" && "border border-red-200 bg-white text-red-600 hover:bg-red-50",
        variant === "default" && "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
      )}
    >
      {children}
    </button>
  );
}

function TabButton({ tab, active, onClick }: { tab: (typeof tabs)[number]; active: boolean; onClick: () => void }) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[12px] font-medium transition-colors",
        active
          ? "border-amber-500 text-zinc-900"
          : "border-transparent text-zinc-500 hover:text-zinc-800",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {tab.label}
    </button>
  );
}

function ReadinessBadge({ value }: { value: EbayStorefrontListing["readiness"] }) {
  return <Badge label={humanize(value)} color={statusColors[value] ?? "#71717A"} small />;
}

function CommandStatusBadge({ value }: { value: string }) {
  return <Badge label={humanize(value)} color={statusColors[value] ?? "#71717A"} small />;
}

export function EbayStorefrontManager() {
  const [tab, setTab] = useState<TabId>("overview");
  const { data: listings = [], isLoading: listingsLoading } = useEbayStorefrontListings();
  const { data: orders = [] } = useOrders();
  const { data: payouts = [] } = usePayouts();
  const { data: commands = [] } = useListingCommands();
  const { data: landing = [] } = useEbayLandingSummary();
  const { data: notifications = [] } = useEbayNotifications();
  const { data: health = [] } = useOperationsHealth();

  const ebayOrders = useMemo(() => orders.filter((order) => order.channel === "ebay"), [orders]);
  const ebayPayouts = useMemo(() => payouts.filter((payout) => payout.channel === "ebay"), [payouts]);
  const ebayCommands = useMemo(
    () => commands.filter((command) => command.targetSystem === "ebay" || command.channel === "ebay"),
    [commands],
  );

  const summary = useMemo(() => {
    const activeListings = listings.filter((listing) => listing.status === "live").length;
    const blockedListings = listings.filter((listing) => listing.readiness !== "ready").length;
    const pendingCommands = ebayCommands.filter((command) => command.status === "pending").length;
    const failedCommands = ebayCommands.filter((command) => command.status === "failed").length;
    const ordersAwaitingFulfillment = ebayOrders.filter((order) =>
      order.status === "new" || order.status === "awaiting_shipment" || order.status === "needs_allocation"
    ).length;
    const payoutTotal = ebayPayouts
      .slice(0, 7)
      .reduce((sum, payout) => sum + Number(payout.netAmount ?? 0), 0);

    return { activeListings, blockedListings, pendingCommands, failedCommands, ordersAwaitingFulfillment, payoutTotal };
  }, [ebayCommands, ebayOrders, ebayPayouts, listings]);

  const listingOutboxHealth = health.find((row) => row.area === "listing_command_outbox");

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-zinc-900">eBay Storefront Manager</h1>
          <p className="mt-1 max-w-3xl text-[12px] text-zinc-500">
            Manage eBay listings, order intake, finance ingestion, policy readiness, automation jobs, and audit trails from app-controlled staging and outbox flows.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/settings/channel-mappings"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            Channel Mappings
          </Link>
          <Link
            to="/admin/data-sync"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Data Sync
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto border-b border-zinc-200">
        <div className="flex min-w-max gap-1">
          {tabs.map((item) => (
            <TabButton key={item.id} tab={item} active={tab === item.id} onClick={() => setTab(item.id)} />
          ))}
        </div>
      </div>

      {tab === "overview" && (
        <OverviewTab
          summary={summary}
          listings={listings}
          commands={ebayCommands}
          landing={landing}
          listingOutboxHealth={listingOutboxHealth}
          loading={listingsLoading}
          onSelectTab={setTab}
        />
      )}
      {tab === "listings" && <ListingsTab listings={listings} loading={listingsLoading} />}
      {tab === "orders" && <OrdersTab orders={ebayOrders} landing={landing} />}
      {tab === "policies" && <PoliciesTab listings={listings} />}
      {tab === "promotions" && <PromotionsTab />}
      {tab === "categories" && <CategoriesTab listings={listings} />}
      {tab === "compliance" && <ComplianceTab listings={listings} health={health} />}
      {tab === "finance" && <FinanceTab payouts={ebayPayouts} landing={landing} />}
      {tab === "jobs" && <JobsTab commands={ebayCommands} landing={landing} />}
      {tab === "audit" && <AuditTab commands={ebayCommands} notifications={notifications} />}
    </div>
  );
}

function OverviewTab({
  summary,
  listings,
  commands,
  landing,
  listingOutboxHealth,
  loading,
  onSelectTab,
}: {
  summary: {
    activeListings: number;
    blockedListings: number;
    pendingCommands: number;
    failedCommands: number;
    ordersAwaitingFulfillment: number;
    payoutTotal: number;
  };
  listings: EbayStorefrontListing[];
  commands: ListingCommandRow[];
  landing: { source: string; pending: number; committed: number; error: number; latestReceivedAt: string | null }[];
  listingOutboxHealth?: { healthStatus: string; recommendation: string; pendingCount: number; failedCount: number } | null;
  loading: boolean;
  onSelectTab: (tab: TabId) => void;
}) {
  const blocked = listings.filter((listing) => listing.readiness !== "ready").slice(0, 5);
  const recentCommands = commands.slice(0, 5);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Active Listings" value={loading ? "..." : summary.activeListings} tone="good" />
        <StatCard label="Blocked Listings" value={loading ? "..." : summary.blockedListings} tone={summary.blockedListings ? "warn" : "good"} />
        <StatCard label="Pending Commands" value={summary.pendingCommands} tone={summary.pendingCommands ? "info" : "default"} />
        <StatCard label="Failed Commands" value={summary.failedCommands} tone={summary.failedCommands ? "bad" : "good"} />
        <StatCard label="Orders To Ship" value={summary.ordersAwaitingFulfillment} tone={summary.ordersAwaitingFulfillment ? "warn" : "good"} />
        <StatCard label="Recent Payout Net" value={formatMoney(summary.payoutTotal)} tone="default" sub="Latest 7 eBay payouts" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <SurfaceCard>
          <div className="flex items-center justify-between gap-3">
            <div>
              <SectionHead>Command Center</SectionHead>
              <p className="text-xs text-zinc-500">
                eBay changes are staged through listing commands, then processed asynchronously by the listing outbox.
              </p>
            </div>
            <ActionButton onClick={() => onSelectTab("jobs")} variant="primary">
              <Play className="h-3.5 w-3.5" />
              Open Jobs
            </ActionButton>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <ActionTile
              title="Publish and revision queue"
              detail={`${summary.pendingCommands} pending, ${summary.failedCommands} failed`}
              icon={Play}
              onClick={() => onSelectTab("jobs")}
            />
            <ActionTile
              title="Listing readiness queue"
              detail={`${summary.blockedListings} listings need policy, price, or disclosure review`}
              icon={AlertTriangle}
              onClick={() => onSelectTab("listings")}
            />
            <ActionTile
              title="Inbound staging"
              detail={`${landing.reduce((sum, row) => sum + row.pending, 0)} pending staged records`}
              icon={RefreshCcw}
              onClick={() => onSelectTab("jobs")}
            />
            <ActionTile
              title="Finance and payout review"
              detail="Payouts are visible here, reconciliation remains separate"
              icon={Wallet}
              onClick={() => onSelectTab("finance")}
            />
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <SectionHead>Outbox Health</SectionHead>
          {listingOutboxHealth ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge
                  label={humanize(listingOutboxHealth.healthStatus)}
                  color={statusColors[listingOutboxHealth.healthStatus] ?? "#71717A"}
                />
                <span className="text-xs text-zinc-500">
                  {listingOutboxHealth.pendingCount} pending, {listingOutboxHealth.failedCount} failed
                </span>
              </div>
              <p className="text-sm text-zinc-700">{listingOutboxHealth.recommendation}</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Listing outbox health has not reported yet.</p>
          )}
          <div className="mt-4 divide-y divide-zinc-100">
            {recentCommands.length === 0 ? (
              <div className="py-4 text-sm text-zinc-500">No eBay listing commands found.</div>
            ) : (
              recentCommands.map((command) => <CommandRow key={command.id} command={command} compact />)
            )}
          </div>
        </SurfaceCard>
      </div>

      <SurfaceCard noPadding>
        <div className="border-b border-zinc-200 px-4 py-3">
          <SectionHead>Blocked Listing Readiness</SectionHead>
        </div>
        <ListingsTable listings={blocked} empty="No blocked eBay listings." compact />
      </SurfaceCard>
    </div>
  );
}

function ActionTile({
  title,
  detail,
  icon: Icon,
  onClick,
}: {
  title: string;
  detail: string;
  icon: React.ElementType;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[88px] items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-left transition-colors hover:border-amber-300 hover:bg-amber-50/40"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-amber-600 shadow-sm">
        <Icon className="h-4 w-4" />
      </span>
      <span>
        <span className="block text-sm font-semibold text-zinc-900">{title}</span>
        <span className="mt-1 block text-xs text-zinc-500">{detail}</span>
      </span>
    </button>
  );
}

function ListingsTab({ listings, loading }: { listings: EbayStorefrontListing[]; loading: boolean }) {
  const [readiness, setReadiness] = useState<"all" | EbayStorefrontListing["readiness"]>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const queueCommand = useQueueEbayListingCommand();
  const filtered = readiness === "all" ? listings : listings.filter((listing) => listing.readiness === readiness);
  const filteredIds = filtered.map((listing) => listing.id);
  const selectedListings = filtered.filter((listing) => selectedIds.includes(listing.id));
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));

  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (allFilteredSelected) return prev.filter((id) => !filteredIds.includes(id));
      return [...new Set([...prev, ...filteredIds])];
    });
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  };

  const queueBulk = async (commandType: EbayListingCommandType) => {
    if (selectedListings.length === 0) {
      toast.error("Select at least one eBay listing first");
      return;
    }

    const blocked = selectedListings.filter((listing) =>
      (commandType === "publish" || commandType === "reprice" || commandType === "update_price") &&
      listing.readiness !== "ready"
    );
    if (blocked.length > 0) {
      toast.error(`${blocked.length} selected listing(s) need readiness fixes before ${humanize(commandType)}`);
      return;
    }

    try {
      for (const listing of selectedListings) {
        await queueCommand.mutateAsync({ listingId: listing.id, commandType });
      }
      toast.success(`Queued ${selectedListings.length} eBay ${humanize(commandType)} command(s)`);
      setSelectedIds([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not queue ${humanize(commandType)}`);
    }
  };

  return (
    <SurfaceCard noPadding>
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <SectionHead>Listings And Offers</SectionHead>
          <p className="text-xs text-zinc-500">
            Readiness checks preserve SKU semantics, policy mappings, Red Card disclosure, and staged eBay mutations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={readiness}
            onChange={(event) => setReadiness(event.target.value as typeof readiness)}
            className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700"
          >
            <option value="all">All readiness states</option>
            <option value="ready">Ready</option>
            <option value="missing_policy">Missing policy</option>
            <option value="compliance_risk">Compliance risk</option>
            <option value="revision_cap_risk">Revision cap risk</option>
          </select>
          <ActionButton onClick={() => queueBulk("publish")} disabled={queueCommand.isPending || selectedListings.length === 0} variant="primary">
            <Play className="h-3.5 w-3.5" />
            Queue Publish
          </ActionButton>
          <ActionButton onClick={() => queueBulk("sync_quantity")} disabled={queueCommand.isPending || selectedListings.length === 0}>
            <RefreshCcw className="h-3.5 w-3.5" />
            Sync Qty
          </ActionButton>
          <ActionButton onClick={() => queueBulk("end")} disabled={queueCommand.isPending || selectedListings.length === 0} variant="danger">
            <XCircle className="h-3.5 w-3.5" />
            End
          </ActionButton>
        </div>
      </div>
      {selectedListings.length > 0 ? (
        <div className="border-b border-amber-200 bg-amber-50/70 px-4 py-2 text-xs text-amber-800">
          {selectedListings.length} listing(s) selected for staged eBay commands.
        </div>
      ) : null}
      {loading ? (
        <div className="p-6 text-sm text-zinc-500">Loading eBay listings...</div>
      ) : (
        <ListingsTable
          listings={filtered}
          empty="No eBay listings found."
          selectedIds={selectedIds}
          onToggleOne={toggleOne}
          onToggleAll={toggleAll}
          allSelected={allFilteredSelected}
        />
      )}
    </SurfaceCard>
  );
}

function ListingsTable({
  listings,
  empty,
  compact,
  selectedIds,
  onToggleOne,
  onToggleAll,
  allSelected,
}: {
  listings: EbayStorefrontListing[];
  empty: string;
  compact?: boolean;
  selectedIds?: string[];
  onToggleOne?: (id: string) => void;
  onToggleAll?: () => void;
  allSelected?: boolean;
}) {
  if (listings.length === 0) {
    return <div className="p-6 text-sm text-zinc-500">{empty}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1020px] text-left text-xs">
        <thead className="bg-zinc-50 text-[10px] uppercase tracking-[0.06em] text-zinc-500">
          <tr>
            {!compact && onToggleAll ? (
              <th className="w-10 px-4 py-2 font-semibold">
                <input
                  type="checkbox"
                  checked={!!allSelected}
                  onChange={onToggleAll}
                  aria-label="Select all visible eBay listings"
                  className="h-3.5 w-3.5 rounded border-zinc-300"
                />
              </th>
            ) : null}
            <th className="px-4 py-2 font-semibold">SKU</th>
            <th className="px-3 py-2 font-semibold">Title</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 font-semibold">Price</th>
            <th className="px-3 py-2 font-semibold">Qty</th>
            <th className="px-3 py-2 font-semibold">Readiness</th>
            {!compact ? <th className="px-3 py-2 font-semibold">eBay ID</th> : null}
            <th className="px-3 py-2 font-semibold">Updated</th>
            {!compact ? <th className="px-3 py-2 font-semibold">Stage Command</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {listings.map((listing) => (
            <tr key={listing.id} className="align-top hover:bg-zinc-50/70">
              {!compact && onToggleOne ? (
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds?.includes(listing.id) ?? false}
                    onChange={() => onToggleOne(listing.id)}
                    aria-label={`Select eBay listing ${listing.skuCode ?? listing.id}`}
                    className="h-3.5 w-3.5 rounded border-zinc-300"
                  />
                </td>
              ) : null}
              <td className="px-4 py-3">
                <div className="space-y-1">
                  <Mono color="amber">{listing.skuCode ?? "-"}</Mono>
                  <div className="text-[11px] text-zinc-500">MPN {listing.mpn ?? "-"} G{listing.grade ?? "-"}</div>
                  <TraceMetadata
                    items={[
                      { label: "SKU ID", value: listing.skuId },
                      { label: "Listing ID", value: listing.id },
                    ]}
                  />
                </div>
              </td>
              <td className="max-w-[340px] px-3 py-3">
                <div className="font-medium text-zinc-800">{listing.listingTitle ?? listing.productName ?? "Untitled listing"}</div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  {listing.readinessReasons.slice(0, compact ? 1 : 2).join(" · ")}
                </div>
              </td>
              <td className="px-3 py-3">
                <Badge label={humanize(listing.status)} color={statusColors[listing.status] ?? "#71717A"} small />
              </td>
              <td className="px-3 py-3 font-mono text-zinc-700">{formatMoney(listing.listedPrice)}</td>
              <td className="px-3 py-3 font-mono text-zinc-700">{listing.listedQuantity ?? "-"}</td>
              <td className="px-3 py-3"><ReadinessBadge value={listing.readiness} /></td>
              {!compact ? (
                <td className="px-3 py-3">
                  {listing.externalUrl ? (
                    <a href={listing.externalUrl} className="inline-flex items-center gap-1 text-amber-600 hover:text-amber-500" target="_blank" rel="noreferrer">
                      {listing.externalListingId ?? "Open"}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <Mono color="dim">{listing.externalListingId ?? "-"}</Mono>
                  )}
                  <TraceMetadata className="mt-1" items={[{ label: "Listing ID", value: listing.id }]} />
                </td>
              ) : null}
              <td className="px-3 py-3 text-zinc-500">{formatDateTime(listing.updatedAt)}</td>
              {!compact ? (
                <td className="px-3 py-3">
                  <ListingCommandButtons listing={listing} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListingCommandButtons({ listing }: { listing: EbayStorefrontListing }) {
  const queueCommand = useQueueEbayListingCommand();

  const queue = async (commandType: EbayListingCommandType) => {
    if (
      (commandType === "publish" || commandType === "reprice" || commandType === "update_price") &&
      listing.readiness !== "ready"
    ) {
      toast.error("Fix listing readiness before queueing a publish or price command");
      return;
    }

    try {
      await queueCommand.mutateAsync({ listingId: listing.id, commandType });
      toast.success(`Queued ${listing.skuCode ?? "listing"} ${humanize(commandType)} command`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not queue ${humanize(commandType)}`);
    }
  };

  const isLive = listing.status === "live";

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <ActionButton
        onClick={() => queue(isLive ? "reprice" : "publish")}
        disabled={queueCommand.isPending || listing.readiness !== "ready"}
        variant={isLive ? "default" : "primary"}
      >
        <Play className="h-3.5 w-3.5" />
        {isLive ? "Reprice" : "Publish"}
      </ActionButton>
      <ActionButton onClick={() => queue("sync_quantity")} disabled={queueCommand.isPending}>
        <RefreshCcw className="h-3.5 w-3.5" />
        Qty
      </ActionButton>
      {isLive ? (
        <ActionButton onClick={() => queue("pause")} disabled={queueCommand.isPending}>
          Pause
        </ActionButton>
      ) : null}
      <ActionButton onClick={() => queue("end")} disabled={queueCommand.isPending} variant="danger">
        End
      </ActionButton>
    </div>
  );
}

function OrdersTab({
  orders,
  landing,
}: {
  orders: ReturnType<typeof useOrders>["data"];
  landing: { source: string; pending: number; committed: number; error: number; latestReceivedAt: string | null }[];
}) {
  const orderLanding = landing.find((row) => row.source === "orders");
  const visibleOrders = (orders ?? []).slice(0, 25);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="eBay Orders" value={orders?.length ?? 0} />
        <StatCard label="Staged Orders Pending" value={orderLanding?.pending ?? 0} tone={orderLanding?.pending ? "warn" : "good"} />
        <StatCard label="Staged Order Errors" value={orderLanding?.error ?? 0} tone={orderLanding?.error ? "bad" : "good"} />
      </div>
      <SurfaceCard noPadding>
        <div className="border-b border-zinc-200 px-4 py-3">
          <SectionHead>Orders And Disputes</SectionHead>
          <p className="text-xs text-zinc-500">Order actions stay in the operational order workspace; this view surfaces the eBay queue.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-xs">
            <thead className="bg-zinc-50 text-[10px] uppercase tracking-[0.06em] text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Order</th>
                <th className="px-3 py-2 font-semibold">External Ref</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Total</th>
                <th className="px-3 py-2 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {visibleOrders.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-sm text-zinc-500">No eBay orders found.</td></tr>
              ) : visibleOrders.map((order) => (
                <tr key={order.id} className="hover:bg-zinc-50/70">
                  <td className="px-4 py-3">
                    <Link to={`/admin/orders/${order.id}`} className="font-medium text-amber-600 hover:text-amber-500">
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-3"><Mono>{order.externalOrderId ?? "-"}</Mono></td>
                  <td className="px-3 py-3"><Badge label={humanize(order.status)} color={statusColors[order.status] ?? "#71717A"} small /></td>
                  <td className="px-3 py-3 font-mono">{formatMoney(order.total)}</td>
                  <td className="px-3 py-3 text-zinc-500">{formatDateTime(order.orderDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SurfaceCard>
    </div>
  );
}

function PoliciesTab({ listings }: { listings: EbayStorefrontListing[] }) {
  const missingCategory = listings.filter((listing) => !listing.ebayCategoryId).length;
  const gradeFiveDisclosure = listings.filter((listing) => listing.grade === 5 && listing.readiness === "compliance_risk").length;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <PolicyCard title="Fulfillment Policies" state="Configured in Settings" detail="Shipping, handling, and inventory-location policy IDs are mapped outside operational pages." />
      <PolicyCard title="Payment And Returns" state="Mapping Required" detail={`${missingCategory} listings currently lack category or policy readiness.`} warn={missingCategory > 0} />
      <PolicyCard title="Grade 5 Disclosure Gate" state="Active Guardrail" detail={`${gradeFiveDisclosure} Red Card listings need disclosure review before publish.`} warn={gradeFiveDisclosure > 0} />
      <SurfaceCard className="xl:col-span-3">
        <SectionHead>Policy Matrix</SectionHead>
        <div className="grid gap-3 md:grid-cols-3">
          {["Inventory API offer policies", "Account API payment policies", "Metadata API valid values"].map((label) => (
            <div key={label} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <div className="text-sm font-semibold text-zinc-900">{label}</div>
              <p className="mt-1 text-xs text-zinc-500">Managed through staged app commands and Settings-owned mappings.</p>
            </div>
          ))}
        </div>
      </SurfaceCard>
    </div>
  );
}

function PolicyCard({ title, state, detail, warn }: { title: string; state: string; detail: string; warn?: boolean }) {
  return (
    <SurfaceCard>
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionHead>{title}</SectionHead>
          <div className="text-sm font-semibold text-zinc-900">{state}</div>
          <p className="mt-2 text-xs text-zinc-500">{detail}</p>
        </div>
        {warn ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-green-600" />}
      </div>
    </SurfaceCard>
  );
}

function PromotionsTab() {
  return (
    <SurfaceCard>
      <SectionHead>Promotions</SectionHead>
      <div className="grid gap-3 md:grid-cols-3">
        <Capability title="Markdown Promotions" detail="Build approval batches before calling item price markdown endpoints." />
        <Capability title="Promoted Listings" detail="Surface bid and budget recommendations before campaign mutation." />
        <Capability title="Interested Buyer Offers" detail="Use eligible-listing discovery, then require human review of discount bounds." />
      </div>
    </SurfaceCard>
  );
}

function CategoriesTab({ listings }: { listings: EbayStorefrontListing[] }) {
  const mapped = listings.filter((listing) => listing.ebayCategoryId).length;
  const unmapped = listings.length - mapped;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label="Mapped Listings" value={mapped} tone="good" />
        <StatCard label="Unmapped Listings" value={unmapped} tone={unmapped ? "warn" : "good"} />
      </div>
      <SurfaceCard>
        <SectionHead>Store Categories</SectionHead>
        <p className="text-sm text-zinc-700">
          eBay Stores API supports reading store metadata, adding, renaming, deleting, and moving store categories. The first build surfaces mapping health; category editing should queue outbound commands before API mutation.
        </p>
      </SurfaceCard>
    </div>
  );
}

function ComplianceTab({
  listings,
  health,
}: {
  listings: EbayStorefrontListing[];
  health: { area: string; healthStatus: string; recommendation: string; openCount: number; failedCount: number }[];
}) {
  const risky = listings.filter((listing) => listing.readiness === "compliance_risk");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Compliance Risks" value={risky.length} tone={risky.length ? "bad" : "good"} />
        <StatCard label="Health Areas" value={health.length} />
        <StatCard label="Failed Areas" value={health.filter((row) => row.failedCount > 0).length} tone="warn" />
      </div>
      <SurfaceCard noPadding>
        <div className="border-b border-zinc-200 px-4 py-3">
          <SectionHead>Compliance And Health</SectionHead>
        </div>
        <div className="divide-y divide-zinc-100">
          {risky.length === 0 ? (
            <div className="p-6 text-sm text-zinc-500">No listing compliance risks detected by app-side readiness checks.</div>
          ) : risky.map((listing) => (
            <div key={listing.id} className="px-4 py-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <Mono color="amber">{listing.skuCode ?? "-"}</Mono>
                <ReadinessBadge value={listing.readiness} />
              </div>
              <div className="mt-1 text-zinc-600">{listing.readinessReasons.join(" · ")}</div>
            </div>
          ))}
        </div>
      </SurfaceCard>
    </div>
  );
}

function FinanceTab({
  payouts,
  landing,
}: {
  payouts: ReturnType<typeof usePayouts>["data"];
  landing: { source: string; pending: number; committed: number; error: number; latestReceivedAt: string | null }[];
}) {
  const payoutLanding = landing.find((row) => row.source === "payouts");
  const totalNet = (payouts ?? []).slice(0, 10).reduce((sum, payout) => sum + Number(payout.netAmount ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Recent Net" value={formatMoney(totalNet)} sub="Latest 10 payouts" />
        <StatCard label="Payouts Staged Pending" value={payoutLanding?.pending ?? 0} tone={payoutLanding?.pending ? "warn" : "good"} />
        <StatCard label="Payout Staging Errors" value={payoutLanding?.error ?? 0} tone={payoutLanding?.error ? "bad" : "good"} />
      </div>
      <SurfaceCard noPadding>
        <div className="border-b border-zinc-200 px-4 py-3">
          <SectionHead>Finance And Payouts</SectionHead>
          <p className="text-xs text-zinc-500">Finance ingestion lands and reconciles separately from listing or order sync.</p>
        </div>
        <div className="divide-y divide-zinc-100">
          {(payouts ?? []).slice(0, 20).map((payout) => (
            <div key={payout.id} className="grid gap-2 px-4 py-3 text-xs md:grid-cols-[1fr_1fr_1fr_1fr]">
              <div><Mono color="amber">{payout.externalPayoutId ?? shortId(payout.id)}</Mono></div>
              <div>{formatDateTime(payout.payoutDate)}</div>
              <div className="font-mono">{formatMoney(payout.netAmount)}</div>
              <div><Badge label={humanize(payout.reconciliationStatus)} color={payout.reconciliationStatus === "reconciled" ? "#16A34A" : "#D97706"} small /></div>
            </div>
          ))}
          {(payouts ?? []).length === 0 ? <div className="p-6 text-sm text-zinc-500">No eBay payouts found.</div> : null}
        </div>
      </SurfaceCard>
    </div>
  );
}

function JobsTab({
  commands,
  landing,
}: {
  commands: ListingCommandRow[];
  landing: { source: string; pending: number; committed: number; error: number; latestReceivedAt: string | null }[];
}) {
  const runScheduled = useRunSubledgerScheduledJobs();

  const runListingOutbox = async () => {
    try {
      await runScheduled.mutateAsync("listing_outbox");
      toast.success("Listing outbox processor started");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start listing outbox");
    }
  };

  return (
    <div className="space-y-4">
      <SurfaceCard>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <SectionHead>Jobs And Automation</SectionHead>
            <p className="text-xs text-zinc-500">Safe automations pull into staging or drain the outbound command queue.</p>
          </div>
          <ActionButton onClick={runListingOutbox} disabled={runScheduled.isPending} variant="primary">
            <Play className="h-3.5 w-3.5" />
            Run Listing Outbox
          </ActionButton>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {landing.map((row) => (
            <div key={row.source} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <div className="text-sm font-semibold capitalize text-zinc-900">{row.source}</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                <div><div className="font-mono text-amber-600">{row.pending}</div><div className="text-zinc-500">Pending</div></div>
                <div><div className="font-mono text-green-600">{row.committed}</div><div className="text-zinc-500">Done</div></div>
                <div><div className="font-mono text-red-600">{row.error}</div><div className="text-zinc-500">Error</div></div>
              </div>
              <div className="mt-2 text-[11px] text-zinc-500">Latest {formatDateTime(row.latestReceivedAt)}</div>
            </div>
          ))}
        </div>
      </SurfaceCard>

      <SurfaceCard noPadding>
        <div className="border-b border-zinc-200 px-4 py-3">
          <SectionHead>Listing Commands</SectionHead>
        </div>
        <div className="divide-y divide-zinc-100">
          {commands.length === 0 ? (
            <div className="p-6 text-sm text-zinc-500">No eBay listing commands found.</div>
          ) : commands.map((command) => <CommandRow key={command.id} command={command} />)}
        </div>
      </SurfaceCard>
    </div>
  );
}

function CommandRow({ command, compact }: { command: ListingCommandRow; compact?: boolean }) {
  const runNow = useRunListingCommandNow();
  const retry = useRetryListingCommand();
  const cancel = useCancelListingCommand();

  const handleRun = async () => {
    try {
      await runNow.mutateAsync(command.id);
      toast.success("Listing command processor started");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not process command");
    }
  };

  const handleRetry = async () => {
    try {
      await retry.mutateAsync(command.id);
      toast.success("Listing command queued for retry");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not retry command");
    }
  };

  const handleCancel = async () => {
    try {
      await cancel.mutateAsync(command.id);
      toast.success("Listing command cancelled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel command");
    }
  };

  const canRun = command.status === "pending" || command.status === "failed";
  const canRetry = command.status === "failed" || command.status === "cancelled";
  const canCancel = !["sent", "acknowledged", "processing", "cancelled"].includes(command.status);

  return (
    <div className={cn("grid gap-3 px-4 py-3 text-xs", compact ? "grid-cols-[1fr_auto]" : "lg:grid-cols-[1.2fr_0.8fr_0.8fr_1.2fr]")}>
      <div>
        <div className="flex items-center gap-2">
          <CommandStatusBadge value={command.status} />
          <span className="font-semibold text-zinc-900">{humanize(command.commandType)}</span>
        </div>
        <div className="mt-1 text-zinc-500">
          <Mono>{command.skuCode ?? command.appReference ?? shortId(command.entityId)}</Mono>
        </div>
        {command.lastError && !compact ? <div className="mt-1 text-[11px] text-red-600">{command.lastError}</div> : null}
      </div>
      {!compact ? (
        <>
          <div className="text-zinc-500">Created {formatDateTime(command.createdAt)}</div>
          <div className="text-zinc-500">Next {formatDateTime(command.nextAttemptAt)}</div>
          <div className="flex flex-wrap justify-end gap-2">
            <ActionButton onClick={handleRun} disabled={!canRun || runNow.isPending}><Play className="h-3.5 w-3.5" />Run</ActionButton>
            <ActionButton onClick={handleRetry} disabled={!canRetry || retry.isPending}><RefreshCcw className="h-3.5 w-3.5" />Retry</ActionButton>
            <ActionButton onClick={handleCancel} disabled={!canCancel || cancel.isPending} variant="danger"><XCircle className="h-3.5 w-3.5" />Cancel</ActionButton>
          </div>
        </>
      ) : (
        <div className="text-right text-zinc-500">{formatDateTime(command.createdAt)}</div>
      )}
    </div>
  );
}

function AuditTab({
  commands,
  notifications,
}: {
  commands: ListingCommandRow[];
  notifications: { id: string; topic: string; notificationId: string | null; receivedAt: string; read: boolean }[];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SurfaceCard noPadding>
        <div className="border-b border-zinc-200 px-4 py-3">
          <SectionHead>Outbound Audit</SectionHead>
        </div>
        <div className="divide-y divide-zinc-100">
          {commands.slice(0, 25).map((command) => <CommandRow key={command.id} command={command} compact />)}
          {commands.length === 0 ? <div className="p-6 text-sm text-zinc-500">No outbound command audit entries found.</div> : null}
        </div>
      </SurfaceCard>
      <SurfaceCard noPadding>
        <div className="border-b border-zinc-200 px-4 py-3">
          <SectionHead>Inbound Notifications</SectionHead>
        </div>
        <div className="divide-y divide-zinc-100">
          {notifications.map((notification) => (
            <div key={notification.id} className="px-4 py-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-zinc-900">{notification.topic}</div>
                {notification.read ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <FileText className="h-3.5 w-3.5 text-amber-600" />}
              </div>
              <div className="mt-1 text-zinc-500">
                <Mono>{notification.notificationId ?? shortId(notification.id)}</Mono> · {formatDateTime(notification.receivedAt)}
              </div>
            </div>
          ))}
          {notifications.length === 0 ? <div className="p-6 text-sm text-zinc-500">No eBay notifications found.</div> : null}
        </div>
      </SurfaceCard>
    </div>
  );
}

function Capability({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div className="text-sm font-semibold text-zinc-900">{title}</div>
      <p className="mt-1 text-xs text-zinc-500">{detail}</p>
    </div>
  );
}
