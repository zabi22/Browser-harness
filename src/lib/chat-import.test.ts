import { describe, expect, it } from "vitest";
import { prepareChatImport } from "./chat-import";
const input = {
  title: "Physics",
  activePath: ["u", "b"],
  messages: [
    {
      id: "b",
      parent_id: "u",
      role: "assistant",
      content: "Partial",
      attachments: [{ type: "reasoning", name: "Thinking", text: "Calculation" }],
    },
    { id: "u", parent_id: null, role: "user", content: "Question", user_id: "foreign" },
    { id: "a", parent_id: "u", role: "assistant", content: "Alternate" },
  ],
};
describe("chat JSON import", () => {
  it("creates a fresh copy preserving branches, selected path and reasoning", () => {
    let n = 0;
    const result = prepareChatImport(input, () => `new-${++n}`);
    expect(result.conversationId).toBe("new-4");
    expect(result.messages[0]?.parent_id).toBe("new-2");
    expect(result.leafId).toBe("new-1");
    expect(result.messages[0]?.attachments[0]?.text).toBe("Calculation");
    expect(result.messages[1]).not.toHaveProperty("user_id");
    expect(result.messages.every((m) => m.conversation_id === "new-4")).toBe(true);
  });
  it("rejects invalid files and duplicate IDs before saving", () => {
    expect(() => prepareChatImport({ messages: [] })).toThrow();
    expect(() => prepareChatImport({ messages: [input.messages[0], input.messages[0]] })).toThrow(
      /unique IDs/,
    );
  });
  it("rejects missing parents and cycles", () => {
    expect(() => prepareChatImport({ messages: [input.messages[0]] })).toThrow(/missing/);
    expect(() =>
      prepareChatImport({ messages: [{ ...input.messages[1], parent_id: "u" }] }),
    ).toThrow(/circular/);
  });
});
