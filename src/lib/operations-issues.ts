export type OperationsIssueDomain = "all" | "transactions" | "customers" | "inventory" | "products" | "integrations";

export interface OperationsIssueSummary {
  id: string;
  domain: Exclude<OperationsIssueDomain, "all">;
  issueType: string;
  severity: string;
  primaryAction: string;
  primaryReference: string | null;
  secondaryReference: string | null;
  title: string;
  whyItMatters: string;
  recommendedAction: string;
  evidence: Record<string, unknown>;
  targetRoute?: string | null;
  targetLabel?: string | null;
}

export const issueDomainTabs: Array<{ key: OperationsIssueDomain; label: string }> = [
  { key: "all", label: "All Issues" },
  { key: "transactions", label: "Transactions" },
  { key: "customers", label: "Customers" },
  { key: "inventory", label: "Inventory" },
  { key: "products", label: "Products" },
  { key: "integrations", label: "Integrations" },
];

export const issueDomainColors: Record<Exclude<OperationsIssueDomain, "all">, string> = {
  transactions: "#2563EB",
  customers: "#0D9488",
  inventory: "#D97706",
  products: "#7C3AED",
  integrations: "#DC2626",
};

export const issueSeverityColors: Record<string, string> = {
  critical: "#B91C1C",
  high: "#DC2626",
  medium: "#D97706",
  low: "#16A34A",
};

export const issueActionLabels: Record<string, string> = {
  allocate_stock: "Allocate stock",
  approve_price_override: "Review price",
  cancel_integration: "Cancel command",
  dismiss: "Dismiss",
  fix_customer_mapping: "Fix customer mapping",
  fix_customer_record: "Fix customer record",
  fix_listing_data: "Fix listing data",
  fix_product_media: "Fix media",
  fix_product_specs: "Fix specs",
  link_customer: "Link customer",
  link_transaction: "Link transaction",
  merge_transaction: "Merge duplicate",
  pause_listing: "Pause listing",
  queue_qbo_posting: "Queue QBO post",
  reassign_customer: "Reassign customer",
  refresh_price: "Refresh price",
  refresh_settlement: "Refresh settlement",
  retry_integration: "Retry",
  review_duplicate: "Review duplicate",
  review_qbo_landing: "Review QBO record",
  start_work: "Start work",
  sync_listing_quantity: "Sync quantity",
};

export const issueActionGroupLabels: Record<string, string> = {
  allocate_stock: "Allocate Stock",
  approve_price_override: "Review Price Overrides",
  cancel_integration: "Cancel Failed Commands",
  dismiss: "Dismiss With Reason",
  fix_customer_mapping: "Fix Customer Mapping",
  fix_customer_record: "Complete Customer Records",
  fix_listing_data: "Fix Listing Data",
  fix_product_media: "Fix Listing Media",
  fix_product_specs: "Fix Product Specs",
  link_customer: "Link Customers",
  link_transaction: "Link Missing Transactions",
  merge_transaction: "Merge Duplicate Transactions",
  pause_listing: "Pause Out-of-Stock Listings",
  queue_qbo_posting: "Queue Missing QBO Transactions",
  reassign_customer: "Reassign Customers",
  refresh_price: "Refresh Pricing",
  refresh_settlement: "Refresh Settlement",
  retry_integration: "Retry Integrations",
  review_duplicate: "Review Duplicate Transactions",
  review_qbo_landing: "Review QBO-Only Transactions",
  start_work: "Review Evidence",
  sync_listing_quantity: "Sync Listing Quantity",
};

const navigationActions = new Set([
  "allocate_stock",
  "approve_price_override",
  "fix_customer_mapping",
  "fix_customer_record",
  "fix_listing_data",
  "fix_product_media",
  "fix_product_specs",
  "link_customer",
  "link_transaction",
  "merge_transaction",
  "pause_listing",
  "reassign_customer",
  "refresh_price",
  "refresh_settlement",
  "retry_integration",
  "review_duplicate",
  "review_qbo_landing",
  "sync_listing_quantity",
]);

const noteRequiredActions = new Set(["dismiss", "resolve", "suppress", "cancel_integration"]);

export function humanizeToken(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getIssueActionLabel(action: string | null | undefined): string {
  if (!action) return "Review";
  return issueActionLabels[action] ?? humanizeToken(action);
}

export function getIssueActionGroupLabel(action: string | null | undefined): string {
  if (!action) return "Review Issues";
  return issueActionGroupLabels[action] ?? `${humanizeToken(action)} Issues`;
}

export function getIssueSeverityColor(severity: string | null | undefined): string {
  return issueSeverityColors[severity ?? ""] ?? "#71717A";
}

export function isIssueNavigationAction(action: string | null | undefined): boolean {
  return action ? navigationActions.has(action) : true;
}

export function requiresIssueNote(action: string | null | undefined): boolean {
  return action ? noteRequiredActions.has(action) : false;
}

export function groupIssuesByAction<T extends { primaryAction: string }>(issues: T[]): Array<{ action: string; issues: T[] }> {
  const groups = new Map<string, T[]>();

  for (const issue of issues) {
    const action = issue.primaryAction || "start_work";
    const group = groups.get(action);
    if (group) {
      group.push(issue);
    } else {
      groups.set(action, [issue]);
    }
  }

  return Array.from(groups.entries()).map(([action, groupedIssues]) => ({
    action,
    issues: groupedIssues,
  }));
}

export function summarizeIssueEvidence(issue: OperationsIssueSummary): string[] {
  const refs = [issue.primaryReference, issue.secondaryReference].filter(Boolean) as string[];
  const evidence = issue.evidence ?? {};
  const rawEvidence = Object.entries(evidence)
    .filter(([, value]) => value != null && value !== "")
    .slice(0, 3)
    .map(([key]) => humanizeToken(key));

  return Array.from(new Set([...refs, ...rawEvidence])).slice(0, 4);
}

const productUuidRoutePattern = /^\/admin\/products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const skuPattern = /^(.+-\d+)\.[1-5]$/;

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getEvidenceString(issue: OperationsIssueSummary, section: string, key: string): string | null {
  const record = toRecord(issue.evidence?.[section]);
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mpnFromSku(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(skuPattern);
  return match?.[1] ?? null;
}

export function getIssueProductMpn(issue: OperationsIssueSummary): string | null {
  return (
    getEvidenceString(issue, "product", "mpn") ??
    mpnFromSku(getEvidenceString(issue, "product", "sku_code")) ??
    mpnFromSku(getEvidenceString(issue, "listing", "external_sku")) ??
    mpnFromSku(issue.primaryReference) ??
    mpnFromSku(issue.secondaryReference) ??
    mpnFromSku(issue.targetLabel)
  );
}

export function getIssueNavigationRoute(issue: OperationsIssueSummary): string | null {
  const targetRoute = issue.targetRoute ?? null;
  if (!targetRoute) return null;

  if (productUuidRoutePattern.test(targetRoute)) {
    const mpn = getIssueProductMpn(issue);
    return mpn ? `/admin/products/${mpn}` : targetRoute;
  }

  return targetRoute;
}
