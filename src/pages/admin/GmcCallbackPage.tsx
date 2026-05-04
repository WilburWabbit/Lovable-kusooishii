import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

export default function GmcCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Connecting to Google Merchant Centre...");

  useEffect(() => {
    const code = searchParams.get("code");

    if (!code) {
      setStatus("error");
      setMessage("Missing authorization code from Google.");
      return;
    }

    const exchange = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Not authenticated");

        // merchant_id should be stored in localStorage before redirect
        const merchantId = localStorage.getItem("gmc_merchant_id") || "";
        if (!merchantId) throw new Error("Missing Merchant ID. Please try connecting again.");

        const dataSource = localStorage.getItem("gmc_data_source") || null;

        const { data, error } = await supabase.functions.invoke("gmc-auth", {
          body: { action: "exchange", code, merchant_id: merchantId, data_source: dataSource },
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        localStorage.removeItem("gmc_merchant_id");
        localStorage.removeItem("gmc_data_source");
        setStatus("success");
        setMessage("Successfully connected to Google Merchant Centre!");
        setTimeout(() => navigate("/admin/settings/integrations?entity=google"), 2000);
      } catch (err) {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Failed to connect");
      }
    };

    exchange();
  }, [searchParams, navigate]);

  return (
    <AdminV2Layout>
      <div className="flex h-[60vh] items-center justify-center animate-fade-in">
        <div className="text-center space-y-4">
          {status === "loading" && <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />}
          {status === "success" && <CheckCircle2 className="mx-auto h-8 w-8 text-green-500" />}
          {status === "error" && <XCircle className="mx-auto h-8 w-8 text-destructive" />}
          <p className="font-body text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
    </AdminV2Layout>
  );
}
