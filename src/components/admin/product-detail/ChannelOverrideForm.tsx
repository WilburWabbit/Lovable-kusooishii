import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Save, Loader2 } from "lucide-react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { toast } from "sonner";
import { CharLimitField } from "./CharLimitField";
import type { ChannelListing } from "./types";

interface ChannelOverrideFormProps {
  listing: ChannelListing;
  productName: string | null;
  onInvalidate: () => void;
}

export function ChannelOverrideForm({ listing, productName, onInvalidate }: ChannelOverrideFormProps) {
  const [title, setTitle] = useState(listing.listing_title ?? "");
  const [description, setDescription] = useState(listing.listing_description ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(listing.listing_title ?? "");
    setDescription(listing.listing_description ?? "");
    setDirty(false);
  }, [listing]);

  const maxTitle = listing.channel === "ebay" ? 80 : undefined;

  const handleSave = async () => {
    setSaving(true);
    try {
      await invokeWithAuth("admin-data", {
        action: "update-channel-listing",
        listing_id: listing.id,
        listing_title: title.trim() || null,
        listing_description: description.trim() || null,
      });
      toast.success("Channel listing saved");
      setDirty(false);
      onInvalidate();
    } catch (err: any) {
      toast.error(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 pt-2">
      <CharLimitField
        id={`title-${listing.id}`}
        label="Listing Title Override"
        value={title}
        onChange={(v) => { setTitle(v); setDirty(true); }}
        maxLen={maxTitle}
        placeholder={productName ?? "Use product name…"}
      />
      <CharLimitField
        id={`desc-${listing.id}`}
        label="Listing Description Override"
        value={description}
        onChange={(v) => { setDescription(v); setDirty(true); }}
        type="textarea"
        placeholder="Use product description…"
      />
      <div className="flex justify-end">
        <Button size="sm" variant="outline" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
