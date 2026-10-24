// Browser-safe model registry shared by the studio UI and the internal proxy.
import {
  type Provider,
  type ModelCapabilities,
  UNKNOWN_CAPABILITIES,
  isCompatibleProvider,
} from "./providers";
export type { Provider } from "./providers";

export interface ModelDef {
  id: string;
  label: string;
  provider: Provider;
  /** Whether the model accepts temperature. */
  temperature: boolean;
  /** Whether the model accepts frequency/presence penalties. */
  penalties: boolean;
  /** Approximate context window in tokens (used for the context meter). */
  context: number;
  maxOutput?: number;
  capabilities?: ModelCapabilities;
  pricing?: "free" | "paid" | "local" | "unknown";
  promptPrice?: number;
  completionPrice?: number;
  discovered?: boolean;
}

export type ThinkingEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
/** Ordered from lightest to heaviest; names match each provider's own wire values. */
export const THINKING_EFFORTS: ThinkingEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Effort levels each model's endpoint accepted in live gateway tests (names are the native parameter values). */
export function effortsFor(id: string): ThinkingEffort[] {
  if (id === "anthropic/claude-haiku-4-5") return ["low", "medium", "high"]; // token-budget thinking
  if (id.startsWith("openai/") || id.startsWith("anthropic/"))
    return ["low", "medium", "high", "xhigh", "max"];
  if (id === "google/gemini-3.8-flash") return ["minimal", "low", "medium", "high"];
  return ["low", "medium", "high"]; // Gemini thinking_level
}

