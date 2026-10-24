import { describe, expect, it } from "vitest";
import { buildRequest, makeExtractor } from "./chat-protocol.server";
import { getModel } from "./models";

// Rule: Claude rejects text blocks that are empty or whitespace-only
// ("messages: text content blocks must contain non-whitespace text").
// Empty history entries must translate to non-whitespace placeholders.
describe("anthropic history translation", () => {
  const model = getModel("anthropic/claude-opus-5-5");
  if (!model) throw new Error("Missing test model");
  const build = (messages: Parameters<typeof buildRequest>[0]["messages"]) =>
    (buildRequest({ model: "anthropic/claude-opus-5-5", messages }, model).payload as { messages: { role: string; content: unknown[] }[] }).messages;

  const textOf = (content: unknown[]) => content.filter((b) => (b as { type: string }).type === "text") as { text: string }[];

  it("assistant message with empty content gets a non-whitespace placeholder", () => {
    const msgs = build([{ role: "user", content: "hi" }, { role: "assistant", content: "" }, { role: "user", content: "hello?" }]);
    for (const m of msgs) for (const b of textOf(m.content)) expect(b.text.trim().length).toBeGreaterThan(0);
  });

  it("assistant message with whitespace-only content gets a non-whitespace placeholder", () => {
    const msgs = build([{ role: "user", content: "hi" }, { role: "assistant", content: "  \n " }, { role: "user", content: "hello?" }]);
    for (const m of msgs) for (const b of textOf(m.content)) expect(b.text.trim().length).toBeGreaterThan(0);
  });

  it("empty user message gets a non-whitespace placeholder", () => {
    const msgs = build([{ role: "user", content: "" }]);
    expect(msgs[0]?.content.some((b) => (b as { text: string }).text === "(empty)")).toBe(true);
  });

  it("empty tool result gets a non-whitespace placeholder", () => {
    const msgs = build([
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "search", args: "{}" }] },
      { role: "tool", content: "  ", toolCallId: "t1" },
    ]);
    const tr = msgs.flatMap((m) => m.content).find((b) => (b as { type: string }).type === "tool_result") as { content: string };
    expect(tr.content.trim().length).toBeGreaterThan(0);
  });

  it("image-only user message sends no text block", () => {
    const msgs = build([{ role: "user", content: "", images: ["data:image/png;base64,AAAA"] }]);
    expect(textOf(msgs[0]?.content ?? [])).toHaveLength(0);
    expect(msgs[0]?.content).toHaveLength(1);
  });

  it("assistant message with content and tool calls keeps both, no placeholder", () => {
    const msgs = build([
      { role: "assistant", content: "Let me look.", toolCalls: [{ id: "t1", name: "search", args: "{}" }] },
      { role: "tool", content: "result", toolCallId: "t1" },
    ]);
    const a = msgs[0]?.content ?? [];
    expect(textOf(a).map((b) => b.text)).toEqual(["Let me look."]);
    expect(a.some((b) => (b as { type: string }).type === "tool_use")).toBe(true);
  });
});

