import type { ElementType } from "react";
import {
  ClipboardList,
  Package,
  ShoppingBag,
  Users,
  Wallet,
  Settings,
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
    label: "Admin",
    items: [
      {
        icon: Settings,
        label: "Settings/System",
        to: "/admin/settings",
        description: "Integrations, rules, mappings, diagnostics, and logs.",
        match: ["/admin/settings", "/admin/data-sync", "/admin/gmc"],
      },
    ],
  },
];

export function isAdminNavItemActive(pathname: string, item: AdminNavItem) {
  return item.match.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
