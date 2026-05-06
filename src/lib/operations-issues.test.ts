import { describe, expect, it } from "vitest";
import {
  getIssueActionGroupLabel,
  getIssueActionLabel,
  getIssueDisplayInfo,
  getIssueNavigationRoute,
  groupIssuesByAction,
  humanizeToken,
  requiresIssueNote,
  summarizeIssueEvidence,
  type OperationsIssueSummary,
} from "./operations-issues";

describe("operations issue helpers", () => {
  it("groups issues by their primary action", () => {
    const groups = groupIssuesByAction([
      { id: "one", primaryAction: "queue_qbo_posting" },
      { id: "two", primaryAction: "allocate_stock" },
      { id: "three", primaryAction: "queue_qbo_posting" },
    ]);

    expect(groups).toEqual([
      { action: "queue_qbo_posting", issues: [{ id: "one", primaryAction: "queue_qbo_posting" }, { id: "three", primaryAction: "queue_qbo_posting" }] },
      { action: "allocate_stock", issues: [{ id: "two", primaryAction: "allocate_stock" }] },
    ]);
  });

  it("falls back to readable labels for new issue actions", () => {
    expect(getIssueActionLabel("queue_qbo_posting")).toBe("Queue QBO post");
    expect(getIssueActionGroupLabel("custom_future_action")).toBe("Custom Future Action Issues");
    expect(humanizeToken("qbo_purchase_missing_app")).toBe("Qbo Purchase Missing App");
  });

  it("requires notes only for human closure actions", () => {
    expect(requiresIssueNote("dismiss")).toBe(true);
    expect(requiresIssueNote("suppress")).toBe(true);
    expect(requiresIssueNote("queue_qbo_posting")).toBe(false);
  });

  it("summarizes evidence with business-facing chips first", () => {
    const issue: OperationsIssueSummary = {
      id: "issue-1",
      domain: "transactions",
      issueType: "app_sales_receipt_missing_qbo",
      severity: "high",
      primaryAction: "queue_qbo_posting",
      primaryReference: "SO-100",
      secondaryReference: "EBAY-9",
      title: "Missing QBO receipt",
      whyItMatters: "Posting is blocked.",
      recommendedAction: "Queue posting.",
      sourceSystem: "app",
      sourceTable: "sales_order",
      sourceId: "order-uuid",
      primaryEntityType: "sales_order",
      primaryEntityId: "order-uuid",
      amountExpected: 42,
      evidence: {
        app: {
          sales_order_id: "order-uuid",
          order_number: "SO-100",
          origin_channel: "ebay",
          origin_reference: "EBAY-9",
          gross_total: 42,
        },
        qbo: null,
        internal_note: "hidden",
      },
    };

    expect(summarizeIssueEvidence(issue)).toEqual(["App", "Expected £42.00"]);
    expect(getIssueDisplayInfo(issue).primaryLabel).toBe("Order SO-100");
    expect(getIssueDisplayInfo(issue).traceItems.map((item) => item.label)).toContain("App Order");
  });

  it("prioritizes QBO document details over landing ids", () => {
    const issue: OperationsIssueSummary = {
      id: "qbo_sales_receipt:missing_app:landing-uuid",
      domain: "transactions",
      issueType: "qbo_sales_receipt_missing_app",
      severity: "high",
      primaryAction: "review_qbo_landing",
      primaryReference: "2230",
      secondaryReference: "987",
      title: "QBO sales receipt is not linked to an app sale",
      whyItMatters: "Missing app match.",
      recommendedAction: "Review QBO landing.",
      sourceSystem: "qbo",
      sourceTable: "landing_raw_qbo_sales_receipt",
      sourceId: "landing-uuid",
      evidence: {
        qbo: {
          landing_id: "landing-uuid",
          external_id: "987",
          doc_number: "2230",
          total_amount: "88.00",
          txn_date: "2026-05-05",
          customer_ref: "Customer 1",
        },
      },
    };

    const display = getIssueDisplayInfo(issue);

    expect(display.primaryLabel).toBe("QBO sales receipt 2230");
    expect(display.secondaryLabel).toContain("£88.00");
    expect(display.traceItems.map((item) => item.label)).toEqual(
      expect.arrayContaining(["QBO Doc", "QBO ID", "QBO Landing"]),
    );
  });

  it("repairs product navigation when the view has a product UUID route but the evidence has an MPN", () => {
    const issue: OperationsIssueSummary = {
      id: "channel_listing:out_of_stock:listing-uuid",
      domain: "inventory",
      issueType: "listed_sku_out_of_stock",
      severity: "high",
      primaryAction: "pause_listing",
      primaryReference: "10349-1.1",
      secondaryReference: "206005702262",
      title: "Out-of-stock SKU is listed for sale",
      whyItMatters: "No stock exists.",
      recommendedAction: "Pause listing.",
      sourceSystem: "channel",
      sourceTable: "channel_listing",
      sourceId: "listing-uuid",
      primaryEntityType: "channel_listing",
      primaryEntityId: "listing-uuid",
      targetRoute: "/admin/products/2db3d528-42a1-4cfd-94e9-01b6a8b1d111",
      evidence: {
        listing: {
          channel_listing_id: "listing-uuid",
          channel: "ebay",
          external_sku: "10349-1.1",
          external_listing_id: "206005702262",
          listed_quantity: 1,
        },
        inventory: { available_quantity: 0 },
      },
    };

    expect(getIssueNavigationRoute(issue)).toBe("/admin/products/10349-1");
  });
});
