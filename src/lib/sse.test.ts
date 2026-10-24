// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readSse } from "./sse";
import { streamTerminal } from "./stream-terminal";
const collect = async (body: ReadableStream<Uint8Array>, limit?: number) => {
  const events = [];
  for await (const event of readSse(body, limit)) events.push(event);
  return events;
};
describe("bounded SSE framing", () => {
  it("handles CRLF, comments, multiple data lines and split UTF-8", async () => {
    const encoded = new TextEncoder().encode(
      ': keepalive\r\n\r\ndata: {"d":\r\ndata: "å"}\r\n\r\ndata: [DONE]\r\n\r\n',
    );
    const body = new ReadableStream({
      start(c) {
        for (const byte of encoded) c.enqueue(new Uint8Array([byte]));
        c.close();
      },
    });
    expect(await collect(body)).toEqual(['{"d":\n"å"}', "[DONE]"]);
    expect(body.locked).toBe(false);
  });
  it("does not treat a partial final frame as a completed reply", async () => {
    expect(await collect(new Response("data: [DONE]\n").body!)).toEqual([]);
  });
  it("bounds unframed lines and many-line events", async () => {
    await expect(collect(new Response("data: " + "a".repeat(101)).body!, 100)).rejects.toThrow(
      "size limit",
    );
    await expect(collect(new Response("data: a\n".repeat(30)).body!, 100)).rejects.toThrow(
      "size limit",
    );
  });
  it("cancels the upstream when the consumer stops after a terminal frame", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const event of readSse(body)) {
      expect(event).toBe("[DONE]");
      break;
    }
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });
  it("recognizes provider-native completion without mistaking a delta for completion", () => {
    expect(streamTerminal("openai", { type: "response.completed" })).toBe(true);
    expect(streamTerminal("anthropic", { type: "message_stop" })).toBe(true);
    expect(streamTerminal("openrouter", { choices: [{ finish_reason: "stop" }] })).toBe(true);
    expect(streamTerminal("openai", { type: "response.output_text.delta", delta: "partial" })).toBe(
      false,
    );
    expect(
      streamTerminal("custom", {
        choices: [{ delta: { content: "partial" }, finish_reason: null }],
      }),
    ).toBe(false);
  });
});
