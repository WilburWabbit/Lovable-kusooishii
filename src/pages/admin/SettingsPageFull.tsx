import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Plug, Receipt, Truck, Users, Percent } from "lucide-react";

const settingsLinks = [
  { title: "Integrations", description: "QuickBooks, eBay, and BrickEconomy connections", icon: Plug, url: "/admin/settings/integrations" },
  { title: "Selling Fees", description: "Default selling costs and channel fee schedules", icon: Receipt, url: "/admin/settings/selling-fees" },
  { title: "Shipping Rates", description: "Carrier rate table by size band and weight", icon: Truck, url: "/admin/settings/shipping-rates" },
  { title: "Users", description: "Manage user accounts and roles", icon: Users, url: "/admin/settings/users" },
  { title: "VAT Rates", description: "Tax codes and VAT rate configuration", icon: Percent, url: "/admin/settings/vat-rates" },
];

export function SettingsPage() {
  return (
    <BackOfficeLayout title="Settings">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-fade-in max-w-4xl">
        {settingsLinks.map((item) => (
          <Link key={item.url} to={item.url}>
            <Card className="hover:border-primary/40 transition-colors cursor-pointer h-full">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <item.icon className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="font-display text-base">{item.title}</CardTitle>
                </div>
                <CardDescription className="font-body text-xs">{item.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </BackOfficeLayout>
  );
}
