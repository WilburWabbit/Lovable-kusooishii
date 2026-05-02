// Shared AI provider abstraction.
// Reads `ai_provider` from app_settings and routes chat-completion requests
// to either the Lovable AI gateway or OpenAI's API. Supports automatic
// fallback to OpenAI when the primary provider returns 429 / 402, so a
// rate-limit on Lovable AI doesn't break product copy generation.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

export type AiProvider = "lovable" | "openai";

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

// Default model per provider. The Lovable AI gateway accepts OpenAI-style
// model identifiers (prefixed with provider) and proxies them to the
// underlying provider. gpt-5 is a strong all-rounder with vision + tools.
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  lovable: "openai/gpt-5",
  openai: "gpt-4o",
};

export class AiProviderError extends Error {
  status: number;
  userMessage: string;
  constructor(status: number, userMessage: string, message?: string) {
    super(message ?? userMessage);
    this.status = status;
    this.userMessage = userMessage;
  }
}

type SupabaseAdminClient = ReturnType<typeof createClient>;

let cachedAdmin: SupabaseAdminClient | null = null;
function getAdmin(): SupabaseAdminClient {
  if (cachedAdmin) return cachedAdmin;
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  cachedAdmin = createClient(url, key);
  return cachedAdmin;
}

/**
 * Reads the configured AI provider. Defaults to "lovable" when missing.
 */
export async function getConfiguredProvider(
  admin?: SupabaseAdminClient,
): Promise<AiProvider> {
  const client = admin ?? getAdmin();
  try {
    const { data, error } = await client
      .from("app_settings")
      .select("ai_provider")
      .single();
    if (error) throw error;
    const provider = (data as { ai_provider?: string } | null)?.ai_provider;
    return provider === "openai" ? "openai" : "lovable";
  } catch (e) {
    console.warn("ai-provider: unable to read app_settings.ai_provider, defaulting to lovable:", e);
    return "lovable";
  }
}

interface CallOptions {
  /** Force a specific provider — bypasses app_settings. */
  provider?: AiProvider;
  /** Override the default model for the chosen provider. */
  model?: string;
  /** Disable automatic OpenAI fallback when the primary fails with 429/402. */
  noFallback?: boolean;
  /** Supabase admin client to use for the settings lookup. */
  admin?: SupabaseAdminClient;
}

export interface ChatCompletionResult {
  data: any;
  providerUsed: AiProvider;
  modelUsed: string;
  fellBack: boolean;
}

/**
 * Calls a chat-completion endpoint using the configured provider, with
 * automatic OpenAI fallback for rate-limit / payment failures when the
 * primary provider is Lovable AI.
 *
 * `body` should be a normal OpenAI-style request body (messages, tools,
 * tool_choice, max_tokens, ...). Do NOT include `model` — it is injected
 * per provider.
 */
export async function callChatCompletion(
  body: Record<string, unknown>,
  options: CallOptions = {},
): Promise<ChatCompletionResult> {
  const primary = options.provider ?? (await getConfiguredProvider(options.admin));

  const result = await tryProvider(primary, body, options.model);
  if (result.ok) {
    return { data: result.data, providerUsed: primary, modelUsed: result.model, fellBack: false };
  }

  // Fallback: only when primary is Lovable, the failure is recoverable
  // (429 rate limit / 402 payment required), and an OpenAI key exists.
  const canFallback =
    !options.noFallback &&
    primary === "lovable" &&
    (result.status === 429 || result.status === 402) &&
    !!Deno.env.get("OPENAI_API_KEY");

  if (canFallback) {
    console.warn(
      `ai-provider: Lovable AI returned ${result.status}; falling back to OpenAI.`,
    );
    const fb = await tryProvider("openai", body, undefined);
    if (fb.ok) {
      return { data: fb.data, providerUsed: "openai", modelUsed: fb.model, fellBack: true };
    }
    throw toUserError(fb.status, fb.errorText, "openai");
  }

  throw toUserError(result.status, result.errorText, primary);
}

async function tryProvider(
  provider: AiProvider,
  body: Record<string, unknown>,
  modelOverride: string | undefined,
): Promise<
  | { ok: true; data: any; model: string }
  | { ok: false; status: number; errorText: string; model: string }
> {
  const model = modelOverride ?? DEFAULT_MODELS[provider];

  const apiKey = provider === "lovable"
    ? Deno.env.get("LOVABLE_API_KEY")
    : Deno.env.get("OPENAI_API_KEY");

  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      errorText: `${provider === "lovable" ? "LOVABLE_API_KEY" : "OPENAI_API_KEY"} is not configured`,
      model,
    };
  }

  const endpoint = provider === "lovable" ? LOVABLE_GATEWAY : OPENAI_ENDPOINT;
  const requestBody = { ...body, model };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error(`ai-provider [${provider}] HTTP ${response.status}:`, errorText.slice(0, 500));
    return { ok: false, status: response.status, errorText, model };
  }

  const data = await response.json();
  return { ok: true, data, model };
}

function toUserError(status: number, text: string, provider: AiProvider): AiProviderError {
  const label = provider === "lovable" ? "Lovable AI" : "OpenAI";
  if (status === 429) {
    return new AiProviderError(
      429,
      `${label} is rate-limited. Please try again in a moment.`,
      text,
    );
  }
  if (status === 402) {
    return new AiProviderError(
      402,
      provider === "lovable"
        ? "Lovable AI workspace credits are exhausted. Add funds in Settings → Workspace → Usage, or switch the AI provider to OpenAI."
        : "OpenAI quota exhausted. Top up billing in the OpenAI dashboard, or switch the AI provider to Lovable AI.",
      text,
    );
  }
  return new AiProviderError(
    status >= 400 && status < 600 ? status : 500,
    `${label} request failed (HTTP ${status}).`,
    text,
  );
}
