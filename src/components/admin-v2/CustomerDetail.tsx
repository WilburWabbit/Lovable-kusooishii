import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCustomer, useCustomerOrders, customerKeys } from "@/hooks/admin/use-customers";
import type { CustomerOrderSummary } from "@/hooks/admin/use-customers";
import type { CustomerRow } from "@/lib/types/admin";
import { SurfaceCard, Mono, Badge, BackButton, SectionHead, OrderStatusBadge } from "./ui-primitives";
import type { OrderStatus } from "@/lib/types/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { WelcomeQrLabel } from "./WelcomeQrLabel";
import { Gift, Tag } from "lucide-react";

type WelcomeCodeRow = Record<string, unknown>;

async function queueAndProcessCustomerPosting(customerId: string, payload: Record<string, unknown>) {
  const { data: intentId, error: queueError } = await supabase.rpc(
    "queue_qbo_customer_posting_intent" as never,
    {
      p_customer_id: customerId,
      p_payload: payload,
    } as never,
  );
  if (queueError) throw queueError;

  const { data, error } = await supabase.functions.invoke("accounting-posting-intents-process", {
    body: intentId ? { intentId } : { batch_size: 5 },
  });
  if (error) throw error;

  return data as Record<string, unknown> | null;
}

export function CustomerDetail() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: customer, isLoading } = useCustomer(customerId);
  const { data: orders = [], isLoading: ordersLoading } = useCustomerOrders(customerId);

  // Fetch welcome codes for this customer
  const { data: welcomeCodes = [] } = useQuery({
    queryKey: ["welcome-codes", "customer", customerId],
    queryFn: async () => {
      if (!customerId) return [];
      const { data } = await supabase
        .from("welcome_code" as never)
        .select("*")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      return (data || []) as WelcomeCodeRow[];
    },
    enabled: !!customerId,
  });

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<CustomerRow>>({});

  const startEdit = () => {
    if (!customer) return;
    setForm({
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
      mobile: customer.mobile,
      billingLine1: customer.billingLine1,
      billingLine2: customer.billingLine2,
      billingCity: customer.billingCity,
      billingCounty: customer.billingCounty,
      billingPostcode: customer.billingPostcode,
      billingCountry: customer.billingCountry,
      notes: customer.notes,
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setForm({});
  };

  const saveAndSync = async () => {
    if (!customer || !customerId) return;
    setSaving(true);
    try {
      // 1. Save locally first
      const { error: updateErr } = await supabase
        .from("customer")
        .update({
          first_name: form.firstName ?? null,
          last_name: form.lastName ?? null,
          display_name: [form.firstName, form.lastName].filter(Boolean).join(" ") || customer.name,
          email: form.email ?? null,
          phone: form.phone ?? null,
          mobile: form.mobile ?? null,
          billing_line_1: form.billingLine1 ?? null,
          billing_line_2: form.billingLine2 ?? null,
          billing_city: form.billingCity ?? null,
          billing_county: form.billingCounty ?? null,
          billing_postcode: form.billingPostcode ?? null,
          billing_country: form.billingCountry ?? null,
          notes: form.notes ?? null,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", customerId);

      if (updateErr) throw updateErr;

      // 2. Push to QBO if connected
      if (customer.qboCustomerId) {
        try {
          const data = await queueAndProcessCustomerPosting(customerId, {
            customer_id: customerId,
            first_name: form.firstName,
            last_name: form.lastName,
            email: form.email,
            phone: form.phone,
            mobile: form.mobile,
            billing_address: {
              line_1: form.billingLine1,
              line_2: form.billingLine2,
              city: form.billingCity,
              county: form.billingCounty,
              postcode: form.billingPostcode,
              country: form.billingCountry || "GB",
            },
          });

          if (data?.success === false) {
            toast.warning("Saved locally. QBO posting queued with an issue");
          } else {
            toast.success("Saved & queued to QBO");
          }
        } catch (err) {
          console.error("QBO customer posting error:", err);
          toast.warning("Saved locally but QBO posting failed");
        }
      } else {
        toast.success("Saved locally (no QBO link)");
      }

      setEditing(false);
      queryClient.invalidateQueries({ queryKey: customerKeys.detail(customerId) });
    } catch (err) {
      toast.error("Save failed: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading customer…</p>;
  }

  if (!customer) {
    return <p className="text-muted-foreground text-sm">Customer not found.</p>;
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const address = [
    customer.billingLine1,
    customer.billingLine2,
    customer.billingCity,
    customer.billingCounty,
    customer.billingPostcode,
    customer.billingCountry,
  ]
    .filter(Boolean)
    .join(", ");

  const channelEntries = Object.entries(customer.channelIds);

  const field = (key: keyof typeof form) => ({
    value: (form[key] as string) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value || null })),
  });

  return (
    <div>
      <BackButton onClick={() => navigate("/admin/customers")} label="Customers" />

      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-[22px] font-bold text-foreground">{customer.name}</h1>
        {customer.blueBellMember && <Badge label="Blue Bell" color="#3B82F6" small />}
        {!customer.active && <Badge label="Inactive" color="#71717A" small />}
      </div>
      <p className="text-muted-foreground text-[13px] mb-5">
        {customer.orderCount} orders · £{customer.totalSpend.toFixed(2)} total spend · Customer since {formatDate(customer.firstOrderAt ?? customer.createdAt)}
      </p>

      {/* Edit / Save buttons */}
      <div className="flex gap-2 mb-3">
        {!editing ? (
          <Button variant="outline" size="sm" onClick={startEdit}>
            Edit
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={saveAndSync} disabled={saving}>
              {saving ? "Saving…" : customer.qboCustomerId ? "Save & Sync to QBO" : "Save"}
            </Button>
            <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
              Cancel
            </Button>
          </>
        )}
      </div>

      {/* Info grid */}
      <SurfaceCard className="mb-5">
        {editing ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <EditField label="First Name" {...field("firstName")} />
            <EditField label="Last Name" {...field("lastName")} />
            <EditField label="Email" {...field("email")} />
            <EditField label="Phone" {...field("phone")} />
            <EditField label="Mobile" {...field("mobile")} />
            <EditField label="Address Line 1" {...field("billingLine1")} />
            <EditField label="Address Line 2" {...field("billingLine2")} />
            <EditField label="City" {...field("billingCity")} />
            <EditField label="County" {...field("billingCounty")} />
            <EditField label="Postcode" {...field("billingPostcode")} />
            <EditField label="Country" {...field("billingCountry")} />
            <div className="col-span-full">
              <EditField label="Notes" {...field("notes")} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <InfoField label="First Name" value={customer.firstName ?? "—"} />
            <InfoField label="Last Name" value={customer.lastName ?? "—"} />
            <InfoField label="Email" value={customer.email || "—"} />
            <InfoField label="Phone" value={customer.phone ?? "—"} />
            <InfoField label="Mobile" value={customer.mobile ?? "—"} />
            <InfoField label="Address" value={address || "—"} />
            <InfoField
              label="Channels"
              value={
                channelEntries.length > 0
                  ? channelEntries.map(([ch, id]) => `${ch}: ${id}`).join(", ")
                  : "—"
              }
            />
            <InfoField label="QBO Customer ID" value={customer.qboCustomerId ?? "—"} mono />
            {customer.notes && (
              <div className="col-span-full">
                <InfoField label="Notes" value={customer.notes} />
              </div>
            )}
          </div>
        )}
      </SurfaceCard>

      {/* Orders section */}
      <SectionHead>Orders</SectionHead>
      <SurfaceCard noPadding className="overflow-x-auto mt-2">
        {ordersLoading ? (
          <p className="text-muted-foreground text-sm p-4">Loading orders…</p>
        ) : orders.length === 0 ? (
          <p className="text-muted-foreground text-sm p-4">No orders for this customer.</p>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border">
                {["Order", "Channel", "Items", "Total", "Status", "Date"].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-left text-muted-foreground font-medium text-[10px] uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <CustomerOrderRow
                  key={o.id}
                  order={o}
                  onClick={() => navigate(`/admin/orders/${o.id}`)}
                />
              ))}
            </tbody>
          </table>
        )}
      </SurfaceCard>

      {/* Member Benefits */}
      <div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 space-y-2">
        <h3 className="text-sm font-semibold text-amber-500 flex items-center gap-1.5">
          <Gift className="h-3.5 w-3.5" />
          Member Benefits
        </h3>
        <div className="text-xs text-muted-foreground space-y-1">
          {customer.blueBellMember && (
            <p>✓ Blue Bell LEGO Club — 5% collection discount</p>
          )}
          {welcomeCodes.some(wc => !wc.redeemed_at) && (
            <p>✓ eBay Welcome — 5% first-order promo (unredeemed)</p>
          )}
          {welcomeCodes.length > 0 && welcomeCodes.every(wc => wc.redeemed_at) && (
            <p>✓ eBay Welcome — redeemed</p>
          )}
          <p>✓ Wishlist & restock alerts</p>
          <p>✓ Kuso Grade condition transparency</p>
          <p>✓ Order tracking & history</p>
        </div>
      </div>

      {/* Promotions */}
      <div className="mt-5">
        <SectionHead>
          <span className="flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5" />
            Promotions
          </span>
        </SectionHead>
        <div className="mt-2 space-y-2">
          {welcomeCodes.length > 0 ? (
            welcomeCodes.map((wc) => (
              <SurfaceCard key={wc.id} className="flex items-center justify-between">
                <div>
                  <Mono color="amber" className="text-sm font-semibold">{wc.promo_code}</Mono>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {wc.discount_pct}% off · Created{" "}
                    {new Date(wc.created_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {wc.scanned_at && ` · Scanned ${wc.scan_count}×`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {wc.redeemed_at ? (
                    <Badge
                      label={`Redeemed ${new Date(wc.redeemed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                      color="#22C55E"
                      small
                    />
                  ) : (
                    <>
                      <Badge label="Active" color="#F59E0B" small />
                      <WelcomeQrLabel
                        code={wc.code}
                        promoCode={wc.promo_code || ""}
                        ebayOrderId={wc.ebay_order_id}
                        primarySku={wc.primary_sku ?? undefined}
                        postcode={wc.order_postcode ?? undefined}
                        buyerName={wc.buyer_name ?? undefined}
                        compact
                      />
                    </>
                  )}
                </div>
              </SurfaceCard>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No promotions issued.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function InfoField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
        {label}
      </div>
      {mono ? (
        <Mono color="dim" className="text-sm">{value}</Mono>
      ) : (
        <div className="text-foreground text-sm">{value}</div>
      )}
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
        {label}
      </div>
      <Input value={value} onChange={onChange} className="h-8 text-sm" />
    </div>
  );
}

function CustomerOrderRow({
  order,
  onClick,
}: {
  order: CustomerOrderSummary;
  onClick: () => void;
}) {
  const formattedDate = new Date(order.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <tr
      onClick={onClick}
      className="border-b border-border cursor-pointer hover:bg-muted/50 transition-colors"
    >
      <td className="px-3 py-2.5">
        <Mono color="amber">{order.orderNumber}</Mono>
      </td>
      <td className="px-3 py-2.5 text-muted-foreground">{order.channel}</td>
      <td className="px-3 py-2.5 text-muted-foreground">{order.itemCount}</td>
      <td className="px-3 py-2.5">
        <Mono color="teal">£{order.total.toFixed(2)}</Mono>
      </td>
      <td className="px-3 py-2.5">
        <OrderStatusBadge status={order.status as OrderStatus} />
      </td>
      <td className="px-3 py-2.5 text-muted-foreground">{formattedDate}</td>
    </tr>
  );
}
