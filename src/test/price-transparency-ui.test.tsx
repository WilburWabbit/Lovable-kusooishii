// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContributorTable, PriceContributionBar } from "@/components/admin-v2/PricingTransparencyTab";

describe("price transparency UI", () => {
  it("renders an accessible contributor bar for floor pricing evidence", () => {
    render(
      <PriceContributionBar
        contributors={[
          { key: "pooled_carrying_value", label: "Pooled carrying value", amount: 24.5, kind: "cost" },
          { key: "channel_fees", label: "Channel and payment fees", amount: 4.1, kind: "cost" },
          { key: "minimum_profit", label: "Minimum profit", amount: 1, kind: "profit" },
          { key: "output_vat_payable", label: "Output VAT payable", amount: 5.2, kind: "vat" },
        ]}
      />,
    );

    expect(screen.getByLabelText("Price contribution bar")).toBeTruthy();
    const pooled = screen.getByTitle("Pooled carrying value: £24.50");
    const fees = screen.getByTitle("Channel and payment fees: £4.10");
    const profit = screen.getByTitle("Minimum profit: £1.00");
    const outputVat = screen.getByTitle("Output VAT payable: £5.20");

    expect(pooled).toBeTruthy();
    expect(profit).toBeTruthy();
    expect(outputVat).toBeTruthy();
    expect(pooled.getAttribute("style")).not.toEqual(fees.getAttribute("style"));
    expect(fees.getAttribute("style")).not.toEqual(profit.getAttribute("style"));
    expect(profit.getAttribute("style")).not.toEqual(outputVat.getAttribute("style"));
  });

  it("renders a stable empty state when no contributors exist", () => {
    render(<PriceContributionBar contributors={[]} />);

    expect(screen.getByLabelText("No price contributors")).toBeTruthy();
  });

  it("shows matching color keys beside contributor values", () => {
    render(
      <ContributorTable
        contributors={[
          { key: "pooled_carrying_value", label: "Pooled carrying value", amount: 24.5, kind: "cost" },
          { key: "brickeconomy_rrp", label: "BrickEconomy RRP", amount: 44.99, kind: "market" },
          { key: "condition_adjusted_rrp", label: "Condition-adjusted RRP", amount: 35.99, kind: "market" },
          { key: "market_weighted_rrp_undercut", label: "Market-weighted RRP undercut", amount: -2.5, kind: "rule" },
          { key: "channel_fee_input_vat_reclaim", label: "Fee VAT reclaim", amount: -0.51, kind: "vat" },
        ]}
      />,
    );

    expect(screen.getByLabelText("Color key for Pooled carrying value")).toBeTruthy();
    expect(screen.getByLabelText("Color key for BrickEconomy RRP")).toBeTruthy();
    expect(screen.getByLabelText("Color key for Condition-adjusted RRP")).toBeTruthy();
    expect(screen.getByLabelText("Color key for Market-weighted RRP undercut")).toBeTruthy();
    expect(screen.getByLabelText("Color key for Fee VAT reclaim")).toBeTruthy();
  });
});
