export const API_KEY_PREFIX = "sk_lovable_";

/** 32 random bytes, hex-encoded, behind the fixed prefix. Call only inside handlers. */
export function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return API_KEY_PREFIX + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashApiKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
