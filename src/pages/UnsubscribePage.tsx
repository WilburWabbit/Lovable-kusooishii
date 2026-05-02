import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { StorefrontLayout } from "@/components/StorefrontLayout";
import { usePageSeo } from "@/hooks/use-page-seo";

type Status = "loading" | "valid" | "already" | "invalid" | "success" | "error";

const UnsubscribePage = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    fetch(`${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`, {
      headers: { apikey: anonKey },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.valid === false && data.reason === "already_unsubscribed") {
          setStatus("already");
        } else if (data.valid) {
          setStatus("valid");
        } else {
          setStatus("invalid");
        }
      })
      .catch(() => setStatus("error"));
  }, [token]);

  const handleUnsubscribe = async () => {
    if (!token) return;
    try {
      const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", {
        body: { token },
      });
      if (error) throw error;
      if (data?.success) {
        setStatus("success");
      } else if (data?.reason === "already_unsubscribed") {
        setStatus("already");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  return (
    <StorefrontLayout>
      <div className="container mx-auto px-4 py-20 flex items-center justify-center min-h-[60vh]">
        <div className="max-w-md w-full text-center space-y-6">
          {status === "loading" && (
            <p className="text-muted-foreground">Validating…</p>
          )}
          {status === "valid" && (
            <>
              <h1 className="text-2xl font-bold text-foreground">Unsubscribe</h1>
              <p className="text-muted-foreground">
                Click below to unsubscribe from app emails. You'll still receive
                essential account emails (password resets, etc.).
              </p>
              <button
                onClick={handleUnsubscribe}
                className="bg-primary text-primary-foreground px-6 py-3 rounded font-semibold hover:opacity-90 transition"
              >
                Confirm Unsubscribe
              </button>
            </>
          )}
          {status === "success" && (
            <>
              <h1 className="text-2xl font-bold text-foreground">Done.</h1>
              <p className="text-muted-foreground">
                You've been unsubscribed. No more app emails from us.
              </p>
            </>
          )}
          {status === "already" && (
            <>
              <h1 className="text-2xl font-bold text-foreground">Already unsubscribed</h1>
              <p className="text-muted-foreground">
                This email address has already been unsubscribed.
              </p>
            </>
          )}
          {status === "invalid" && (
            <>
              <h1 className="text-2xl font-bold text-foreground">Invalid link</h1>
              <p className="text-muted-foreground">
                This unsubscribe link is invalid or has expired.
              </p>
            </>
          )}
          {status === "error" && (
            <>
              <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
              <p className="text-muted-foreground">
                We couldn't process your request. Please try again or contact
                contact@kusooishii.com.
              </p>
            </>
          )}
        </div>
      </div>
    </StorefrontLayout>
  );
};

export default UnsubscribePage;