/** Only options verified against the model's actual gateway endpoint are exposed. */
export function thinkingCapabilities(id: string) {
  const model = discoveredModels.get(id);
  if (model || /^(custom|openrouter|ollama|ollama-cloud)\//.test(id))
    return {
      canDisable: true,
      mode: "compatible",
      efforts: [] as ThinkingEffort[],
    } as const;
  return {
    canDisable: [
      "openai/gpt-6-sol",
      "openai/gpt-6-luna",
      "openai/gpt-5.6-sol",
      "anthropic/claude-opus-5",
      "anthropic/claude-sonnet-5",
      "anthropic/claude-haiku-4-5",
    ].includes(id),
    mode:
      id === "anthropic/claude-haiku-4-5"
        ? "budget"
        : id.startsWith("anthropic/")
          ? "adaptive"
          : id.startsWith("google/")
            ? "gemini"
            : "responses",
    efforts: effortsFor(id),
  } as const;
}

/** Unsupported saved efforts snap to the nearest supported level at or below them (else the lightest). */
export function resolveThinking(id: string, thinking = true, effort: string = "low") {
  const capabilities = thinkingCapabilities(id);
  const list = capabilities.efforts;
  const rank = THINKING_EFFORTS.indexOf(effort as ThinkingEffort);
  const resolved =
    rank < 0
      ? list.includes("low")
        ? "low"
        : list[0]!
      : ([...list].reverse().find((e) => THINKING_EFFORTS.indexOf(e) <= rank) ?? list[0]!);
  return {
    ...capabilities,
    enabled: list.length > 0 && (!capabilities.canDisable || thinking),
    effort: resolved ?? "low",
  };
}

export const MODELS: ModelDef[] = [
  {
    id: "openai/gpt-6-astra",
    label: "GPT-6 Astra",
    provider: "openai",
    temperature: false,
    penalties: false,
    context: 400_000,
  },
  {
    id: "openai/gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    provider: "openai",
    temperature: false,
    penalties: false,
    context: 400_000,
  },
  {
    id: "openai/gpt-6-sol",
    label: "GPT-6 Sol",
    provider: "openai",
    temperature: false,
    penalties: false,
    context: 400_000,
  },
  {
    id: "openai/gpt-6-luna",
    label: "GPT-6 Luna",
    provider: "openai",
    temperature: false,
    penalties: false,
    context: 400_000,
  },
  {
    id: "openai/gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    provider: "openai",
    temperature: false,
    penalties: false,
    context: 400_000,
  },
  {
    id: "anthropic/claude-fable-5-1",
    label: "Claude Fable 5.1",
    provider: "anthropic",
    temperature: false,
    penalties: false,
    context: 200_000,
  },
  {
    id: "anthropic/claude-opus-5-5",
    label: "Claude Opus 5.5",
    provider: "anthropic",
    temperature: false,
    penalties: false,
    context: 200_000,
  },
  {
    id: "anthropic/claude-opus-5",
    label: "Claude Opus 5",
    provider: "anthropic",
    temperature: false,
    penalties: false,
    context: 200_000,
  },
  {
    id: "anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5",
    provider: "anthropic",
    temperature: false,
    penalties: false,
    context: 200_000,
  },
  {
    id: "anthropic/claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    temperature: false,
    penalties: false,
    context: 200_000,
  },
  {
    id: "google/gemini-4-argon",
    label: "Gemini 4 Argon",
    provider: "google",
    temperature: true,
    penalties: false,
    context: 1_000_000,
  },
  {
    id: "google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    provider: "google",
    temperature: true,
    penalties: true,
    context: 1_000_000,
  },
  {
    id: "google/gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    provider: "google",
    temperature: true,
    penalties: false,
    context: 1_000_000,
  },
];

export const DEFAULT_MODEL = "openai/gpt-6-astra";

/** Any OpenAI-compatible model reached with the user's OpenRouter/custom key: "custom/<model id>". */
export const CUSTOM_PREFIX = "custom/";
const discoveredModels = new Map<string, ModelDef>();
export function registerDiscoveredModels(models: ModelDef[]) {
  for (const model of models) discoveredModels.set(model.id, model);
}
export function modelCapabilities(model: ModelDef): ModelCapabilities {
  return (
    model.capabilities ??
    (isCompatibleProvider(model.provider)
      ? UNKNOWN_CAPABILITIES
      : { tools: true, vision: true, reasoning: true, structuredOutput: false })
  );
}
export function getModel(id: string): ModelDef | undefined {
  if (discoveredModels.has(id)) return discoveredModels.get(id);
  if (typeof id === "string" && /^(custom|openrouter|ollama|ollama-cloud)\/.{1,180}$/.test(id)) {
    const provider = id.slice(0, id.indexOf("/")) as Provider;
    return {
      id,
      label: id.slice(id.indexOf("/") + 1),
      provider,
      temperature: true,
      penalties: false,
      context: 0,
      capabilities: UNKNOWN_CAPABILITIES,
      pricing: provider === "ollama" ? "local" : "unknown",
    };
  }
  return MODELS.find((m) => m.id === id);
}

// ---------------------------------------------------------------------------
// Media models. Every entry below was called through the gateway and returned
// output, so the request shape recorded next to it is the one that worked.
// ---------------------------------------------------------------------------

/** Body shape the image endpoint expects for a model. */
export type ImageFormat = "openai" | "gemini-chat" | "generate-content";

export interface ImageModelDef {
  id: string;
  label: string;
  /** Which request body /api/media must build for this model. */
  format: ImageFormat;
  /** Whether the model accepts the OpenAI `quality` field (Gemini shapes do not). */
  quality: boolean;
}

/** "legacy" marks a model the gateway still serves but flags as deprecated. */
export const IMAGE_MODELS: ImageModelDef[] = [
  {
    id: "openai/gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst (quality)",
    format: "openai",
    quality: true,
  },
  {
    id: "openai/gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare (fast)",
    format: "openai",
    quality: true,
  },
  { id: "openai/gpt-image-2", label: "GPT Image 2", format: "openai", quality: true },
  {
    id: "openai/gpt-image-1-mini",
    label: "GPT Image 1 Mini (legacy)",
    format: "openai",
    quality: true,
  },
  {
    id: "google/gemini-3-pro-image",
    label: "Gemini 3 Pro Image",
    format: "gemini-chat",
    quality: false,
  },
  {
    id: "google/gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image (legacy)",
    format: "gemini-chat",
    quality: false,
  },
  {
    id: "google/gemini-3.1-flash-lite-image",
    label: "Gemini 3.1 Flash Lite Image",
    format: "generate-content",
    quality: false,
  },
  {
    id: "google/gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image (legacy)",
    format: "openai",
    quality: true,
  },
];

/** Request family the video endpoint expects: Omni takes Interactions fields, Veo takes instances/parameters. */
export type VideoFamily = "omni" | "veo";

export interface VideoModelDef {
  id: string;
  label: string;
  family: VideoFamily;
  /** Resolutions the model accepts; Veo's 4k is not available on lite. */
  resolutions: string[];
  /** Clip lengths in seconds the model accepts. */
  durations: number[];
}

export const VIDEO_MODELS: VideoModelDef[] = [
  {
    id: "google/gemini-omni-1.1-flash",
    label: "Gemini Omni 1.1 Flash",
    family: "omni",
    resolutions: ["360p", "720p", "1080p"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10],
  },
  {
    id: "google/veo-3.1",
    label: "Veo 3.1",
    family: "veo",
    resolutions: ["720p", "1080p", "4k"],
    durations: [4, 6, 8],
  },
  {
    id: "google/veo-3.1-fast",
    label: "Veo 3.1 Fast",
    family: "veo",
    resolutions: ["720p", "1080p", "4k"],
    durations: [4, 6, 8],
  },
  {
    id: "google/veo-3.1-lite",
    label: "Veo 3.1 Lite",
    family: "veo",
    resolutions: ["720p", "1080p"],
    durations: [4, 6, 8],
  },
];

/** Song generators. Both reply with raw MP3 bytes from /v1/music. */
export interface MusicModelDef {
  id: string;
  label: string;
}

export const MUSIC_MODELS: MusicModelDef[] = [
  { id: "google/lyria-3-clip-preview", label: "Lyria 3 Clip (30 seconds)" },
  { id: "google/lyria-3-pro-preview", label: "Lyria 3 Pro (up to 3 minutes)" },
];

export function getImageModel(id: string): ImageModelDef | undefined {
  return IMAGE_MODELS.find((m) => m.id === id);
}

export function getVideoModel(id: string): VideoModelDef | undefined {
  return VIDEO_MODELS.find((m) => m.id === id);
}

export function getMusicModel(id: string): MusicModelDef | undefined {
  return MUSIC_MODELS.find((m) => m.id === id);
}
