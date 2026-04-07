

# External References as Primary Identifiers Across Admin UI

## Problem

Internal identifiers (`KO-NNNNNNN`, `PO-NNN`) are shown prominently while external references are hidden. The app is an integration hub — users need to see the identifiers that match eBay and QBO.

**Key data insight**: Cash/in-person sales have a QBO-generated `doc_number` (e.g., `14-14455-15044`) returned by the API — these should be used as their primary reference, not just for eBay orders.

## What changes

### 1. Types and hooks — map `docNumber`

**`src/lib/types/admin.ts`** — Add `docNumber: string | null` to `Order` interface.

**`src/hooks/admin/use-orders.ts`** — Map `doc_number` → `docNumber` in `mapOrder`.

### 2. Order List — external ref as primary column

**`src/components/admin-v2/OrderList.tsx`**

- Rename "Order" column to "Ref" and show the best external reference as the primary value:
  - **eBay orders**: Show `externalOrderId` (eBay order number, e.g., `14-14455-15038`)
  - **Cash/in-person/web sales**: Show `docNumber` (QBO receipt number, e.g., `14-14455-15044`)
  - Every order will have at least a `docNumber` since all orders come through QBO
- Move the internal `orderNumber` column to `defaultVisible: false`, renamed "Internal ID"
- Remove the separate "External ID" column (its value is now in the primary column)
- Search filtering includes `externalOrderId`, `docNumber`, and `orderNumber`

### 3. Order Detail — external ref as heading

**`src/components/admin-v2/OrderDetail.tsx`**

- Change heading to show the best external reference (eBay ID or DocNumber) as the primary title
- Show `order.orderNumber` (KO-) as small secondary text
- Add reference badges for **Channel Ref** and **QBO Doc** when both exist and differ

### 4. Purchase List — QBO reference as primary identifier

**`src/components/admin-v2/PurchaseList.tsx`**

- In BatchCard, show the QBO `reference` (e.g., `814`) as the primary identifier
- Show `PO-NNN` as secondary/smaller text

### 5. Payout linked orders — use external refs

**`src/components/admin-v2/PayoutView.tsx`**

- In the linked orders table, show external order ID / doc number as the primary identifier

## Files changed

| File | Change |
|------|--------|
| `src/lib/types/admin.ts` | Add `docNumber` to `Order` |
| `src/hooks/admin/use-orders.ts` | Map `doc_number` in `mapOrder` |
| `src/components/admin-v2/OrderList.tsx` | External ref as primary "Ref" column, internal ID hidden |
| `src/components/admin-v2/OrderDetail.tsx` | External ref as heading, internal ID secondary |
| `src/components/admin-v2/PurchaseList.tsx` | QBO reference as primary in BatchCard |
| `src/components/admin-v2/PayoutView.tsx` | External ref in linked orders table |

