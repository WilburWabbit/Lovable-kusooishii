import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export async function invokeWithAuth<T = unknown>(
  fnName: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Not authenticated – please log in again.");
  }

  // Use raw fetch instead of supabase.functions.invoke to get actionable
  // error messages (the Supabase client wraps fetch errors in a generic
  // "Failed to send a request to the Edge Function" that hides the cause).
  const url = `${SUPABASE_URL}/functions/v1/${fnName}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (fetchErr) {
    // Network-level failure — surface the actual cause
    const msg = fetchErr instanceof Error ? fetchErr.message : "Network error";
    throw new Error(`Edge Function '${fnName}' unreachable: ${msg}`);
  }

  if (!res.ok) {
    // Try to extract a structured error from the response body
    let detail = `HTTP ${res.status}`;
    try {
      const payload = await res.json();
      if (payload?.error) detail = payload.error;
      else if (payload?.message) detail = payload.message;
      else if (payload?.msg) detail = payload.msg;
    } catch {
      // Response wasn't JSON — use status text
      detail = `${res.status} ${res.statusText}`;
    }
    throw new Error(detail);
  }

  const contentType = (res.headers.get("Content-Type") ?? "").split(";")[0].trim();
  if (contentType === "application/json") {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}
