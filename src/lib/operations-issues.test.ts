import { describe, expect, it } from "vitest";
import {
  getIssueActionGroupLabel,
  getIssueActionLabel,
  getIssueNavigationRoute,
  getIssueProductMpn,
  groupIssuesByAction,
  humanizeToken,
  isIssueNavigationAction,
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

  it("navigates for record-fix actions that are not server-side closures", () => {
    expect(isIssueNavigationAction("pause_listing")).toBe(true);
    expect(isIssueNavigationAction("retry_integration")).toBe(true);
    expect(isIssueNavigationAction("sync_listing_quantity")).toBe(true);
  });

  it("summarizes evidence without exposing raw JSON first", () => {
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
      evidence: { app: { id: "order" }, qbo: null, internal_note: "hidden" },
    };

    expect(summarizeIssueEvidence(issue)).toEqual(["SO-100", "EBAY-9", "App", "Internal Note"]);
  });

  it("repairs product UUID issue routes when the SKU gives the MPN", () => {
    const issue: OperationsIssueSummary = {
      id: "issue-2",
      domain: "inventory",
      issueType: "listed_sku_out_of_stock",
      severity: "high",
      primaryAction: "pause_listing",
      primaryReference: "10349-1.1",
      secondaryReference: null,
      title: "Out-of-stock SKU is listed for sale",
      whyItMatters: "Listing quantity is wrong.",
      recommendedAction: "Review stock.",
      evidence: {},
      targetRoute: "/admin/products/3378a20e-4047-4b6a-821e-defe166cc4ab",
    };

    expect(getIssueProductMpn(issue)).toBe("10349-1");
    expect(getIssueNavigationRoute(issue)).toBe("/admin/products/10349-1");
  });

  it("prefers product evidence for repaired product routes", () => {
    const issue: OperationsIssueSummary = {
      id: "issue-3",
      domain: "integrations",
      issueType: "outbox_failed_after_retries",
      severity: "medium",
      primaryAction: "retry_integration",
      primaryReference: "channel-command",
      secondaryReference: null,
      title: "Channel command failed",
      whyItMatters: "Sync is blocked.",
      recommendedAction: "Retry after fixing data.",
      evidence: { product: { mpn: "40775-1", sku_code: "10349-1.1" } },
      targetRoute: "/admin/products/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    };

    expect(getIssueProductMpn(issue)).toBe("40775-1");
    expect(getIssueNavigationRoute(issue)).toBe("/admin/products/40775-1");
  });
});
