import type { Upstream } from "./provider-keys.server";
/** Provider error messages can echo credentials. Do not send or log a raw credential-bearing error. */
export function redactProviderError(message: string, upstream: Upstream) {
  let safe = message.slice(0, 8000);
  for (const value of Object.values(upstream.headers)) {
    const credential = value.replace(/^Bearer\s+/i, "");
    if (credential.length >= 8) safe = safe.split(credential).join("[redacted]");
  }
  return safe.replace(/\bsk-(?:proj-|ant-|or-v1-)?[A-Za-z0-9_-]{20,}\b/g, "[redacted]");
}
export function providerStatusMessage(status: number) {
  if (status === 401)
    return "The provider rejected the API key. Check or replace it in AI Providers.";
  if (status === 403)
    return "The provider denied this request. Check account permissions and model access.";
  if (status === 404)
    return "The model or provider endpoint is unavailable. Refresh the provider model list.";
  if (status === 429)
    return "The provider rate limit or quota was reached. Check your provider account before retrying.";
  return `AI request failed (${status}). Check provider availability and request support.`;
}
