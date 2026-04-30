import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ProfileFields {
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  display_name?: string | null;
  phone?: string | null;
  mobile?: string | null;
  ebay_username?: string | null;
  facebook_handle?: string | null;
  instagram_handle?: string | null;
}

async function queueAndProcessCustomerPosting(payload: Record<string, unknown>) {
  const { data: intentId, error: queueError } = await supabase.rpc(
    "queue_qbo_customer_posting_intent" as never,
    { p_payload: payload } as never,
  );
  if (queueError) throw queueError;

  const { error } = await supabase.functions.invoke("accounting-posting-intents-process", {
    body: intentId ? { intentId } : { batch_size: 5 },
  });
  if (error) throw error;
}

export function useProfileUpdate(userId: string) {
  const [saving, setSaving] = useState(false);

  const updateProfile = async (
    updates: ProfileFields,
    oldValues: Record<string, string | null>
  ): Promise<boolean> => {
    setSaving(true);

    try {
      // 1. Save locally
      const { error: profileError } = await supabase
        .from("profile")
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (profileError) {
        toast.error("Failed to update profile: " + profileError.message);
        setSaving(false);
        return false;
      }

      // 2. Log changes to profile_change_log
      const changeEntries = Object.entries(updates)
        .filter(([key, newVal]) => {
          const oldVal = oldValues[key] ?? null;
          const normalizedNew = newVal || null;
          return normalizedNew !== oldVal;
        })
        .map(([key, newVal]) => ({
          user_id: userId,
          field_name: key,
          old_value: oldValues[key] ?? null,
          new_value: (newVal as string) || null,
          changed_by: userId,
        }));

      if (changeEntries.length > 0) {
        // profile_change_log table not yet created — skip logging for now
        console.log("Profile changes:", changeEntries);
      }

      // 3. Queue QBO customer update through the posting outbox.
      const ebayUrl = updates.ebay_username
        ? `https://www.ebay.co.uk/usr/${updates.ebay_username}`
        : null;

      try {
        await queueAndProcessCustomerPosting({
          first_name: updates.first_name,
          last_name: updates.last_name,
          company_name: updates.company_name,
          display_name: updates.display_name,
          email: null, // email comes from auth, not editable
          phone: updates.phone,
          mobile: updates.mobile,
          ebay_url: ebayUrl,
        });
        toast.success("Profile saved and queued to QuickBooks.");
      } catch (err) {
        console.warn("QBO customer posting warning:", err);
        // QBO failure is non-blocking
        toast.success("Profile saved. QBO sync will retry later.");
      }

      setSaving(false);
      return true;
    } catch (err) {
      toast.error("An unexpected error occurred.");
      setSaving(false);
      return false;
    }
  };

  return { updateProfile, saving };
}
