import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Address {
  id?: string;
  line_1: string;
  line_2: string;
  city: string;
  county: string;
  postcode: string;
  country: string;
}

const emptyAddress: Address = {
  line_1: "",
  line_2: "",
  city: "",
  county: "",
  postcode: "",
  country: "GB",
};

interface AddressesTabProps {
  userId: string;
}

export default function AddressesTab({ userId }: AddressesTabProps) {
  const [billing, setBilling] = useState<Address>({ ...emptyAddress });
  const [delivery, setDelivery] = useState<Address>({ ...emptyAddress });
  const [sameAsBilling, setSameAsBilling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [billingId, setBillingId] = useState<string | null>(null);
  const [deliveryId, setDeliveryId] = useState<string | null>(null);

  useEffect(() => {
    const fetchAddresses = async () => {
      const { data } = await supabase
        .from("member_address")
        .select("*")
        .eq("user_id", userId);

      if (data) {
        const billingAddr = data.find((a: any) => a.address_type === "billing");
        const deliveryAddr = data.find((a: any) => a.address_type === "delivery");

        if (billingAddr) {
          setBilling({
            id: billingAddr.id,
            line_1: billingAddr.line_1,
            line_2: billingAddr.line_2 || "",
            city: billingAddr.city,
            county: billingAddr.county || "",
            postcode: billingAddr.postcode,
            country: billingAddr.country,
          });
          setBillingId(billingAddr.id);
        }

        if (deliveryAddr) {
          setDelivery({
            id: deliveryAddr.id,
            line_1: deliveryAddr.line_1,
            line_2: deliveryAddr.line_2 || "",
            city: deliveryAddr.city,
            county: deliveryAddr.county || "",
            postcode: deliveryAddr.postcode,
            country: deliveryAddr.country,
          });
          setDeliveryId(deliveryAddr.id);
        }

        // Check if they're the same
        if (billingAddr && deliveryAddr) {
          const same =
            billingAddr.line_1 === deliveryAddr.line_1 &&
            billingAddr.line_2 === deliveryAddr.line_2 &&
            billingAddr.city === deliveryAddr.city &&
            billingAddr.county === deliveryAddr.county &&
            billingAddr.postcode === deliveryAddr.postcode &&
            billingAddr.country === deliveryAddr.country;
          setSameAsBilling(same);
        }
      }
    };

    fetchAddresses();
  }, [userId]);

  const handleSameAsChange = (checked: boolean) => {
    setSameAsBilling(checked);
    if (checked) {
      setDelivery({ ...billing, id: delivery.id });
    }
  };

  const handleBillingChange = (field: keyof Address, value: string) => {
    setBilling((prev) => {
      const updated = { ...prev, [field]: value };
      if (sameAsBilling) {
        setDelivery({ ...updated, id: delivery.id });
      }
      return updated;
    });
  };

  const upsertAddress = async (
    address: Address,
    type: "billing" | "delivery",
    existingId: string | null
  ) => {
    const row = {
      user_id: userId,
      label: type === "billing" ? "Billing Address" : "Delivery Address",
      address_type: type,
      line_1: address.line_1,
      line_2: address.line_2 || null,
      city: address.city,
      county: address.county || null,
      postcode: address.postcode,
      country: address.country || "GB",
      is_default: type === "delivery",
    };

    if (existingId) {
      const { error } = await supabase
        .from("member_address")
        .update(row)
        .eq("id", existingId);
      return { error, id: existingId };
    } else {
      const { data, error } = await supabase
        .from("member_address")
        .insert(row)
        .select("id")
        .single();
      return { error, id: data?.id ?? null };
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!billing.line_1 || !billing.city || !billing.postcode) {
      toast.error("Please fill in the required billing address fields.");
      return;
    }

    setSaving(true);

    const effectiveDelivery = sameAsBilling ? { ...billing, id: delivery.id } : delivery;

    const billingResult = await upsertAddress(billing, "billing", billingId);
    if (billingResult.error) {
      toast.error("Failed to save billing address.");
      setSaving(false);
      return;
    }
    if (billingResult.id) setBillingId(billingResult.id);

    if (effectiveDelivery.line_1 && effectiveDelivery.city && effectiveDelivery.postcode) {
      const deliveryResult = await upsertAddress(effectiveDelivery, "delivery", deliveryId);
      if (deliveryResult.error) {
        toast.error("Failed to save delivery address.");
        setSaving(false);
        return;
      }
      if (deliveryResult.id) setDeliveryId(deliveryResult.id);
    }

    // Push billing address to QBO
    try {
      await supabase.functions.invoke("qbo-upsert-customer", {
        body: {
          billing_address: {
            line_1: billing.line_1,
            line_2: billing.line_2,
            city: billing.city,
            county: billing.county,
            postcode: billing.postcode,
            country: billing.country,
          },
        },
      });
    } catch {
      // QBO sync failure is non-blocking
      console.warn("QBO address sync failed (non-blocking)");
    }

    toast.success("Addresses saved.");
    setSaving(false);
  };

  const renderAddressForm = (
    address: Address,
    onChange: (field: keyof Address, value: string) => void,
    disabled?: boolean
  ) => (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label className="font-display text-xs font-semibold uppercase tracking-widest">
          Address Line 1
        </Label>
        <Input
          value={address.line_1}
          onChange={(e) => onChange("line_1", e.target.value)}
          className="font-body"
          disabled={disabled}
          placeholder="Street address"
        />
      </div>
      <div className="space-y-2">
        <Label className="font-display text-xs font-semibold uppercase tracking-widest">
          Address Line 2
        </Label>
        <Input
          value={address.line_2}
          onChange={(e) => onChange("line_2", e.target.value)}
          className="font-body"
          disabled={disabled}
          placeholder="Flat, suite, etc. (optional)"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="font-display text-xs font-semibold uppercase tracking-widest">
            City
          </Label>
          <Input
            value={address.city}
            onChange={(e) => onChange("city", e.target.value)}
            className="font-body"
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label className="font-display text-xs font-semibold uppercase tracking-widest">
            County
          </Label>
          <Input
            value={address.county}
            onChange={(e) => onChange("county", e.target.value)}
            className="font-body"
            disabled={disabled}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="font-display text-xs font-semibold uppercase tracking-widest">
            Postcode
          </Label>
          <Input
            value={address.postcode}
            onChange={(e) => onChange("postcode", e.target.value)}
            className="font-body"
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label className="font-display text-xs font-semibold uppercase tracking-widest">
            Country
          </Label>
          <Input
            value={address.country}
            onChange={(e) => onChange("country", e.target.value)}
            className="font-body"
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-display text-sm font-semibold">
            Billing Address
          </CardTitle>
        </CardHeader>
        <CardContent>
          {renderAddressForm(billing, handleBillingChange)}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Checkbox
          id="same-as-billing"
          checked={sameAsBilling}
          onCheckedChange={(checked) => handleSameAsChange(checked === true)}
        />
        <Label htmlFor="same-as-billing" className="font-body text-sm cursor-pointer">
          Delivery address same as billing
        </Label>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-display text-sm font-semibold">
            Delivery Address
          </CardTitle>
        </CardHeader>
        <CardContent>
          {renderAddressForm(
            sameAsBilling ? billing : delivery,
            (field, value) => setDelivery((prev) => ({ ...prev, [field]: value })),
            sameAsBilling
          )}
        </CardContent>
      </Card>

      <Button type="submit" size="sm" disabled={saving} className="font-display text-xs font-semibold">
        {saving ? "Saving..." : "Save Addresses"}
      </Button>
    </form>
  );
}
