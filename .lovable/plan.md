

## Fix: eBay "Create Listing" — Location Not Found

### Root Cause

The eBay API error is:
```
"A user error has occurred. Location information not found."
```

The `create_listing` action sends `merchantLocationKey: "default"` in the offer body (line 654), but no inventory location has been created on the eBay account. The eBay Inventory API requires a registered merchant location before any offer can be created.

### Fix

Add automatic location provisioning to the `create_listing` flow. Before creating the offer, check if the `default` location exists. If not, create it using `PUT /sell/inventory/v1/location/default`.

#### Changes to `supabase/functions/ebay-sync/index.ts`

Insert a location-ensure step between Step 1 (inventory item) and Step 2 (offer):

```
// Step 1.5: Ensure merchant location exists
try {
  await ebayFetch(accessToken, `/sell/inventory/v1/location/default`);
} catch {
  // Location doesn't exist — create it
  await ebayFetch(accessToken, `/sell/inventory/v1/location/default`, {
    method: "POST",
    body: JSON.stringify({
      location: {
        address: {
          city: "London",
          country: "GB",
          postalCode: "SW1A 1AA",
        },
      },
      locationTypes: ["WAREHOUSE"],
      name: "Default Location",
      merchantLocationStatus: "ENABLED",
    }),
  });
}
```

Also add a new `configure-location` action in ebay-sync so the admin can set a real address for the location via settings if desired. This keeps the listing flow unblocked while allowing customization later.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/ebay-sync/index.ts` | Add location auto-provisioning before offer creation; add `configure-location` action |

