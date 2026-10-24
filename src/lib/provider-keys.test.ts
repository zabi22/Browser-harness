// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  encryptKey,
  decryptKey,
  upstreamFor,
  loadUserKey,
  encryptionConfigured,
} from "./provider-keys.server";
const owner = { userId: "user-a", provider: "openai" as const };
beforeEach(() => {
  vi.stubEnv("PROVIDER_KEY_SECRET", "test-only-encryption-secret-with-32-characters");
  vi.stubEnv("PROVIDER_KEY_ID", "test-v1");
  vi.stubEnv("PROVIDER_KEY_PREVIOUS_SECRETS", "{}");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("provider credential encryption", () => {
  it("uses randomized authenticated encryption and never stores the plaintext", async () => {
    const one = await encryptKey("dummy-provider-credential", owner),
      two = await encryptKey("dummy-provider-credential", owner);
    expect(one).not.toBe(two);
    expect(one).not.toContain("dummy-provider-credential");
    expect(await decryptKey(one, owner)).toBe("dummy-provider-credential");
    await expect(decryptKey(one, { ...owner, userId: "user-b" })).rejects.toThrow();
    await expect(decryptKey(one, { ...owner, provider: "anthropic" })).rejects.toThrow();
    const parts = one.split(".");
    parts[3] = "AAAA" + parts[3]!.slice(4);
    await expect(decryptKey(parts.join("."), owner)).rejects.toThrow();
  });
  it("retains old keys during rotation and encrypts new writes with the current key", async () => {
    const previous = process.env["PROVIDER_KEY_SECRET"]!;
    const stored = await encryptKey("dummy", owner);
    vi.stubEnv("PROVIDER_KEY_ID", "test-v2");
    vi.stubEnv("PROVIDER_KEY_SECRET", "another-test-only-secret-at-least-32-characters");
    vi.stubEnv("PROVIDER_KEY_PREVIOUS_SECRETS", JSON.stringify({ "test-v1": previous }));
    expect(await decryptKey(stored, owner)).toBe("dummy");
    expect(await encryptKey("new", owner)).toMatch(/^v2\.test-v2\./);
    vi.stubEnv("PROVIDER_KEY_PREVIOUS_SECRETS", "{}");
    await expect(decryptKey(stored, owner)).rejects.toThrow();
  });
  it("reads legacy ciphertext without changing stored rows", async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(process.env["PROVIDER_KEY_SECRET"]!),
      ),
      "AES-GCM",
      false,
      ["encrypt"],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode("legacy-dummy"),
      ),
    );
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
    expect(await decryptKey(`${b64(iv)}.${b64(ct)}`, owner)).toBe("legacy-dummy");
  });
  it("fails closed with absent/weak encryption configuration", async () => {
    vi.stubEnv("PROVIDER_KEY_SECRET", "");
    expect(encryptionConfigured()).toBe(false);
    await expect(encryptKey("dummy", owner)).rejects.toThrow();
    vi.stubEnv("PROVIDER_KEY_SECRET", "weak");
    expect(encryptionConfigured()).toBe(false);
  });
  it("looks up keys with caller authentication and never a service-role header", async () => {
    vi.stubEnv("SUPABASE_URL", "https://database.example.com");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-public-key");
    const ciphertext = await encryptKey("dummy-provider-credential", owner);
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json([{ user_id: owner.userId, ciphertext, base_url: null }]));
    vi.stubGlobal("fetch", fetcher);
    expect(await loadUserKey("Bearer dummy-user-session", "openai")).toMatchObject({
      key: "dummy-provider-credential",
    });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      headers: { Authorization: "Bearer dummy-user-session", apikey: "test-public-key" },
    });
    expect(await loadUserKey("", "openai")).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects credential header injection and unapproved destinations", () => {
    expect(() => upstreamFor("custom", "dummy", "https://127.0.0.1/v1")).toThrow();
    expect(() => upstreamFor("openai", "dummy\r\nInjected: value")).toThrow();
    expect(upstreamFor("ollama-cloud", "dummy").base).toBe("https://ollama.com/v1");
  });
});
