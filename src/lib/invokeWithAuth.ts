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
        if (body?.error) throw new Error(body.error);
      } catch (e) {
        // Only rethrow if it's our extracted error (from body.error above),
        // not a JSON parse failure from context.json()
        if (e instanceof SyntaxError) {
          // JSON parse failed — fall through to throw original error
        } else if (e instanceof Error) {
          throw e;
        }
      }
    } else if (context && typeof context === 'object' && 'error' in context) {
      // Newer Supabase client versions may pass parsed data directly
      throw new Error(String(context.error) || error.message);
    }
    throw error;
  }
  return data as T;
}
