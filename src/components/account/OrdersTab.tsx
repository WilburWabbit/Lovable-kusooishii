import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

interface Order {
  id: string;
  order_number: string;
  origin_channel: string;
  status: string;
  gross_total: number;
  currency: string;
  txn_date: string | null;
  created_at: string;
}

interface OrdersTabProps {
  userId: string;
  userEmail: string;
}

const channelLabel: Record<string, string> = {
  web: "Website",
  qbo: "In-Store",
  qbo_refund: "Refund",
  ebay: "eBay",
};

const channelVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  web: "default",
  qbo: "secondary",
  qbo_refund: "destructive",
  ebay: "outline",
};

const statusLabel: Record<string, string> = {
  pending_payment: "Pending Payment",
  authorised: "Authorised",
  paid: "Paid",
  picking: "Picking",
  packed: "Packed",
  awaiting_dispatch: "Awaiting Dispatch",
  shipped: "Shipped",
  complete: "Complete",
  cancelled: "Cancelled",
  partially_refunded: "Partially Refunded",
  refunded: "Refunded",
  exception: "Exception",
};

export default function OrdersTab({ userId, userEmail }: OrdersTabProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrders = async () => {
      // Fetch orders matching user_id OR guest_email
      const { data: byUserId } = await supabase
        .from("sales_order")
        .select("id, order_number, origin_channel, status, gross_total, currency, txn_date, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      const { data: byEmail } = await supabase
        .from("sales_order")
        .select("id, order_number, origin_channel, status, gross_total, currency, txn_date, created_at")
        .eq("guest_email", userEmail)
        .is("user_id", null)
        .order("created_at", { ascending: false });

      // Merge and deduplicate
      const allOrders = [...(byUserId || []), ...(byEmail || [])];
      const seen = new Set<string>();
      const unique = allOrders.filter((o) => {
        if (seen.has(o.id)) return false;
        seen.add(o.id);
        return true;
      });

      // Sort by date descending
      unique.sort((a, b) => {
        const dateA = a.txn_date || a.created_at;
        const dateB = b.txn_date || b.created_at;
        return dateB.localeCompare(dateA);
      });

      setOrders(unique);
      setLoading(false);
    };

    fetchOrders();
  }, [userId, userEmail]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "GBP",
    }).format(amount);
  };

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="font-display text-sm font-semibold">Order History</CardTitle>
        <p className="font-body text-xs text-muted-foreground">
          Any order placed with us using your email address will appear here, regardless of which
          channel it was placed through. To see orders from eBay and social media channels, make
          sure to{" "}
          <Link to="/account?tab=profile" className="text-primary underline">
            link your accounts
          </Link>{" "}
          in your profile.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="font-body text-sm text-muted-foreground">Loading orders...</p>
        ) : orders.length === 0 ? (
          <p className="font-body text-sm text-muted-foreground">
            No orders yet. When you make a purchase, your order history will appear here.
          </p>
        ) : (
          <div className="space-y-2">
            {orders.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between border border-border p-3 rounded-sm"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <p className="font-display text-xs font-semibold text-foreground">
                      {order.order_number}
                    </p>
                    <p className="font-body text-[11px] text-muted-foreground">
                      {formatDate(order.txn_date || order.created_at)}
                    </p>
                  </div>
                  <Badge
                    variant={channelVariant[order.origin_channel] || "secondary"}
                    className="font-display text-[10px]"
                  >
                    {channelLabel[order.origin_channel] || order.origin_channel}
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="font-display text-[10px]">
                    {statusLabel[order.status] || order.status}
                  </Badge>
                  <p className="font-display text-xs font-semibold text-foreground">
                    {formatCurrency(order.gross_total, order.currency)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
