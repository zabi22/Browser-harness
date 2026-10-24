import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const providerSchema = z.enum(["openai", "anthropic", "google", "custom"]);

export const listProviderKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("provider_keys").select("provider, hint, base_url, updated_at");
    if (error) throw new Error("Could not load keys");
    return data ?? [];
  });

export const saveProviderKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    provider: providerSchema,
    key: z.string().trim().min(8).max(500),
    baseUrl: z.string().trim().url().max(300).startsWith("https://").optional().or(z.literal("")),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { encryptKey } = await import("./provider-keys.server");
    const ciphertext = await encryptKey(data.key);
    const hint = "saved";
    const { error } = await context.supabase.from("provider_keys").upsert({
      user_id: context.userId, provider: data.provider, ciphertext, hint,
      base_url: data.provider === "custom" ? data.baseUrl || null : null, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,provider" });
    if (error) throw new Error("Could not save key");
    return { ok: true };
  });

export const deleteProviderKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ provider: providerSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("provider_keys").delete().eq("provider", data.provider);
    if (error) throw new Error("Could not remove key");
    return { ok: true };
  });
