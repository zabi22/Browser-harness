/** Browser-safe provider contracts. Credentials and arbitrary destinations never belong here. */
export const KEY_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "ollama-cloud",
  "custom",
] as const;
export type KeyProvider = (typeof KEY_PROVIDERS)[number];
export type Provider = KeyProvider | "ollama";
export const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  openrouter: "OpenRouter",
  "ollama-cloud": "Ollama Cloud",
  ollama: "Ollama Local",
  custom: "Custom compatible API",
};
export const PROVIDER_BASES: Record<KeyProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  openrouter: "https://openrouter.ai/api/v1",
  "ollama-cloud": "https://ollama.com/v1",
  custom: "https://openrouter.ai/api/v1",
};
export interface ModelCapabilities {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
  structuredOutput: boolean;
}
export const UNKNOWN_CAPABILITIES: ModelCapabilities = {
  tools: false,
  vision: false,
  reasoning: false,
  structuredOutput: false,
};
export const isCompatibleProvider = (provider: Provider) =>
  ["custom", "openrouter", "ollama-cloud", "ollama"].includes(provider);
/** Only the user's own loopback Ollama, never a LAN/public destination or URL credentials. */
export function localOllamaBase(value = "http://localhost:11434") {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/", "/v1", "/v1/"].includes(url.pathname)
  )
    throw new Error("Use a loopback Ollama address such as http://localhost:11434");
  return url.origin;
}
