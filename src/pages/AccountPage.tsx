import { useEffect } from "react";
import { StorefrontLayout } from "@/components/StorefrontLayout";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { User, Heart, MapPin, Package, LogOut, Shield } from "lucide-react";
import WishlistTab from "@/components/WishlistTab";
import ProfileTab from "@/components/account/ProfileTab";
import AddressesTab from "@/components/account/AddressesTab";
import OrdersTab from "@/components/account/OrdersTab";

export default function AccountPage() {
  const { user, profile, loading, signOut, isStaffOrAdmin, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get("tab") || "profile";

  useEffect(() => {
    if (!loading && !user) {
      navigate("/login");
    }
  }, [user, loading, navigate]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
    toast.success("Signed out.");
  };

  if (loading) {
    return (
      <StorefrontLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="font-body text-sm text-muted-foreground">Loading...</p>
        </div>
      </StorefrontLayout>
    );
  }

  if (!user) return null;

  return (
    <StorefrontLayout>
      <div className="bg-background">
        <div className="border-b border-border bg-kuso-paper py-8">
          <div className="container flex items-center justify-between">
            <div>
              <h1 className="font-display text-2xl font-bold text-foreground">My Account</h1>
              <p className="mt-1 font-body text-sm text-muted-foreground">{user.email}</p>
            </div>
            <Button variant="outline" size="sm" onClick={handleSignOut} className="font-display text-xs">
              <LogOut className="mr-1.5 h-3.5 w-3.5" /> Sign Out
            </Button>
          </div>
        </div>

        <div className="container py-8">
          <Tabs defaultValue={defaultTab} className="space-y-6">
            <TabsList className="bg-kuso-mist">
              <TabsTrigger value="profile" className="font-display text-xs">
                <User className="mr-1.5 h-3.5 w-3.5" /> Profile
              </TabsTrigger>
              <TabsTrigger value="wishlist" className="font-display text-xs">
                <Heart className="mr-1.5 h-3.5 w-3.5" /> Wishlist
              </TabsTrigger>
              <TabsTrigger value="addresses" className="font-display text-xs">
                <MapPin className="mr-1.5 h-3.5 w-3.5" /> Addresses
              </TabsTrigger>
              <TabsTrigger value="orders" className="font-display text-xs">
                <Package className="mr-1.5 h-3.5 w-3.5" /> Orders
              </TabsTrigger>
              {isStaffOrAdmin && (
                <TabsTrigger value="admin" className="font-display text-xs" onClick={() => navigate("/admin/purchases")}>
                  <Shield className="mr-1.5 h-3.5 w-3.5" /> Admin
                </TabsTrigger>
              )}
            </TabsList>

            {/* Profile Tab */}
            <TabsContent value="profile">
              <ProfileTab user={user} profile={profile} onProfileUpdated={refreshProfile} />
            </TabsContent>

            {/* Wishlist Tab */}
            <TabsContent value="wishlist">
              <WishlistTab userId={user.id} />
            </TabsContent>

            {/* Addresses Tab */}
            <TabsContent value="addresses">
              <AddressesTab userId={user.id} />
            </TabsContent>

            {/* Orders Tab */}
            <TabsContent value="orders">
              <OrdersTab userId={user.id} userEmail={user.email || ""} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </StorefrontLayout>
  );
}
