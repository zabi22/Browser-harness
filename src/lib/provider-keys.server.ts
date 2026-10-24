import { KEY_PROVIDERS, PROVIDER_LABEL, type KeyProvider } from "./providers";
import { providerBase } from "./outbound-policy.server";
export { KEY_PROVIDERS, PROVIDER_LABEL, type KeyProvider } from "./providers";
export const DEFAULT_CUSTOM_BASE = "https://openrouter.ai/api/v1";
export interface CredentialOwner {
  userId: string;
  provider: KeyProvider;
}
const encoder = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const activeId = () => process.env["PROVIDER_KEY_ID"] || "primary";
function secrets(): Record<string, string> {
  const current = process.env["PROVIDER_KEY_SECRET"];
  if (!current || current.length < 32)
    throw new Error(
      "Key encryption requires a high-entropy PROVIDER_KEY_SECRET of at least 32 characters",
    );
  const previous: unknown = JSON.parse(process.env["PROVIDER_KEY_PREVIOUS_SECRETS"] || "{}");
  if (!previous || typeof previous !== "object" || Array.isArray(previous))
    throw new Error("Invalid encryption key ring");
  const ring: Record<string, string> = Object.create(null);
  for (const [id, secret] of Object.entries(previous)) {
    if (typeof secret !== "string" || secret.length === 0)
      throw new Error("Invalid previous encryption key");
    ring[id] = secret;
  }
  if (!/^[\w-]{1,64}$/.test(activeId())) throw new Error("Invalid encryption key ID");
  ring[activeId()] = current;
  return ring;
}
async function aesKey(secret: string) {
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const ownerData = (owner: CredentialOwner) =>
  encoder.encode(JSON.stringify([owner.userId, owner.provider]));
export function encryptionConfigured() {
  try {
    secrets();
    return true;
  } catch {
    return false;
  }
}
export async function encryptKey(plain: string, owner: CredentialOwner): Promise<string> {
  const id = activeId(),
    secret = secrets()[id]!;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: ownerData(owner) },
      await aesKey(secret),
      encoder.encode(plain),
    ),
  );
  return `v2.${id}.${b64(iv)}.${b64(ct)}`;
}
export async function decryptKey(stored: string, owner: CredentialOwner): Promise<string> {
  const parts = stored.split("."),
    ring = secrets();
  if (parts[0] === "v2") {
    const [, id, iv, ct] = parts;
    if (parts.length !== 4 || !id || !ring[id] || !iv || !ct || unb64(iv).length !== 12)
      throw new Error("Invalid encrypted credential");
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(iv), additionalData: ownerData(owner) },
      await aesKey(ring[id]),
      unb64(ct),
    );
    return new TextDecoder().decode(pt);
  }
  // Existing AES-GCM rows remain readable; saving/rotating upgrades to owner-bound v2.
  const [iv, ct] = parts;
  if (parts.length !== 2 || !iv || !ct || unb64(iv).length !== 12)
    throw new Error("Invalid legacy credential");
  for (const secret of Object.values(ring)) {
    try {
      return new TextDecoder().decode(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: unb64(iv) },
          await aesKey(secret),
          unb64(ct),
        ),
      );
    } catch {
      /* try retained key */
    }
  }
  throw new Error("Credential could not be decrypted");
}
/** Caller bearer and owner RLS are mandatory; no service-role credential lookup. */
export async function loadUserKey(authHeader: string, provider: KeyProvider) {
  if (!authHeader.toLowerCase().startsWith("bearer ") || !KEY_PROVIDERS.includes(provider))
    return null;
  const url = process.env["SUPABASE_URL"],
    pk = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !pk) throw new Error("Database is not configured");
  const r = await fetch(
    `${url}/rest/v1/provider_keys?provider=eq.${provider}&select=user_id,ciphertext,base_url`,
    {
      headers: { apikey: pk, Authorization: authHeader },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!r.ok) throw new Error("Credential lookup failed");
  const rows = (await r.json()) as {
    user_id: string;
    ciphertext: string;
    base_url: string | null;
  }[];
  if (!rows[0]) return null;
  return {
    key: await decryptKey(rows[0].ciphertext, { userId: rows[0].user_id, provider }),
    baseUrl: rows[0].base_url,
  };
}
export interface Upstream {
  base: string;
  headers: Record<string, string>;
}
export function upstreamFor(provider: KeyProvider, key: string, baseUrl?: string | null): Upstream {
  if (!key || key.length > 500 || /[\r\n]/.test(key))
    throw new Error("Invalid provider credential");
  return {
    base: providerBase(provider, baseUrl),
    headers:
      provider === "anthropic"
        ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
        : { Authorization: `Bearer ${key}` },
  };
}
export function nativeModelId(id: string) {
  const i = id.indexOf("/");
  return i < 0 ? id : id.slice(i + 1);
}
export async function userUpstream(
  request: Request,
  provider: KeyProvider,
): Promise<Upstream | string> {
  try {
    const ephemeral = request.headers.get("x-provider-key");
    if (ephemeral) return upstreamFor(provider, ephemeral, request.headers.get("x-provider-base"));
    const row = await loadUserKey(request.headers.get("authorization") ?? "", provider);
    if (!row) return `Add your ${PROVIDER_LABEL[provider]} API key in Settings → AI Providers.`;
    return upstreamFor(provider, row.key, row.baseUrl);
  } catch {
    return `Your ${PROVIDER_LABEL[provider]} connection is unavailable. Check encryption configuration and the approved endpoint, then save the key again in Settings → AI Providers.`;
  }
}
