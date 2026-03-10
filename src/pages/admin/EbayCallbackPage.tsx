import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

export default function EbayCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Connecting to eBay...");

  useEffect(() => {
    const code = searchParams.get("code");

    if (!code) {
      setStatus("error");
      setMessage("Missing authorization code from eBay.");
      return;
    }

    const exchange = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Not authenticated");

        const { data, error } = await supabase.functions.invoke("ebay-auth", {
          body: { action: "exchange", code },
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        setStatus("success");
        setMessage("Successfully connected to eBay!");
        setTimeout(() => navigate("/admin/settings"), 2000);
      } catch (err) {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Failed to connect");
      }
    };

    exchange();
  }, [searchParams, navigate]);

  return (
    <BackOfficeLayout title="eBay Connection">
      <div className="flex h-[60vh] items-center justify-center animate-fade-in">
        <div className="text-center space-y-4">
          {status === "loading" && <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />}
          {status === "success" && <CheckCircle2 className="mx-auto h-8 w-8 text-green-500" />}
          {status === "error" && <XCircle className="mx-auto h-8 w-8 text-destructive" />}
          <p className="font-body text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
    </BackOfficeLayout>
  );
}
