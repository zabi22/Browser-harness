import { describe, expect, it } from "vitest";
import { parseOpenRouterModels, parseCompatibleModels, parseOllamaModel } from "./model-discovery";
import { localOllamaBase } from "./providers";
import { buildRequest } from "./chat-protocol.server";
import { getModel, resolveThinking } from "./models";
describe("provider metadata", () => {
  it("derives free models and capabilities from metadata, never a suffix alone", () => {
    const models = parseOpenRouterModels({
      data: [
        { id: "vendor/paid:free", pricing: { prompt: "0.01", completion: "0.01" } },
        {
          id: "vendor/free",
          pricing: { prompt: "0", completion: "0" },
          context_length: 32768,
          supported_parameters: ["tools", "reasoning"],
          architecture: { input_modalities: ["text", "image"] },
        },
        { id: "unknown:free" },
        { id: "request-fee", pricing: { prompt: "0", completion: "0", request: "1" } },
        { id: "bad-price", pricing: { prompt: "", completion: "0" } },
        { invalid: true },
      ],
    });
    expect(models.map((m) => m.pricing)).toEqual(["paid", "free", "unknown", "paid", "unknown"]);
    expect(models[1]).toMatchObject({
      context: 32768,
      capabilities: { tools: true, vision: true, reasoning: true, structuredOutput: false },
    });
  });
  it("keeps unknown compatible model context and capabilities unknown", () => {
    expect(parseCompatibleModels({ data: [{ id: "model" }] }, "ollama-cloud")[0]).toMatchObject({
      context: 0,
      pricing: "unknown",
      capabilities: { tools: false },
    });
    expect(
      parseOllamaModel(
        { capabilities: ["tools"], model_info: { "llama.context_length": 131072 } },
        "ollama/model",
      ),
    ).toMatchObject({ context: 0, capabilities: { tools: true } });
  });
  it("does not send Gemini-specific request fields to compatible providers", () => {
    for (const id of ["custom/vendor/model", "openrouter/vendor/model", "ollama-cloud/model"]) {
      const model = getModel(id)!;
      expect(
        buildRequest({ model: id, messages: [{ role: "user", content: "Hello" }] }, model).payload,
      ).not.toHaveProperty("extra_body");
      expect(resolveThinking(id).enabled).toBe(false);
    }
  });
  it("accepts only explicit loopback Ollama addresses", () => {
    expect(localOllamaBase("http://localhost:11434/v1")).toBe("http://localhost:11434");
    for (const url of [
      "http://192.168.1.2:11434",
      "https://example.com",
      "http://user:pass@localhost:11434",
      "http://localhost:11434/private",
    ])
      expect(() => localOllamaBase(url)).toThrow();
  });
});
