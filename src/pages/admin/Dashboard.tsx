import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, ShoppingCart, TrendingUp, AlertTriangle } from "lucide-react";

const stats = [
  { label: "Units in Stock", value: "342", change: "+12 this week", icon: Package },
  { label: "Active Listings", value: "287", change: "across 3 channels", icon: TrendingUp },
  { label: "Open Orders", value: "18", change: "6 awaiting dispatch", icon: ShoppingCart },
  { label: "Exceptions", value: "3", change: "1 critical", icon: AlertTriangle },
];

export default function AdminDashboard() {
  return (
    <BackOfficeLayout title="Dashboard">
      <div className="space-y-6 animate-fade-in">
        {/* Stats grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.label} className="border-border">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="font-display text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <stat.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="font-display text-2xl font-bold text-foreground">{stat.value}</p>
                <p className="mt-1 font-body text-xs text-muted-foreground">{stat.change}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Placeholder sections */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="font-display text-sm font-semibold text-foreground">
                Recent Orders
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-body text-sm text-muted-foreground">
                Order feed will connect to sales_order table.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="font-display text-sm font-semibold text-foreground">
                Integration Health
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {["QBO", "eBay", "BrickLink", "BrickOwl", "Stripe"].map((name) => (
                  <div key={name} className="flex items-center justify-between">
                    <span className="font-body text-sm text-foreground">{name}</span>
                    <span className="flex h-2 w-2 rounded-full bg-muted-foreground" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </BackOfficeLayout>
  );
}
