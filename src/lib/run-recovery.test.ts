import { describe, expect, it } from "vitest";
import {
  inactiveAttachments,
  partialReply,
  readRecovery,
  recoveryKey,
  recoveryMessages,
  type RunRecovery,
} from "./run-recovery";
import type { Msg } from "./studio-client";
const draft = {
  id: "reply",
  conversation_id: "chat",
  parent_id: "prompt",
  role: "assistant",
  content: "Partial answer",
  attachments: [
    { type: "reasoning", name: "Thinking", text: "Last calculation" },
    { type: "tool", name: "Write file" },
  ],
  model: "test",
  created_at: "2026-10-19",
} as Msg;
describe("interrupted runs", () => {
  it("keeps every thinking bubble when saving an error before answer text", () => {
    const run: RunRecovery = {
      ownerId: "owner",
      conversationId: "chat",
      updatedAt: "now",
      draft: {
        ...draft,
        content: "",
        attachments: [
          ...draft.attachments,
          { type: "reasoning", name: "Thinking", text: "Second calculation" },
        ],
      },
    };
    const saved = partialReply(run);
    expect(saved.attachments.filter((a) => a.type === "reasoning").map((a) => a.text)).toEqual([
      "Last calculation",
      "Second calculation",
    ]);
    expect(saved.id).toBe("reply");
    expect(run.draft.attachments[1]?.output).toBeUndefined();
    expect(
      recoveryMessages(run.draft).every((m) => !m.content.includes("Second calculation")),
    ).toBe(true);
  });
  it("resumes with the saved answer and last thinking as input, warning about unknown tool outcomes", () => {
    const messages = recoveryMessages(draft);
    expect(messages[0]?.content).toContain("Partial answer");
    expect(messages[0]?.content).not.toContain("Last calculation");
    expect(messages[1]?.content).not.toContain("Last calculation");
    expect(messages[1]?.content).toContain("Check the state of interrupted tool actions");
  });
  it("supports shutdown before the first answer token", () => {
    expect(recoveryMessages({ ...draft, content: "" })[0]?.content).toMatch(/^\[Didn't reply\]/);
  });
  it("restores persisted progress only for its owner and chat", () => {
    const run: RunRecovery = { ownerId: "owner", conversationId: "chat", draft, updatedAt: "now" };
    const storage = {
      getItem: (key: string) => (key === recoveryKey("owner", "chat") ? JSON.stringify(run) : null),
    };
    expect(readRecovery(storage, "owner", "chat")?.draft.content).toBe("Partial answer");
    expect(readRecovery(storage, "other", "chat")).toBeNull();
    expect(readRecovery(storage, "owner", "other")).toBeNull();
    expect(readRecovery({ getItem: () => "{" }, "owner", "chat")).toBeNull();
  });
  it("ends interrupted tool waiting states without dropping reasoning", () => {
    const attachments = inactiveAttachments(draft.attachments);
    expect(attachments[1]?.output).toBe("Interrupted; outcome unknown.");
    expect(attachments[0]?.text).toBe("Last calculation");
    expect(draft.attachments[1]?.output).toBeUndefined();
  });
  it("keeps intentional pause distinct and restores its saved progress", () => {
    const run: RunRecovery = {
      ownerId: "owner",
      conversationId: "chat",
      draft,
      updatedAt: "now",
      reason: "paused",
    };
    const restored = readRecovery({ getItem: () => JSON.stringify(run) }, "owner", "chat");
    expect(restored?.reason).toBe("paused");
    expect(restored?.draft.id).toBe("reply");
    expect(restored ? recoveryMessages(restored.draft)[0]?.content : "").toContain(
      "Partial answer",
    );
  });
});
