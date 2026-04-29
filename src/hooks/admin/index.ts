// Admin V2 hooks — barrel export
export {
  usePurchaseBatches,
  usePurchaseBatch,
  useCreatePurchaseBatch,
  purchaseBatchKeys,
} from './use-purchase-batches';

export {
  useStockUnit,
  useStockUnitsByVariant,
  useGradeStockUnit,
  useBulkGradeStockUnits,
  stockUnitKeys,
} from './use-stock-units';

export {
  useProducts,
  useProduct,
  useUpdateProductCopy,
  useUpdateConditionNotes,
  useUploadProductImage,
  productKeys,
} from './use-products';

export {
  useChannelListings,
  usePublishListing,
  useBatchPublishListings,
  channelListingKeys,
} from './use-channel-listings';

export {
  useOrders,
  useOrder,
  useAllocateOrderItems,
  useAllocateOrderLineByUnit,
  useCandidateUnitsForLine,
  orderKeys,
} from './use-orders';

export type { CandidateUnit } from './use-orders';

export {
  usePayouts,
  usePayoutSummary,
  payoutKeys,
} from './use-payouts';

export type { PayoutSummary } from './use-payouts';

export {
  useCustomers,
  useCustomer,
  useCustomerOrders,
  customerKeys,
} from './use-customers';

export type { CustomerOrderSummary } from './use-customers';
