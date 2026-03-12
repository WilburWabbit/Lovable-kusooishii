

## Split Settings into Standalone Admin Pages

Currently the Settings page bundles six panels together. We'll extract three groups into their own routed pages with sidebar entries under the Admin section.

### New Pages

| Route | Page | Content |
|-------|------|---------|
| `/admin/settings/integrations` | `IntegrationsSettingsPage.tsx` | QBO + eBay + BrickEconomy panels |
| `/admin/settings/selling-fees` | `SellingFeesSettingsPage.tsx` | SellingCostDefaults + ChannelFees panels |
| `/admin/settings/shipping-rates` | `ShippingRatesSettingsPage.tsx` (wrapped) | ShippingRates panel |

Each page wraps in `BackOfficeLayout` with an appropriate title, same pattern as existing settings sub-pages.

### Changes

| File | Change |
|------|--------|
| `src/pages/admin/IntegrationsSettingsPage.tsx` | New — renders QBO, eBay, BrickEconomy panels |
| `src/pages/admin/SellingFeesSettingsPage.tsx` | New — renders SellingCostDefaults + ChannelFees panels |
| `src/pages/admin/ShippingRatesSettingsPage.tsx` | New wrapper page (existing panel component stays) |
| `src/pages/admin/SettingsPageFull.tsx` | Remove the six panels, keep as a hub/landing or redirect |
| `src/components/BackOfficeSidebar.tsx` | Add 3 new items to `settingsItems`: Integrations (`Plug`), Selling Fees (`Receipt`), Shipping Rates (`Truck`) |
| `src/App.tsx` | Add 3 new routes under `/admin/settings/*` |

### Sidebar Admin Section (after)

```text
Settings          (landing/hub)
Integrations      (QBO, eBay, BrickEconomy)
Selling Fees      (defaults + channel fees)
Shipping Rates    (rate table)
Users
VAT Rates
```

