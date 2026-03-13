import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useProfileUpdate } from "@/hooks/useProfileUpdate";
import type { User } from "@supabase/supabase-js";

interface ProfileData {
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  display_name: string | null;
  phone: string | null;
  mobile: string | null;
  ebay_username: string | null;
  facebook_handle: string | null;
  instagram_handle: string | null;
}

interface ProfileTabProps {
  user: User;
  profile: ProfileData | null;
  onProfileUpdated?: () => void;
}

export default function ProfileTab({ user, profile, onProfileUpdated }: ProfileTabProps) {
  const [form, setForm] = useState<ProfileData>({
    first_name: "",
    last_name: "",
    company_name: "",
    display_name: "",
    phone: "",
    mobile: "",
    ebay_username: "",
    facebook_handle: "",
    instagram_handle: "",
  });

  const { updateProfile, saving } = useProfileUpdate(user.id);

  useEffect(() => {
    if (profile) {
      setForm({
        first_name: profile.first_name || "",
        last_name: profile.last_name || "",
        company_name: profile.company_name || "",
        display_name: profile.display_name || "",
        phone: profile.phone || "",
        mobile: profile.mobile || "",
        ebay_username: profile.ebay_username || "",
        facebook_handle: profile.facebook_handle || "",
        instagram_handle: profile.instagram_handle || "",
      });
    }
  }, [profile]);

  const handleChange = (field: keyof ProfileData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Auto-compose display_name from first + last, falling back to company
    const composedName = [form.first_name, form.last_name].filter(Boolean).join(" ");
    const displayName = composedName || form.company_name || form.display_name || "";

    const updates = {
      first_name: form.first_name || null,
      last_name: form.last_name || null,
      company_name: form.company_name || null,
      display_name: displayName || null,
      phone: form.phone || null,
      mobile: form.mobile || null,
      ebay_username: form.ebay_username || null,
      facebook_handle: form.facebook_handle || null,
      instagram_handle: form.instagram_handle || null,
    };

    const oldValues: Record<string, string | null> = {};
    if (profile) {
      for (const key of Object.keys(updates) as (keyof ProfileData)[]) {
        oldValues[key] = profile[key] ?? null;
      }
    }

    const success = await updateProfile(updates, oldValues);
    if (success) {
      onProfileUpdated?.();
    }
  };

  const ebayUrl = form.ebay_username
    ? `https://www.ebay.co.uk/usr/${form.ebay_username}`
    : null;

  // Detect auth provider
  const provider = user.app_metadata?.provider || "email";
  const providerLabel =
    provider === "google" ? "Google" : provider === "apple" ? "Apple" : "Email";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Name & Contact Details */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-display text-sm font-semibold">
            Contact Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="font-display text-xs font-semibold uppercase tracking-widest">
                First Name
              </Label>
              <Input
                value={form.first_name || ""}
                onChange={(e) => handleChange("first_name", e.target.value)}
                className="font-body"
                placeholder="First name"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-display text-xs font-semibold uppercase tracking-widest">
                Last Name
              </Label>
              <Input
                value={form.last_name || ""}
                onChange={(e) => handleChange("last_name", e.target.value)}
                className="font-body"
                placeholder="Last name"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-display text-xs font-semibold uppercase tracking-widest">
              Company Name
            </Label>
            <Input
              value={form.company_name || ""}
              onChange={(e) => handleChange("company_name", e.target.value)}
              className="font-body"
              placeholder="Company name (optional)"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-display text-xs font-semibold uppercase tracking-widest">
              Email
            </Label>
            <div className="flex items-center gap-2">
              <Input value={user.email || ""} disabled className="font-body opacity-60" />
              <Badge variant="secondary" className="font-display text-[10px] whitespace-nowrap">
                {providerLabel}
              </Badge>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="font-display text-xs font-semibold uppercase tracking-widest">
                Phone
              </Label>
              <Input
                value={form.phone || ""}
                onChange={(e) => handleChange("phone", e.target.value)}
                className="font-body"
                placeholder="Phone number"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-display text-xs font-semibold uppercase tracking-widest">
                Mobile
              </Label>
              <Input
                value={form.mobile || ""}
                onChange={(e) => handleChange("mobile", e.target.value)}
                className="font-body"
                placeholder="Mobile number"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Linked Accounts */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-display text-sm font-semibold">
            Linked Accounts
          </CardTitle>
          <p className="font-body text-xs text-muted-foreground">
            Link your marketplace and social media accounts so we can track your orders across all channels.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="font-display text-xs font-semibold uppercase tracking-widest">
              eBay Username
            </Label>
            <Input
              value={form.ebay_username || ""}
              onChange={(e) => handleChange("ebay_username", e.target.value)}
              className="font-body"
              placeholder="e.g. pete.84"
            />
            {ebayUrl && (
              <a
                href={ebayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-body text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {ebayUrl}
              </a>
            )}
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="font-display text-xs font-semibold uppercase tracking-widest">
                Facebook
              </Label>
              <Input
                value={form.facebook_handle || ""}
                onChange={(e) => handleChange("facebook_handle", e.target.value)}
                className="font-body"
                placeholder="Facebook profile or page"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-display text-xs font-semibold uppercase tracking-widest">
                Instagram
              </Label>
              <Input
                value={form.instagram_handle || ""}
                onChange={(e) => handleChange("instagram_handle", e.target.value)}
                className="font-body"
                placeholder="@username"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Button type="submit" size="sm" disabled={saving} className="font-display text-xs font-semibold">
        {saving ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
