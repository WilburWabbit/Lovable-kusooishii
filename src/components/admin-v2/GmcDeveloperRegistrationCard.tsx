import { useEffect, useState } from "react";
import { Loader2, RefreshCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  useGmcDeveloperRegistration,
  useGmcMutations,
  useGmcStatus,
  type GmcDeveloperRegistrationStatus,
} from "@/hooks/admin/use-gmc";
import { Badge, Mono, SectionHead, SurfaceCard } from "./ui-primitives";

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status?: GmcDeveloperRegistrationStatus, connected?: boolean) {
  if (!connected) return <Badge label="Connect GMC first" color="#D97706" small />;
  if (!status) return <Badge label="Not checked" color="#71717A" small />;
  if (status.registered) return <Badge label="Registered" color="#16A34A" small />;
  if (status.needs_registration) return <Badge label="Needs registration" color="#DC2626" small />;
  return <Badge label="Check required" color="#D97706" small />;
}

function metadataValue(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function GmcDeveloperRegistrationCard() {
  const { data: status } = useGmcStatus();
  const connected = Boolean(status?.connected);
  const registration = useGmcDeveloperRegistration(connected);
  const mutations = useGmcMutations();
  const [developerEmail, setDeveloperEmail] = useState("");

  const data = registration.data;
  const gcpId = metadataValue(data?.error_metadata, "GCP_ID");
  const gcpNumber = metadataValue(data?.error_metadata, "GCP_NUMBER");

  useEffect(() => {
    if (data?.developer_email && !developerEmail) setDeveloperEmail(data.developer_email);
  }, [data?.developer_email, developerEmail]);

  const register = async () => {
    const email = developerEmail.trim();
    if (!connected) {
      toast.error("Connect Google Merchant Centre first");
      return;
    }
    if (!email) {
      toast.error("Developer email is required");
      return;
    }

    try {
      await mutations.registerDeveloper.mutateAsync(email);
      toast.success("GCP project registered with Google Merchant Centre");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    }
  };

  const refresh = async () => {
    try {
      const result = await registration.refetch();
      if (result.error) throw result.error;
      toast.success("Developer registration checked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Status check failed");
    }
  };

  return (
    <SurfaceCard>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <SectionHead>Merchant API Developer Registration</SectionHead>
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(data, connected)}
            <span className="text-xs text-zinc-500">
              Checked <Mono>{formatDateTime(data?.checked_at)}</Mono>
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={!connected || registration.isFetching}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {registration.isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="h-3.5 w-3.5" />
          )}
          Check
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <label className="grid gap-1 text-[11px] font-medium text-zinc-500">
          Developer email
          <input
            type="email"
            value={developerEmail}
            onChange={(event) => setDeveloperEmail(event.target.value)}
            placeholder="developer@example.com"
            className="h-9 rounded-md border border-zinc-200 px-2 text-xs text-zinc-900"
          />
        </label>
        <button
          type="button"
          onClick={register}
          disabled={!connected || mutations.registerDeveloper.isPending}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {mutations.registerDeveloper.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          Register GCP project
        </button>
      </div>

      <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
        <div className="rounded-md border border-zinc-100 bg-zinc-50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Merchant ID</div>
          <Mono>{status?.merchant_id ?? "-"}</Mono>
        </div>
        <div className="rounded-md border border-zinc-100 bg-zinc-50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Registered GCP IDs</div>
          <Mono>{data?.gcp_ids?.length ? data.gcp_ids.join(", ") : gcpNumber ?? "-"}</Mono>
        </div>
        {gcpId ? (
          <div className="rounded-md border border-zinc-100 bg-zinc-50 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Project ID</div>
            <Mono>{gcpId}</Mono>
          </div>
        ) : null}
        {data?.needs_registration && data.error ? (
          <div className="rounded-md border border-red-100 bg-red-50 p-3 text-red-700 sm:col-span-2">
            {data.error}
          </div>
        ) : null}
      </div>

      {data?.registered ? (
        <p className="mt-3 text-[10px] text-zinc-500">
          Google may take up to 5 minutes before product publishing calls recognise the registration.
        </p>
      ) : null}
    </SurfaceCard>
  );
}
