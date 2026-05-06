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
  sourceSystem?: string | null;
  sourceTable?: string | null;
  sourceId?: string | null;
  primaryEntityType?: string | null;
  primaryEntityId?: string | null;
  targetRoute?: string | null;
  targetLabel?: string | null;
  amountExpected?: number | null;
  amountActual?: number | null;
  varianceAmount?: number | null;
}

export interface IssueTraceItem {
  label: string;
  value: string;
  displayValue: string;
}

export interface IssueDisplayInfo {
  primaryLabel: string;
  secondaryLabel: string | null;
  evidenceChips: string[];
  traceItems: IssueTraceItem[];
  searchableValues: string[];
  navigationRoute: string | null;
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
  "reassign_customer",
  "refresh_price",
  "refresh_settlement",
  "review_duplicate",
  "review_qbo_landing",
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function recordString(record: Record<string, unknown> | null | undefined, key: string): string | null {
  return record ? stringValue(record[key]) : null;
}

function recordNumber(record: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!record) return null;
  const value = record[key];
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pushUnique(values: string[], value: unknown) {
  const text = stringValue(value);
  if (text && !values.includes(text)) values.push(text);
}

function shortTraceValue(value: string): string {
  if (value.length <= 22) return value;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) return `${value.slice(0, 8)}...${value.slice(-4)}`;
  return `${value.slice(0, 16)}...`;
}

function addTrace(items: IssueTraceItem[], label: string, value: unknown) {
  const text = stringValue(value);
  if (!text || text === "-") return;
  if (items.some((item) => item.label === label && item.value === text)) return;
  items.push({ label, value: text, displayValue: shortTraceValue(text) });
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return null;
}

function stripDuplicatePrefix(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/^(qbo|doc|origin|fingerprint):/i, "");
}

