import { describe, expect, it } from "vitest";
import { MODELS, getModel, resolveThinking, THINKING_EFFORTS } from "./models";
import { buildRequest } from "./chat-protocol.server";

function payload(id: string, thinking: boolean, thinkingEffort: string, maxTokens = 8192) {
  const model = getModel(id);
  if (!model) throw new Error("Missing model");
  return buildRequest(
    {
      model: id,
      messages: [{ role: "user", content: "Hello" }],
      params: { thinking, thinkingEffort, maxTokens, temperature: 0.7, frequencyPenalty: 0.2 },
    },
    model,
  ).payload;
}

describe("model-specific thinking controls", () => {
  it.each(MODELS.filter((m) => !resolveThinking(m.id).canDisable))(
    "$id keeps mandatory thinking enabled",
    (model) => {
      expect(resolveThinking(model.id, false).enabled).toBe(true);
    },
  );
  it.each([
    "openai/gpt-6-sol",
    "openai/gpt-6-luna",
    "openai/gpt-5.6-sol",
    "anthropic/claude-opus-5",
    "anthropic/claude-sonnet-5",
    "anthropic/claude-haiku-4-5",
  ])("%s honors thinking off", (id) => {
    expect(resolveThinking(id, false).enabled).toBe(false);
    expect(payload(id, false, "high")).toMatchObject(
      id.startsWith("openai/")
        ? { reasoning: { effort: "none" } }
        : { thinking: { type: "disabled" } },
    );
  });
  it.each(["low", "medium", "high", "xhigh", "max"])(
    "adaptive Claude uses %s effort, not legacy enabled thinking",
    (effort) => {
      for (const id of [
        "anthropic/claude-fable-5-1",
        "anthropic/claude-opus-5-5",
        "anthropic/claude-opus-5",
        "anthropic/claude-sonnet-5",
      ]) {
        expect(payload(id, true, effort)).toMatchObject({
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort },
        });
      }
    },
  );
  it.each(["low", "medium", "high", "xhigh", "max"])(
    "GPT models send %s effort natively",
    (effort) => {
      expect(payload("openai/gpt-6-astra", true, effort)).toMatchObject({
        reasoning: { effort, summary: "auto" },
      });
    },
  );
  it("Astra tops out at max, Gemini at high, Flash offers minimal", () => {
    expect(resolveThinking("openai/gpt-6-astra").efforts).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(resolveThinking("google/gemini-4-argon", true, "max").effort).toBe("high");
    expect(resolveThinking("google/gemini-3.8-flash").efforts[0]).toBe("minimal");
    expect(resolveThinking("openai/gpt-6-astra", true, "minimal").effort).toBe("low");
  });
  it.each(["low", "medium", "high"])("Gemini receives %s effort in its native field", (effort) => {
    expect(payload("google/gemini-3.8-flash", true, effort)).toMatchObject({
      extra_body: {
        google: { thinking_config: { thinking_level: effort, include_thoughts: true } },
      },
    });
  });
  it("Haiku budgets remain below output cap, including legacy small caps", () => {
    expect(payload("anthropic/claude-haiku-4-5", true, "high", 256)).toMatchObject({
      max_tokens: 2048,
      thinking: { type: "enabled", budget_tokens: 1024 },
    });
    expect(payload("anthropic/claude-haiku-4-5", true, "max", 8192)).toMatchObject({
      thinking: { budget_tokens: 4096 },
    });
  });
  it("unsupported and stale effort values normalize safely", () => {
    expect(resolveThinking("openai/gpt-6-astra", false, "none")).toMatchObject({
      enabled: true,
      effort: "low",
    });
  });
  it("unsupported sampling arguments stay out of requests", () => {
    expect(payload("openai/gpt-6-astra", true, "low")).not.toHaveProperty("temperature");
    expect(payload("google/gemini-3.8-flash", true, "low")).not.toHaveProperty("frequency_penalty");
  });
});
