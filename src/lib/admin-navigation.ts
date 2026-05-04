import type { ElementType } from "react";
import {
  BarChart3,
  ClipboardList,
  Facebook,
  FileSearch,
  Instagram,
  Package,
  ShoppingBag,
  Store,
  Twitter,
  Users,
  Wallet,
  Settings,
  Youtube,
} from "lucide-react";

export type AdminNavCountKey = "ungraded" | "actionNeeded";

export interface AdminNavItem {
  icon: ElementType;
  label: string;
  to: string;
  description: string;
  match: string[];
  countKey?: AdminNavCountKey;
}

export interface AdminNavSection {
  label: string;
  items: AdminNavItem[];
}

export const adminSidebarSections: AdminNavSection[] = [
  {
    label: "Operations",
    items: [
      {
        icon: ClipboardList,
        label: "Work Queue",
        to: "/admin/work-queue",
        description: "Purchases, intake, grading, and daily exceptions.",
        match: ["/admin/work-queue", "/admin/intake"],
        countKey: "ungraded",
      },
      {
        icon: Package,
        label: "Inventory",
        to: "/admin/products",
        description: "Products, stock units, media, content, and listings.",
        match: ["/admin/products"],
      },
      {
        icon: ShoppingBag,
        label: "Orders",
        to: "/admin/orders",
        description: "Allocation, fulfilment, returns, and refunds.",
        match: ["/admin/orders"],
        countKey: "actionNeeded",
      },
      {
        icon: Wallet,
        label: "Finance",
        to: "/admin/payouts",
        description: "Payouts, reconciliation, QBO posting, and exports.",
        match: ["/admin/payouts", "/admin/operations"],
      },
      {
        icon: Users,
        label: "Customers",
        to: "/admin/customers",
        description: "Customer lookup, order history, and club context.",
        match: ["/admin/customers"],
      },
    ],
  },
  {
    label: "Marketing",
    items: [
      {
        icon: FileSearch,
        label: "SEO/GEO",
        to: "/admin/settings/seo-geo",
        description: "Search, generative answer optimisation, sitemap, and structured data.",
        match: ["/admin/settings/seo-geo"],
      },
      {
        icon: Store,
        label: "Google Merchant",
        to: "/admin/gmc",
        description: "Merchant feed readiness, mapping, publishing, and command recovery.",
        match: ["/admin/gmc"],
      },
      {
        icon: BarChart3,
        label: "Google Analytics",
        to: "/admin/marketing/google-analytics",
        description: "Analytics reporting and campaign measurement workspace.",
        match: ["/admin/marketing/google-analytics"],
      },
      {
        icon: Facebook,
        label: "Facebook",
        to: "/admin/marketing/facebook",
        description: "Facebook catalogue, campaign, and content controls.",
        match: ["/admin/marketing/facebook"],
      },
      {
        icon: Instagram,
        label: "Instagram",
        to: "/admin/marketing/instagram",
        description: "Instagram shop, catalogue, and content controls.",
        match: ["/admin/marketing/instagram"],
      },
      {
        icon: Twitter,
        label: "Twitter",
        to: "/admin/marketing/twitter",
        description: "Twitter channel publishing and campaign controls.",
        match: ["/admin/marketing/twitter"],
      },
      {
        icon: Youtube,
        label: "YouTube",
        to: "/admin/marketing/youtube",
        description: "YouTube content planning and performance controls.",
        match: ["/admin/marketing/youtube"],
      },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        icon: Settings,
        label: "Settings/System",
        to: "/admin/settings",
        description: "Integrations, rules, mappings, diagnostics, and logs.",
        match: [
          "/admin/settings",
          "/admin/settings/integrations",
          "/admin/settings/pricing",
          "/admin/settings/shipping-rates",
          "/admin/settings/channel-mappings",
          "/admin/settings/app-health",
          "/admin/settings/transcripts",
          "/admin/data-sync",
        ],
      },
    ],
  },
];

export function isAdminNavItemActive(pathname: string, item: AdminNavItem) {
  return item.match.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
