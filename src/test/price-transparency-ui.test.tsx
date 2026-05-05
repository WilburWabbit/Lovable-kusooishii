// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PriceContributionBar } from "@/components/admin-v2/PricingTransparencyTab";

describe("price transparency UI", () => {
  it("renders an accessible contributor bar for floor pricing evidence", () => {
    render(
      <PriceContributionBar
        contributors={[
          { key: "pooled_carrying_value", label: "Pooled carrying value", amount: 24.5, kind: "cost" },
          { key: "channel_fees", label: "Channel and payment fees", amount: 4.1, kind: "cost" },
          { key: "minimum_profit", label: "Minimum profit", amount: 1, kind: "profit" },
        ]}
      />,
    );

    expect(screen.getByLabelText("Price contribution bar")).toBeTruthy();
    expect(screen.getByTitle("Pooled carrying value: £24.50")).toBeTruthy();
    expect(screen.getByTitle("Minimum profit: £1.00")).toBeTruthy();
  });

  it("renders a stable empty state when no contributors exist", () => {
    render(<PriceContributionBar contributors={[]} />);

    expect(screen.getByLabelText("No price contributors")).toBeTruthy();
  });
});
