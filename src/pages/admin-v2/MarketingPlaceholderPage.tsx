import type { ElementType } from "react";
import { BarChart3, Facebook, Instagram, Twitter, Youtube } from "lucide-react";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { AdminPageHeader } from "@/components/admin-v2/admin-patterns";
import { SurfaceCard } from "@/components/admin-v2/ui-primitives";

type MarketingChannel = "google-analytics" | "facebook" | "instagram" | "twitter" | "youtube";

interface ChannelConfig {
  title: string;
  description: string;
  icon: ElementType;
}

const channelConfig: Record<MarketingChannel, ChannelConfig> = {
  "google-analytics": {
    title: "Google Analytics",
    description: "Analytics reporting, campaign measurement, attribution, and audience insight controls will live here.",
    icon: BarChart3,
  },
  facebook: {
    title: "Facebook",
    description: "Facebook catalogue, campaign, audience, and channel content controls will live here.",
    icon: Facebook,
  },
  instagram: {
    title: "Instagram",
    description: "Instagram shop, catalogue, campaign, and content planning controls will live here.",
    icon: Instagram,
  },
  twitter: {
    title: "Twitter",
    description: "Twitter campaign, publishing, and performance controls will live here.",
    icon: Twitter,
  },
  youtube: {
    title: "YouTube",
    description: "YouTube content planning, publishing, and performance controls will live here.",
    icon: Youtube,
  },
};

export default function MarketingPlaceholderPage({ channel }: { channel: MarketingChannel }) {
  const config = channelConfig[channel];
  const Icon = config.icon;

  return (
    <AdminV2Layout>
      <div className="space-y-6">
        <AdminPageHeader
          title={config.title}
          description={config.description}
        />

        <SurfaceCard>
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-900">{config.title} workspace coming soon</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                This placeholder keeps the Marketing navigation in place while the channel-specific integration, reporting, and approval workflows are designed.
              </p>
            </div>
          </div>
        </SurfaceCard>
      </div>
    </AdminV2Layout>
  );
}