// Rule: thinking tokens count against the same output budget as the answer, so a
// cap sized for text-only replies gets eaten by thinking before any text is
// written. With thinking on, the effective budget must be at least the effort floor.
describe("thinking token budget floor", () => {
  const cap = (model: string, params: { maxTokens?: number; thinking?: boolean; thinkingEffort?: string }) => {
    const selected = getModel(model);
    if (!selected) throw new Error("Missing test model");
    const payload = buildRequest({ model, messages: [{ role: "user", content: "hi" }], params }, selected).payload as {
      max_tokens?: number; max_output_tokens?: number;
    };
    return payload.max_tokens ?? payload.max_output_tokens;
  };

  it("raises the budget to the effort floor when thinking is on (anthropic adaptive)", () => {
    expect(cap("anthropic/claude-opus-5-5", { maxTokens: 4096, thinking: true, thinkingEffort: "high" })).toBe(32768);
    expect(cap("anthropic/claude-opus-5-5", { maxTokens: 4096, thinking: true, thinkingEffort: "low" })).toBe(10240);
  });

  it("raises the budget on openai responses and gemini too", () => {
    expect(cap("openai/gpt-6-astra", { maxTokens: 4096, thinking: true, thinkingEffort: "medium" })).toBe(16384);
    expect(cap("google/gemini-3.8-flash", { maxTokens: 4096, thinking: true, thinkingEffort: "high" })).toBe(32768);
  });

  it("keeps a user cap above the floor unchanged", () => {
    expect(cap("anthropic/claude-opus-5-5", { maxTokens: 50000, thinking: true, thinkingEffort: "low" })).toBe(50000);
  });

  it("keeps the user's cap when thinking is off", () => {
    expect(cap("anthropic/claude-opus-5", { maxTokens: 4096, thinking: false, thinkingEffort: "high" })).toBe(4096);
  });
});

// Rule: a stream that ends at the token limit must say so instead of silently
// saving a reply with thinking but no text.
describe("truncation surfacing", () => {
  it("anthropic: max_tokens with no text yields an explanatory error", () => {
    const ex = makeExtractor("anthropic");
    ex.step({ type: "content_block_start", index: 0, content_block: { type: "thinking" } });
    ex.step({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } });
    const out = ex.step({ type: "message_delta", delta: { stop_reason: "max_tokens" } });
    expect(out).toEqual([{ truncated: true }]);
  });

  it("anthropic: max_tokens after visible text appends a visible note", () => {
    const ex = makeExtractor("anthropic");
    ex.step({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Partial answer" } });
    const out = ex.step({ type: "message_delta", delta: { stop_reason: "max_tokens" } });
    expect(out).toEqual([{ truncated: true }]);
  });

  it("anthropic: max_tokens after tool calls stays quiet so the loop continues", () => {
    const ex = makeExtractor("anthropic");
    ex.step({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "search" } });
    const toolOut = ex.step({ type: "content_block_stop", index: 0 });
    expect(toolOut[0]?.tool?.id).toBe("t1");
    const out = ex.step({ type: "message_delta", delta: { stop_reason: "max_tokens" } });
    expect(out).toEqual([]);
  });

  it("openai: response.incomplete at max_output_tokens is surfaced", () => {
    const ex = makeExtractor("openai");
    const out = ex.step({ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } });
    expect(out).toEqual([{ truncated: true }]);
  });

  it("gemini: finish_reason length with no text yields an error, with text a note", () => {
    const ex = makeExtractor("google");
    let out = ex.step({ choices: [{ delta: {}, finish_reason: "length" }] });
    expect(out).toEqual([{ truncated: true }]);
    const ex2 = makeExtractor("google");
    ex2.step({ choices: [{ delta: { content: "part" }, finish_reason: null }] });
    out = ex2.step({ choices: [{ delta: {}, finish_reason: "length" }] });
    expect(out).toEqual([{ truncated: true }]);
  });
});

describe("empty reply marker", () => {
  for (const id of ["anthropic/claude-opus-5-5", "openai/gpt-6-astra", "google/gemini-3.8-flash"]) {
    it(`uses [Didn't reply] in ${id} history`, () => {
      const model = getModel(id);
      if (!model) throw new Error("Missing test model");
      const request = buildRequest({ model: id, messages: [{ role: "assistant", content: " \n " }, { role: "user", content: "Continue" }] }, model);
      expect(JSON.stringify(request.payload)).toContain("[Didn't reply]");
    });
  }
  it("never classifies a refusal as truncation", () => {
    expect(makeExtractor("anthropic").step({ type: "message_delta", delta: { stop_reason: "refusal" } }))
      .toEqual([{ error: "The model declined to answer.", refusal: true }]);
  });
});
