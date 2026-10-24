import { PROVIDER_BASES, type KeyProvider } from "./providers";
/** Exact operator-approved HTTPS bases. Redirects are rejected by credential-bearing requests. */
export function providerBase(provider: KeyProvider, requested?: string | null): string {
  const base = new URL(requested || PROVIDER_BASES[provider]);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash)
    throw new Error(
      "Provider base must be an approved HTTPS URL without credentials or query parameters",
    );
  const normalized = base.href.replace(/\/+$/, "");
  const allowed = new Set(Object.values(PROVIDER_BASES));
  for (const entry of (process.env["PROVIDER_BASE_URL_ALLOWLIST"] ?? "").split(",")) {
    if (entry.trim()) allowed.add(entry.trim().replace(/\/+$/, ""));
  }
  if (provider !== "custom" && normalized !== PROVIDER_BASES[provider])
    throw new Error("This provider has a fixed endpoint");
  if (!allowed.has(normalized))
    throw new Error("Custom endpoint is not approved by the server operator");
  return normalized;
}
