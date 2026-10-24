import type { ModelDef } from "./models";
import { UNKNOWN_CAPABILITIES, type Provider } from "./providers";
import { z } from "zod";

const openRouterModel = z.object({
  id: z.string().min(1).max(180),
  name: z.string().optional(),
  context_length: z.number().nonnegative().optional(),
  supported_parameters: z.array(z.string()).optional(),
  architecture: z
    .object({
      input_modalities: z.array(z.string()).optional(),
      output_modalities: z.array(z.string()).optional(),
    })
    .optional(),
  top_provider: z
    .object({ max_completion_tokens: z.number().positive().nullable().optional() })
    .optional(),
  pricing: z
    .object({
      prompt: z.string().optional(),
      completion: z.string().optional(),
      request: z.string().optional(),
      image: z.string().optional(),
      web_search: z.string().optional(),
      internal_reasoning: z.string().optional(),
    })
    .passthrough()
    .optional(),
});
export function parseOpenRouterModels(
  value: unknown,
  provider: "openrouter" | "custom" = "openrouter",
): ModelDef[] {
  const data = z.object({ data: z.array(z.unknown()).max(10000) }).parse(value);
  return data.data.flatMap((raw) => {
    const result = openRouterModel.safeParse(raw);
    if (!result.success) return [];
    const m = result.data;
    if (m.architecture?.output_modalities && !m.architecture.output_modalities.includes("text"))
      return [];
    const params = new Set(m.supported_parameters ?? []);
    const numberPrice = (v: unknown) =>
      typeof v === "string" && v.trim() && Number.isFinite(Number(v)) && Number(v) >= 0
        ? Number(v)
        : undefined;
    const prompt = numberPrice(m.pricing?.prompt),
      completion = numberPrice(m.pricing?.completion);
    // A :free suffix alone is not proof of zero billing. Every returned price must be known and zero.
    const free =
      prompt === 0 &&
      completion === 0 &&
      Object.values(m.pricing ?? {}).every((v) => numberPrice(v) === 0);
    return [
      {
        id: `${provider}/${m.id}`,
        label: m.name || m.id,
        provider,
        context: m.context_length ?? 0,
        temperature: params.has("temperature"),
        penalties: params.has("frequency_penalty") || params.has("presence_penalty"),
        ...(m.top_provider?.max_completion_tokens
          ? { maxOutput: m.top_provider.max_completion_tokens }
          : {}),
        capabilities: {
          tools: params.has("tools"),
          vision: m.architecture?.input_modalities?.includes("image") ?? false,
          reasoning: params.has("reasoning"),
          structuredOutput: params.has("response_format") || params.has("structured_outputs"),
        },
        pricing: free
          ? ("free" as const)
          : prompt !== undefined && completion !== undefined
            ? ("paid" as const)
            : ("unknown" as const),
        ...(prompt !== undefined ? { promptPrice: prompt } : {}),
        ...(completion !== undefined ? { completionPrice: completion } : {}),
        discovered: true,
      },
    ];
  });
}
export function parseCompatibleModels(value: unknown, provider: Provider): ModelDef[] {
  const result = z
    .object({ data: z.array(z.object({ id: z.string().min(1).max(180) })).max(10000) })
    .parse(value);
  return result.data.map((m) => ({
    id: `${provider}/${m.id}`,
    label: m.id,
    provider,
    temperature: true,
    penalties: false,
    context: 0,
    capabilities: UNKNOWN_CAPABILITIES,
    pricing: provider === "ollama" ? "local" : "unknown",
    discovered: true,
  }));
}
export function parseOllamaModel(value: unknown, id: string): Partial<ModelDef> {
  const result = z
    .object({
      capabilities: z.array(z.string()).optional(),
      model_info: z.record(z.unknown()).optional(),
      parameters: z.string().optional(),
    })
    .parse(value);
  const caps = new Set(result.capabilities ?? []);
  const context = Object.entries(result.model_info ?? {}).find(
    ([k, v]) => k.endsWith(".context_length") && typeof v === "number",
  )?.[1];
  const configured = /(?:^|\n)\s*num_ctx\s+(\d+)/.exec(result.parameters ?? "")?.[1];
  // Model architecture maximum is not the runtime allocation. Do not advertise it as usable context.
  return {
    id,
    capabilities: {
      tools: caps.has("tools"),
      vision: caps.has("vision"),
      reasoning: caps.has("thinking"),
      structuredOutput: false,
    },
    context: configured
      ? Math.min(Number(configured), typeof context === "number" ? context : Number(configured))
      : 0,
  };
}
