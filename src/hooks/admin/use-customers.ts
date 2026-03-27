// ============================================================
// Admin V2 — Customer Hooks
// Covers: useCustomers, useCustomer
// ============================================================

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { CustomerRow, Customer } from '@/lib/types/admin';

// ─── Query Keys ─────────────────────────────────────────────

export const customerKeys = {
  all: ['v2', 'customers'] as const,
  detail: (customerId: string) => ['v2', 'customers', customerId] as const,
};

// ─── Row → Interface Mapper ─────────────────────────────────

function mapCustomerRow(
  row: Record<string, unknown>,
  orderCount: number,
  totalSpend: number,
): CustomerRow {
  return {
    id: row.id as string,
    name: (row.display_name as string) ?? '',
    firstName: (row.first_name as string) ?? null,
    lastName: (row.last_name as string) ?? null,
    email: (row.email as string) ?? '',
    channelIds: (row.channel_ids as Record<string, string>) ?? {},
    qboCustomerId: (row.qbo_customer_id as string) ?? null,
    blueBellMember: (row.blue_bell_member as boolean) ?? false,
    createdAt: row.created_at as string,
    phone: (row.phone as string) ?? null,
    mobile: (row.mobile as string) ?? null,
    notes: (row.notes as string) ?? null,
    active: (row.active as boolean) ?? true,
    billingLine1: (row.billing_line_1 as string) ?? null,
    billingLine2: (row.billing_line_2 as string) ?? null,
    billingCity: (row.billing_city as string) ?? null,
    billingCounty: (row.billing_county as string) ?? null,
    billingPostcode: (row.billing_postcode as string) ?? null,
    billingCountry: (row.billing_country as string) ?? null,
    orderCount,
    totalSpend,
  };
}

// ─── useCustomers ───────────────────────────────────────────

export function useCustomers() {
  return useQuery({
    queryKey: customerKeys.all,
    queryFn: async (): Promise<CustomerRow[]> => {
      // Fetch all customers
      const { data: customerRows, error: custErr } = await supabase
        .from('customer')
        .select('*')
        .order('created_at', { ascending: false });

      if (custErr) throw custErr;

      // Fetch order counts and totals per customer
      const { data: orderStats, error: orderErr } = await supabase
        .from('sales_order')
        .select('customer_id, gross_total');

      if (orderErr) throw orderErr;

      // Aggregate order stats by customer_id
      const statsMap = new Map<string, { count: number; total: number }>();
      for (const row of (orderStats ?? []) as Record<string, unknown>[]) {
        const cid = row.customer_id as string;
        if (!cid) continue;
        const existing = statsMap.get(cid) ?? { count: 0, total: 0 };
        existing.count += 1;
        existing.total += (row.gross_total as number) ?? 0;
        statsMap.set(cid, existing);
      }

      return ((customerRows ?? []) as Record<string, unknown>[]).map((row) => {
        const stats = statsMap.get(row.id as string) ?? { count: 0, total: 0 };
        return mapCustomerRow(row, stats.count, stats.total);
      });
    },
  });
}

// ─── useCustomer ────────────────────────────────────────────

export function useCustomer(customerId: string | undefined) {
  return useQuery({
    queryKey: customerKeys.detail(customerId ?? ''),
    enabled: !!customerId,
    queryFn: async (): Promise<CustomerRow> => {
      const { data, error } = await supabase
        .from('customer')
        .select('*')
        .eq('id', customerId!)
        .single();

      if (error) throw error;
      const row = data as Record<string, unknown>;

      // Get order stats for this customer
      const { data: orders } = await supabase
        .from('sales_order')
        .select('gross_total')
        .eq('customer_id', customerId!);

      let orderCount = 0;
      let totalSpend = 0;
      for (const o of (orders ?? []) as Record<string, unknown>[]) {
        orderCount += 1;
        totalSpend += (o.gross_total as number) ?? 0;
      }

      return mapCustomerRow(row, orderCount, totalSpend);
    },
  });
}

// ─── useCustomerOrders ──────────────────────────────────────

export interface CustomerOrderSummary {
  id: string;
  orderNumber: string;
  channel: string;
  status: string;
  total: number;
  itemCount: number;
  createdAt: string;
}

export function useCustomerOrders(customerId: string | undefined) {
  return useQuery({
    queryKey: ['v2', 'customer-orders', customerId ?? ''] as const,
    enabled: !!customerId,
    queryFn: async (): Promise<CustomerOrderSummary[]> => {
      const { data, error } = await supabase
        .from('sales_order')
        .select(`
          id, order_number, origin_channel, v2_status, gross_total, created_at,
          sales_order_line(id)
        `)
        .eq('customer_id', customerId!)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: row.id as string,
        orderNumber: row.order_number as string,
        channel: (row.origin_channel as string) ?? 'website',
        status: (row.v2_status as string) ?? 'new',
        total: (row.gross_total as number) ?? 0,
        itemCount: ((row.sales_order_line as unknown[]) ?? []).length,
        createdAt: row.created_at as string,
      }));
    },
  });
}
