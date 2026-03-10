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

  if (error) throw error;
  return data as T;
}
