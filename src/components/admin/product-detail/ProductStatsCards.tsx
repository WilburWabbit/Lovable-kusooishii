import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, PoundSterling, ShoppingBag, TrendingUp } from "lucide-react";
import { fmt } from "./types";
import type { ProductDetail } from "./types";

interface ProductStatsCardsProps {
  product: ProductDetail;
}

export function ProductStatsCards({ product }: ProductStatsCardsProps) {
  const stats = [
    { label: "Stock", value: String(product.stock_available), icon: Package },
    { label: "Value", value: fmt(product.carrying_value), icon: PoundSterling },
    { label: "Units Sold", value: String(product.units_sold), icon: ShoppingBag },
    { label: "Revenue", value: fmt(product.revenue), icon: TrendingUp },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((s) => (
        <Card key={s.label}>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">{s.label}</CardTitle>
            <s.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-display">{s.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
