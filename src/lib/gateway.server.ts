// Server-only helpers for the public chat-completions gateway.
export const PRIMARY_MODEL = "openai/gpt-6-astra";
export const FALLBACK_MODEL = "google/gemini-3.8-flash";
const UPSTREAM = "https://ai.gateway.lovable.dev/v1/chat/completions";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
  "Access-Control-Max-Age": "86400",
};

export function jsonError(status: number, message: string, type = "gateway_error") {
  return new Response(JSON.stringify({ error: { message, type } }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export async function sha256Hex(value: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function extractApiKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim() || null;
  return request.headers.get("x-api-key")?.trim() || null;
}

/** Shape the client body for the target model's request contract. */
export function buildBody(input: Record<string, unknown>, model: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = { ...input, model };
  if (model === PRIMARY_MODEL) {
    delete body.temperature;
    delete body.top_p;
    delete body.logprobs;
    delete body.top_logprobs;
    if (body.max_tokens !== undefined && body.max_completion_tokens === undefined) {
      body.max_completion_tokens = body.max_tokens;
    }
    delete body.max_tokens;
    const effort = body.reasoning_effort;
    if (typeof effort !== "string" || effort === "none" || effort === "minimal") {
      body.reasoning_effort = "low";
    }
  } else {
    delete body.reasoning_effort;
  }
  return body;
}

/** Only transient failures (rate limits, server errors, network) trigger the fallback model. */
export function shouldFallback(status: number | null) {
  return status === null || status === 429 || status >= 500;
}

export async function callUpstream(
  body: Record<string, unknown>,
  apiKey: string,
  signal: AbortSignal,
) {
  return fetch(UPSTREAM, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal,
  });
}
