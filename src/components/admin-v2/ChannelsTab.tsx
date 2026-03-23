import { useChannelListings, usePublishListing, useBatchPublishListings } from "@/hooks/admin/use-channel-listings";
import { CHANNEL_LISTING_STATUSES } from "@/lib/constants/unit-statuses";
import type { ProductVariant, Channel, ChannelListing } from "@/lib/types/admin";
import { SurfaceCard, Mono, Badge, GradeBadge } from "./ui-primitives";
import { toast } from "sonner";

interface ChannelsTabProps {
  variants: ProductVariant[];
}

const CHANNELS: { key: Channel; label: string }[] = [
  { key: "ebay", label: "eBay" },
  { key: "website", label: "Website" },
  { key: "bricklink", label: "BrickLink" },
  { key: "brickowl", label: "BrickOwl" },
];

export function ChannelsTab({ variants }: ChannelsTabProps) {
  return (
    <div className="grid gap-4">
      {variants.map((v) => (
        <VariantChannelsCard key={v.sku} variant={v} />
      ))}
    </div>
  );
}

function VariantChannelsCard({ variant }: { variant: ProductVariant }) {
  const { data: listings = [] } = useChannelListings(variant.sku);
  const publishListing = usePublishListing();
  const batchPublish = useBatchPublishListings();

  const listingsByChannel = new Map<string, ChannelListing>();
  for (const l of listings) {
    listingsByChannel.set(l.channel, l);
  }

  const handlePublish = async (channel: Channel) => {
    try {
      await publishListing.mutateAsync({ skuCode: variant.sku, channel });
      toast.success(`Published ${variant.sku} to ${channel}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Publish failed";
      toast.error(message);
    }
  };

  const handlePublishAll = async () => {
    try {
      await batchPublish.mutateAsync({
        skuCode: variant.sku,
        channels: CHANNELS.map((c) => c.key),
      });
      toast.success(`Published ${variant.sku} to all channels`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Publish failed";
      toast.error(message);
    }
  };

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <Mono color="amber" className="text-sm">{variant.sku}</Mono>
          <GradeBadge grade={variant.grade} size="md" />
          <Mono color="teal">
            {variant.salePrice ? `£${variant.salePrice.toFixed(2)}` : "—"}
          </Mono>
        </div>
        <button
          onClick={handlePublishAll}
          disabled={batchPublish.isPending}
          className="bg-green-500 text-zinc-900 border-none rounded-md px-3.5 py-1.5 font-bold text-xs cursor-pointer disabled:opacity-50 hover:bg-green-400 transition-colors"
        >
          {batchPublish.isPending ? "Publishing…" : "Publish All"}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {CHANNELS.map((ch) => {
          const listing = listingsByChannel.get(ch.key);
          const status = listing?.status ?? "draft";
          const statusInfo = CHANNEL_LISTING_STATUSES[status];

          return (
            <div
              key={ch.key}
              className="p-3 bg-[#35353A] rounded-md border border-zinc-700/80"
            >
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs font-semibold text-zinc-50">{ch.label}</span>
                <Badge label={statusInfo.label} color={statusInfo.color} small />
              </div>
              <button
                onClick={() => handlePublish(ch.key)}
                disabled={publishListing.isPending}
                className="w-full py-1.5 bg-[#3F3F46] text-zinc-400 border border-zinc-700/80 rounded text-[11px] cursor-pointer hover:text-zinc-200 transition-colors disabled:opacity-50"
              >
                {status === "live" ? "Republish" : "Publish"}
              </button>
            </div>
          );
        })}
      </div>
    </SurfaceCard>
  );
}
