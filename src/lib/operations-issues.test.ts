import { describe, expect, it } from "vitest";
import {
  getIssueActionGroupLabel,
  getIssueActionLabel,
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
});
