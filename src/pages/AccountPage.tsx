import { useState, useEffect } from "react";
import { StorefrontLayout } from "@/components/StorefrontLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { User, Heart, MapPin, Package, LogOut, Shield } from "lucide-react";
import WishlistTab from "@/components/WishlistTab";

export default function AccountPage() {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [wishlistItems, setWishlistItems] = useState<any[]>([]);
  const [addresses, setAddresses] = useState<any[]>([]);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/login");
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (profile?.display_name) {
      setDisplayName(profile.display_name);
    }
  }, [profile]);

  useEffect(() => {
    if (!user) return;

    // Fetch addresses
    const fetchAddresses = async () => {
      const { data } = await supabase
        .from("member_address")
        .select("*")
        .eq("user_id", user.id)
        .order("is_default", { ascending: false });
      setAddresses(data || []);
    };

    fetchAddresses();
  }, [user]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);

    const { error } = await supabase
      .from("profile")
      .update({ display_name: displayName })
      .eq("user_id", user.id);

    if (error) {
      toast.error("Failed to update profile.");
    } else {
      toast.success("Profile updated.");
    }
    setSaving(false);
  };

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
          <Tabs defaultValue="profile" className="space-y-6">
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
            </TabsList>

            {/* Profile Tab */}
            <TabsContent value="profile">
              <Card className="max-w-lg border-border">
                <CardHeader>
                  <CardTitle className="font-display text-sm font-semibold">Profile Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleUpdateProfile} className="space-y-4">
                    <div className="space-y-2">
                      <Label className="font-display text-xs font-semibold uppercase tracking-widest">
                        Display Name
                      </Label>
                      <Input
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="font-body"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-display text-xs font-semibold uppercase tracking-widest">
                        Email
                      </Label>
                      <Input value={user.email || ""} disabled className="font-body opacity-60" />
                    </div>
                    <Button type="submit" size="sm" disabled={saving} className="font-display text-xs font-semibold">
                      {saving ? "Saving..." : "Save Changes"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Wishlist Tab */}
            <TabsContent value="wishlist">
              <WishlistTab userId={user.id} />
            </TabsContent>

            {/* Addresses Tab */}
            <TabsContent value="addresses">
              <Card className="border-border">
                <CardHeader>
                  <CardTitle className="font-display text-sm font-semibold">Saved Addresses</CardTitle>
                </CardHeader>
                <CardContent>
                  {addresses.length === 0 ? (
                    <p className="font-body text-sm text-muted-foreground">
                      No saved addresses yet. Add one during checkout.
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {addresses.map((addr: any) => (
                        <div key={addr.id} className="border border-border p-4">
                          <div className="flex items-center gap-2">
                            <p className="font-display text-xs font-semibold text-foreground">{addr.label}</p>
                            {addr.is_default && (
                              <span className="bg-primary px-1.5 py-0.5 font-display text-[9px] font-bold uppercase text-primary-foreground">
                                Default
                              </span>
                            )}
                          </div>
                          <p className="mt-1 font-body text-xs text-muted-foreground">
                            {addr.line_1}{addr.line_2 && `, ${addr.line_2}`}<br />
                            {addr.city}, {addr.postcode}<br />
                            {addr.country}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Orders Tab */}
            <TabsContent value="orders">
              <Card className="border-border">
                <CardHeader>
                  <CardTitle className="font-display text-sm font-semibold">Order History</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-body text-sm text-muted-foreground">
                    No orders yet. When you make a purchase, your order history will appear here.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </StorefrontLayout>
  );
}
