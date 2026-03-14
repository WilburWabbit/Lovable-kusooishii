import { supabase } from "@/integrations/supabase/client";

export async function invokeWithAuth<T = unknown>(
  fnName: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Not authenticated – please log in again.");
  }

  const { data, error } = await supabase.functions.invoke(fnName, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) {
    // Extract the actual error message from the response body
    const context = (error as any).context;
    if (context instanceof Response) {
      try {
        const body = await context.json();
        throw new Error(body.error || error.message);
      } catch (e) {
        if (e instanceof Error && e.message !== error.message) throw e;
      }
    }
    throw error;
  }
  return data as T;
}