function mpnFromSku(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^(.+)\.[1-5]$/);
  return match?.[1] ?? null;
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function formatIssueMoney(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function formatQuantity(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function arrayPreview(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const preview = value.map((item) => stringValue(item)).filter(Boolean).slice(0, 3);
  if (preview.length === 0) return null;
  return `${preview.join(", ")}${value.length > preview.length ? ` +${value.length - preview.length}` : ""}`;
}

function productRouteFromIssue(issue: OperationsIssueSummary, mpn: string | null, sku: string | null): string | null {
  const route = issue.targetRoute ?? null;
  const routeProductValue = route?.match(/^\/admin\/products\/([^/]+)$/)?.[1];
  const derivedMpn = mpn ?? mpnFromSku(sku);

  if (routeProductValue && looksLikeUuid(decodeURIComponent(routeProductValue)) && derivedMpn) {
    return `/admin/products/${encodeURIComponent(derivedMpn)}`;
  }

  if (route) return route;
  return derivedMpn ? `/admin/products/${encodeURIComponent(derivedMpn)}` : null;
}

export function getIssueDisplayInfo(issue: OperationsIssueSummary): IssueDisplayInfo {
  const evidence = issue.evidence ?? {};
  const app = asRecord(evidence.app);
  const qbo = asRecord(evidence.qbo);
  const listing = asRecord(evidence.listing);
  const product = asRecord(evidence.product);
  const customer = asRecord(evidence.customer);
  const order = asRecord(evidence.order);
  const line = asRecord(evidence.line);
  const inventory = asRecord(evidence.inventory);
  const pricing = asRecord(evidence.pricing);
  const postingIntent = asRecord(evidence.posting_intent);
  const outboundCommand = asRecord(evidence.outbound_command);
  const postingPayload = asRecord(postingIntent?.payload);
  const commandPayload = asRecord(outboundCommand?.payload);

  const qboDoc = firstString(recordString(qbo, "doc_number"), issue.issueType.includes("qbo_") ? issue.primaryReference : null);
  const qboId = firstString(recordString(qbo, "external_id"), recordString(qbo, "qbo_entity_id"));
  const qboCustomer = firstString(recordString(qbo, "customer_ref"), recordString(qbo, "vendor_ref"));
  const orderNumber = firstString(
    recordString(order, "order_number"),
    recordString(app, "order_number"),
    recordString(postingPayload, "order_number"),
    issue.primaryEntityType === "sales_order" ? issue.primaryReference : null,
  );
  const purchaseReference = firstString(
    recordString(app, "reference"),
    recordString(postingPayload, "reference"),
    recordString(postingPayload, "batch_id"),
    issue.issueType.includes("purchase") ? issue.primaryReference : null,
  );
  const customerName = firstString(recordString(customer, "display_name"), recordString(order, "guest_name"));
  const customerEmail = firstString(recordString(customer, "email"), recordString(order, "guest_email"));
  const sku = firstString(
    recordString(line, "sku_code"),
    recordString(listing, "external_sku"),
    recordString(commandPayload, "sku"),
    recordString(commandPayload, "sku_code"),
    issue.domain === "inventory" || issue.sourceTable === "channel_listing" ? issue.primaryReference : null,
  );
  const listingTitle = firstString(recordString(listing, "listing_title"), recordString(commandPayload, "listing_title"));
  const externalListingId = firstString(recordString(listing, "external_listing_id"), issue.sourceTable === "channel_listing" ? issue.secondaryReference : null);
  const channel = firstString(recordString(listing, "channel"), recordString(outboundCommand, "target_system"), issue.sourceSystem);
  const productName = firstString(recordString(product, "name"), listingTitle);
  const productMpn = firstString(recordString(product, "mpn"), mpnFromSku(sku));
  const sourceStatus = firstString(
    recordString(app, "qbo_sync_status"),
    recordString(qbo, "status"),
    recordString(postingIntent, "status"),
    recordString(outboundCommand, "status"),
    recordString(listing, "v2_status"),
  );
  const commandType = firstString(recordString(outboundCommand, "command_type"), issue.secondaryReference);
  const postingAction = firstString(recordString(postingIntent, "action"), issue.secondaryReference);
  const lastError = firstString(recordString(postingIntent, "last_error"), recordString(outboundCommand, "last_error"), recordString(qbo, "error_message"));
  const duplicateOrders = arrayPreview(evidence.order_numbers);
  const duplicateDocs = arrayPreview(evidence.doc_numbers);
  const duplicateExternalIds = arrayPreview(evidence.external_ids);

  let primaryLabel = firstString(issue.targetLabel, issue.primaryReference, issue.title, issue.id) ?? issue.title;
  let secondaryLabel: string | null = null;

  if (issue.issueType === "qbo_sales_receipt_missing_app") {
    primaryLabel = `QBO sales receipt ${qboDoc ?? qboId ?? issue.primaryReference ?? "unmatched"}`;
    secondaryLabel = [formatIssueMoney(recordNumber(qbo, "total_amount") ?? issue.amountExpected), recordString(qbo, "txn_date"), qboCustomer ? `customer ${qboCustomer}` : null]
      .filter(Boolean)
      .join(" · ") || null;
  } else if (issue.issueType === "qbo_purchase_missing_app") {
    primaryLabel = `QBO purchase ${qboDoc ?? qboId ?? issue.primaryReference ?? "unmatched"}`;
    secondaryLabel = [formatIssueMoney(recordNumber(qbo, "total_amount") ?? issue.amountExpected), recordString(qbo, "txn_date"), qboCustomer ? `vendor ${qboCustomer}` : null]
      .filter(Boolean)
      .join(" · ") || null;
  } else if (issue.issueType === "app_sales_receipt_missing_qbo") {
    primaryLabel = orderNumber ? `Order ${orderNumber}` : issue.primaryReference ?? "App sale";
    secondaryLabel = [recordString(app, "origin_channel"), recordString(app, "origin_reference"), formatIssueMoney(recordNumber(app, "gross_total") ?? issue.amountExpected)]
      .filter(Boolean)
      .join(" · ") || null;
  } else if (issue.issueType === "app_purchase_missing_qbo") {
    primaryLabel = purchaseReference ? `Purchase ${purchaseReference}` : "App purchase";
    secondaryLabel = [recordString(app, "supplier_name"), recordString(app, "purchase_date")]
      .filter(Boolean)
      .join(" · ") || null;
  } else if (issue.issueType.includes("duplicate")) {
    primaryLabel = `Duplicate candidate ${stripDuplicatePrefix(issue.primaryReference) ?? "transaction"}`;
    secondaryLabel = duplicateOrders ?? duplicateDocs ?? duplicateExternalIds;
  } else if (issue.domain === "customers") {
    primaryLabel = customerName ?? customerEmail ?? (orderNumber ? `Order ${orderNumber}` : issue.primaryReference ?? issue.title);
    secondaryLabel = [orderNumber ? `order ${orderNumber}` : null, customerEmail, recordString(customer, "qbo_customer_id")]
      .filter(Boolean)
      .join(" · ") || null;
  } else if (issue.issueType === "order_line_missing_stock_allocation") {
    primaryLabel = orderNumber && sku ? `Order ${orderNumber} / ${sku}` : orderNumber ? `Order ${orderNumber}` : sku ? `SKU ${sku}` : issue.title;
    secondaryLabel = [recordString(line, "quantity") ? `qty ${recordString(line, "quantity")}` : null, formatQuantity(recordNumber(inventory, "available_quantity")) ? `available ${formatQuantity(recordNumber(inventory, "available_quantity"))}` : null]
      .filter(Boolean)
      .join(" · ") || null;
  } else if (issue.domain === "inventory") {
    primaryLabel = productName ?? (sku ? `SKU ${sku}` : issue.primaryReference ?? issue.title);
    secondaryLabel = [sku, channel ? `${humanizeToken(channel)} listing` : null, externalListingId ? `external ${externalListingId}` : null]
      .filter(Boolean)
      .join(" · ") || null;
  } else if (issue.domain === "products") {
    primaryLabel = productName ?? listingTitle ?? (sku ? `SKU ${sku}` : issue.primaryReference ?? issue.title);
    secondaryLabel = [productMpn, sku, channel ? humanizeToken(channel) : null, recordString(evidence, "category_id")]
      .filter(Boolean)
      .join(" · ") || null;
  } else if (issue.domain === "integrations" && outboundCommand) {
    primaryLabel = `${humanizeToken(channel ?? "Channel")} ${humanizeToken(commandType ?? "command")} for ${sku ?? externalListingId ?? shortTraceValue(recordString(outboundCommand, "id") ?? issue.id)}`;
    secondaryLabel = lastError ?? ([sourceStatus, externalListingId].filter(Boolean).join(" · ") || null);
  } else if (issue.domain === "integrations" && postingIntent) {
    primaryLabel = `QBO ${humanizeToken(postingAction ?? "posting")} for ${orderNumber ?? purchaseReference ?? issue.primaryReference ?? shortTraceValue(recordString(postingIntent, "id") ?? issue.id)}`;
    secondaryLabel = lastError ?? sourceStatus;
  } else if (issue.domain === "integrations" && qboDoc) {
    primaryLabel = `QBO landing ${qboDoc}`;
    secondaryLabel = lastError ?? sourceStatus;
  }

  const evidenceChips: string[] = [];
  pushUnique(evidenceChips, channel ? humanizeToken(channel) : null);
  pushUnique(evidenceChips, sku);
  pushUnique(evidenceChips, qboDoc ? `QBO doc ${qboDoc}` : null);
  pushUnique(evidenceChips, sourceStatus ? humanizeToken(sourceStatus) : null);
  pushUnique(evidenceChips, recordNumber(listing, "listed_quantity") != null ? `Listed ${formatQuantity(recordNumber(listing, "listed_quantity"))}` : null);
  pushUnique(evidenceChips, recordNumber(inventory, "available_quantity") != null ? `Available ${formatQuantity(recordNumber(inventory, "available_quantity"))}` : null);
  pushUnique(evidenceChips, formatIssueMoney(issue.amountExpected) ? `Expected ${formatIssueMoney(issue.amountExpected)}` : null);
  pushUnique(evidenceChips, formatIssueMoney(issue.amountActual) ? `Actual ${formatIssueMoney(issue.amountActual)}` : null);
  pushUnique(evidenceChips, formatIssueMoney(issue.varianceAmount) ? `Variance ${formatIssueMoney(issue.varianceAmount)}` : null);
  pushUnique(evidenceChips, formatIssueMoney(recordNumber(pricing, "target_price")) ? `Target ${formatIssueMoney(recordNumber(pricing, "target_price"))}` : null);
  pushUnique(evidenceChips, formatIssueMoney(recordNumber(pricing, "floor_price")) ? `Floor ${formatIssueMoney(recordNumber(pricing, "floor_price"))}` : null);
  pushUnique(evidenceChips, recordNumber(postingIntent, "retry_count") != null ? `Retries ${recordNumber(postingIntent, "retry_count")}` : null);
  pushUnique(evidenceChips, recordNumber(outboundCommand, "retry_count") != null ? `Retries ${recordNumber(outboundCommand, "retry_count")}` : null);

  const traceItems: IssueTraceItem[] = [];
  addTrace(traceItems, "QBO Doc", qboDoc);
  addTrace(traceItems, "QBO ID", qboId);
  addTrace(traceItems, "QBO Landing", recordString(qbo, "landing_id"));
  addTrace(traceItems, "App Order", firstString(recordString(order, "sales_order_id"), recordString(app, "sales_order_id"), issue.primaryEntityType === "sales_order" ? issue.primaryEntityId : null));
  addTrace(traceItems, "Order Line", recordString(line, "sales_order_line_id"));
  addTrace(traceItems, "Purchase Batch", firstString(recordString(app, "purchase_batch_id"), issue.primaryEntityType === "purchase_batch" ? issue.primaryEntityId : null));
  addTrace(traceItems, "Customer", firstString(recordString(customer, "customer_id"), recordString(app, "customer_id")));
  addTrace(traceItems, "Product", firstString(recordString(product, "product_id"), recordString(evidence, "product_id"), issue.primaryEntityType === "product" ? issue.primaryEntityId : null));
  addTrace(traceItems, "SKU", firstString(recordString(line, "sku_id"), recordString(evidence, "sku_id")));
  addTrace(traceItems, "Listing", firstString(recordString(listing, "channel_listing_id"), issue.sourceTable === "channel_listing" ? issue.sourceId : null, issue.primaryEntityType === "channel_listing" ? issue.primaryEntityId : null));
  addTrace(traceItems, "External Listing", externalListingId);
  addTrace(traceItems, "Posting Intent", firstString(recordString(postingIntent, "id"), issue.sourceTable === "posting_intent" ? issue.sourceId : null));
  addTrace(traceItems, "Command", firstString(recordString(outboundCommand, "id"), issue.sourceTable === "outbound_command" ? issue.sourceId : null));
  addTrace(traceItems, humanizeToken(issue.sourceTable ?? "Source"), issue.sourceId);
  addTrace(traceItems, "Issue", issue.id);

  const searchableValues: string[] = [];
  [
    issue.id,
    issue.title,
    issue.issueType,
    issue.primaryAction,
    issue.primaryReference,
    issue.secondaryReference,
    issue.recommendedAction,
    issue.whyItMatters,
    issue.sourceSystem,
    issue.sourceTable,
    issue.sourceId,
    issue.primaryEntityType,
    issue.primaryEntityId,
    issue.targetLabel,
    primaryLabel,
    secondaryLabel,
    qboDoc,
    qboId,
    qboCustomer,
    orderNumber,
    purchaseReference,
    customerName,
    customerEmail,
    sku,
    productName,
    productMpn,
    listingTitle,
    externalListingId,
    channel,
    commandType,
    postingAction,
    lastError,
    duplicateOrders,
    duplicateDocs,
    duplicateExternalIds,
    ...evidenceChips,
    ...traceItems.flatMap((item) => [item.label, item.value]),
  ].forEach((value) => pushUnique(searchableValues, value));

  return {
    primaryLabel,
    secondaryLabel,
    evidenceChips: evidenceChips.slice(0, 8),
    traceItems,
    searchableValues,
    navigationRoute: productRouteFromIssue(issue, productMpn, sku),
  };
}

export function getIssueNavigationRoute(issue: OperationsIssueSummary): string | null {
  return getIssueDisplayInfo(issue).navigationRoute;
}

export function summarizeIssueEvidence(issue: OperationsIssueSummary): string[] {
  return getIssueDisplayInfo(issue).evidenceChips;
}
