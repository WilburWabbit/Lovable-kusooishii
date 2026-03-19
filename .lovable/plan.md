

## Plan: Fix email logo URLs and deploy

### Status of email logo URLs
The last diff shows all 6 templates already have the correct image URL (`https://www.kusooishii.com/lovable-uploads/bd7eeb10-aa45-4885-9059-16107ecc9a19.png`). No template changes needed.

### Build errors blocking deployment
Two unrelated TypeScript errors in `ebay-process-order/index.ts` and `stripe-webhook/index.ts` must be fixed before the `auth-email-hook` function can deploy. Both have the same root cause: Supabase's `.select()` with a foreign-key join (`vat_rate:sales_tax_rate_id(...)`) infers `vat_rate` as an array type, but the code accesses it as an object.

### Fix 1: `ebay-process-order/index.ts` (lines 700-711)
Cast `ukStandard.vat_rate` to a single object after the null guard:
```typescript
const vatRate = ukStandard.vat_rate as any;
vatResolution = {
  destination: "uk",
  taxCodeId: ukStandard.id,
  vatRateId: vatRate.id,
  qboTaxCodeId: ukStandard.qbo_tax_code_id,
  qboTaxRateId: vatRate.qbo_tax_rate_id,
  ratePercent: Number(vatRate.rate_percent),
};
```

### Fix 2: `stripe-webhook/index.ts` (lines 250-260)
Same pattern:
```typescript
const vatRate = ukStandard.vat_rate as any;
vatResolution = {
  destination: "uk",
  taxCodeId: ukStandard.id,
  vatRateId: vatRate.id,
  qboTaxCodeId: ukStandard.qbo_tax_code_id,
  ratePercent: Number(vatRate.rate_percent),
};
```

### Step 3: Deploy `auth-email-hook`
Redeploy the auth-email-hook function so the updated logo URLs go live.

