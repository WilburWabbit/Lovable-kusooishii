import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { invokeWithAuth } from "@/lib/invokeWithAuth";

export default function MetaCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Connecting to Meta...");

  useEffect(() => {
    const code = searchParams.get("code");
    const error = searchParams.get("error_description") || searchParams.get("error_message") || searchParams.get("error");

    if (error) {
      setStatus("error");
      setMessage(error);
      return;
    }

    if (!code) {
      setStatus("error");
      setMessage("Missing authorization code from Meta.");
      return;
    }

    const exchange = async () => {
      try {
        await invokeWithAuth("meta-auth", { action: "exchange", code });
        setStatus("success");
        setMessage("Successfully connected to Meta.");
        setTimeout(() => navigate("/admin/settings/integrations?entity=meta"), 2000);
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
        <div className="space-y-4 text-center">
          {status === "loading" && <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />}
          {status === "success" && <CheckCircle2 className="mx-auto h-8 w-8 text-green-500" />}
          {status === "error" && <XCircle className="mx-auto h-8 w-8 text-destructive" />}
          <p className="font-body text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
    </AdminV2Layout>
  );
}
