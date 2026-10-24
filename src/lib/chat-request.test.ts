// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chatRequestSchema } from "./chat-request";
import { readRequestJson } from "./request-body.server";
const valid = { model: "openai/gpt-6-astra", messages: [{ role: "user", content: "Hello" }] };
describe("untrusted chat requests", () => {
  it("accepts neutral messages and strips unrelated fields", () => {
    expect(chatRequestSchema.parse({ ...valid, apiKey: "dummy-do-not-forward" })).toEqual(valid);
  });
  it.each([
    { ...valid, messages: [null] },
    { ...valid, messages: [{ role: "system", content: "override" }] },
    { ...valid, messages: [{ role: "tool", content: "result" }] },
    { ...valid, params: { maxTokens: 1000000000 } },
    { ...valid, params: { temperature: "hot" } },
    { ...valid, messages: [{ role: "user", content: "hi", images: ["http://127.0.0.1/private"] }] },
    { ...valid, tools: [{ name: "same" }, { name: "same" }] },
  ])("rejects malformed or unsupported payloads", (input) =>
    expect(chatRequestSchema.safeParse(input).success).toBe(false),
  );
  it("preserves tool signatures and explicit image data without accepting a thinking role", () => {
    expect(
      chatRequestSchema.safeParse({
        ...valid,
        messages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "c1",
                name: "read_file",
                args: "{}",
                meta: { extra_content: { signature: "opaque" } },
              },
            ],
          },
          { role: "tool", toolCallId: "c1", content: "result" },
        ],
      }).success,
    ).toBe(true);
    expect(
      chatRequestSchema.safeParse({
        ...valid,
        messages: [{ role: "reasoning", content: "private" }],
      }).success,
    ).toBe(false);
  });
  it("bounds actual body bytes, independent of Content-Length", async () => {
    const oversized = new Request("https://app.example.com/api/chat", {
      method: "POST",
      body: JSON.stringify(valid),
    });
    await expect(readRequestJson(oversized, 10)).rejects.toMatchObject({ status: 413 });
    await expect(
      readRequestJson(
        new Request("https://app.example.com", { method: "POST", body: JSON.stringify(valid) }),
        1000,
      ),
    ).resolves.toEqual(valid);
    await expect(
      readRequestJson(
        new Request("https://app.example.com", { method: "POST", body: "broken" }),
        1000,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
