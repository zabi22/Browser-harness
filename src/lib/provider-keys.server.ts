// Server-only: encrypt, store lookup and per-provider upstream config for users' own API keys.
export type KeyProvider = "openai" | "anthropic" | "google" | "custom";
export const KEY_PROVIDERS: KeyProvider[] = ["openai", "anthropic", "google", "custom"];
export const DEFAULT_CUSTOM_BASE = "https://openrouter.ai/api/v1";

async function aesKey() {
  const secret = process.env["PROVIDER_KEY_SECRET"];
  if (!secret) throw new Error("Key encryption is not configured");
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptKey(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(plain)));
  return `${b64(iv)}.${b64(ct)}`;
}
export async function decryptKey(stored: string): Promise<string> {
  const [iv, ct] = stored.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv!) }, await aesKey(), unb64(ct!));
  return new TextDecoder().decode(pt);
}

export const PROVIDER_LABEL: Record<KeyProvider, string> = {
  openai: "OpenAI", anthropic: "Anthropic", google: "Google Gemini", custom: "OpenRouter / custom",
};

/** Read the caller's stored key (RLS as the caller via their bearer token). */
export async function loadUserKey(authHeader: string, provider: KeyProvider) {
  const url = process.env["SUPABASE_URL"]!;
  const pk = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const r = await fetch(`${url}/rest/v1/provider_keys?provider=eq.${provider}&select=ciphertext,base_url`, {
    headers: { apikey: pk, Authorization: authHeader },
  });
  if (!r.ok) return null;
  const rows = (await r.json()) as { ciphertext: string; base_url: string | null }[];
  if (!rows[0]) return null;
  return { key: await decryptKey(rows[0].ciphertext), baseUrl: rows[0].base_url };
}

export interface Upstream { base: string; headers: Record<string, string> }

export function upstreamFor(provider: KeyProvider, key: string, baseUrl?: string | null): Upstream {
  if (provider === "anthropic")
    return { base: "https://api.anthropic.com/v1", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } };
  if (provider === "google")
    return { base: "https://generativelanguage.googleapis.com/v1beta/openai", headers: { Authorization: `Bearer ${key}` } };
  if (provider === "custom")
    return { base: (baseUrl || DEFAULT_CUSTOM_BASE).replace(/\/+$/, ""), headers: { Authorization: `Bearer ${key}` } };
  return { base: "https://api.openai.com/v1", headers: { Authorization: `Bearer ${key}` } };
}

/** Provider-native model id: drop our "provider/" prefix. */
export function nativeModelId(id: string) {
  const i = id.indexOf("/");
  return i < 0 ? id : id.slice(i + 1);
}

/** Resolve the caller's upstream for a provider, or a user-facing reason it is missing. */
export async function userUpstream(request: Request, provider: KeyProvider): Promise<Upstream | string> {
  const auth = request.headers.get("authorization") ?? "";
  let row;
  try { row = await loadUserKey(auth, provider); } catch { return `Your ${PROVIDER_LABEL[provider]} key could not be read. Save it again in Settings → API keys.`; }
  if (!row) return `Add your ${PROVIDER_LABEL[provider]} API key in Settings → API keys to use this model.`;
  return upstreamFor(provider, row.key, row.baseUrl);
}
