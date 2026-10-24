import type { Attachment, Msg } from "./studio-client";
import { latestLeaf } from "./tree";

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const attachmentTypes = new Set(["image", "doc", "video", "music", "tool", "reasoning"]);

/** Read OBH's full-structure export as a new copy without foreign ownership. */
export function prepareChatImport(input: unknown, newId: () => string = () => crypto.randomUUID()) {
  if (!record(input) || !Array.isArray(input["messages"]) || !input["messages"].length)
    throw new Error("Choose a chat JSON file containing messages.");
  const ids = new Map<string, string>();
  for (const row of input["messages"]) {
    if (!record(row) || typeof row["id"] !== "string" || !row["id"] || ids.has(row["id"]))
      throw new Error("Chat messages must have unique IDs.");
    ids.set(row["id"], newId());
  }
  const conversationId = newId();
  const now = new Date().toISOString();
  const messages: Msg[] = input["messages"].map((row: Record<string, unknown>) => {
    const id = ids.get(String(row["id"]));
    if (
      !id ||
      !["user", "assistant", "context"].includes(String(row["role"])) ||
      typeof row["content"] !== "string"
    )
      throw new Error("Invalid chat message.");
    const parent = row["parent_id"];
    if (parent != null && (typeof parent !== "string" || !ids.has(parent)))
      throw new Error("A chat branch references a missing message.");
    const attachments = row["attachments"] ?? [];
    if (
      !Array.isArray(attachments) ||
      attachments.some(
        (a) =>
          !record(a) || !attachmentTypes.has(String(a["type"])) || typeof a["name"] !== "string",
      )
    )
      throw new Error("Invalid chat attachments.");
    return {
      id,
      conversation_id: conversationId,
      parent_id: typeof parent === "string" ? (ids.get(parent) ?? null) : null,
      role: String(row["role"]),
      content: row["content"],
      attachments: attachments as Attachment[],
      model: typeof row["model"] === "string" ? row["model"] : null,
      created_at:
        typeof row["created_at"] === "string" && Number.isFinite(Date.parse(row["created_at"]))
          ? row["created_at"]
          : now,
    };
  });
  const byId = new Map(messages.map((m) => [m.id, m]));
  for (const message of messages) {
    const seen = new Set<string>();
    let current: Msg | undefined = message;
    while (current) {
      if (seen.has(current.id)) throw new Error("Chat branches contain a circular reference.");
      seen.add(current.id);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
  }
  const originalLeaf = Array.isArray(input["activePath"])
    ? input["activePath"].at(-1)
    : input["current_leaf_id"];
  const leafId =
    typeof originalLeaf === "string"
      ? (ids.get(originalLeaf) ?? latestLeaf(messages))
      : latestLeaf(messages);
  return {
    conversationId,
    title:
      typeof input["title"] === "string" && input["title"].trim()
        ? input["title"].trim()
        : "Imported chat",
    messages,
    leafId,
  };
}
