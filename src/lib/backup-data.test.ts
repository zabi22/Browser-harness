import { describe, expect, it } from "vitest";
import { prepareBackupRestore, type BackupData } from "./backup-data";

const chat = {
  id: "chat", user_id: "previous-owner", workspace_id: "missing-workspace",
  title: "Saved chat", current_leaf_id: "reply", agent_settings: {},
  created_at: "2026-10-19T09:33:00Z", updated_at: "2026-10-19T09:33:00Z",
};
const backup: BackupData = { conversations: [chat], messages: [], prompts: [], settings: null };

describe("backup workspace restoration", () => {
  it("creates missing legacy workspace rows and preserves chat links", () => {
    const result = prepareBackupRestore(backup, "current-owner", []);
    expect(result.workspaces).toEqual([{
      id: "missing-workspace", user_id: "current-owner", name: "Restored workspace", created_at: chat.created_at,
    }]);
    expect(result.conversations[0]).toMatchObject({ workspace_id: result.workspaces[0]?.id, current_leaf_id: "reply", user_id: "current-owner" });
  });
  it("preserves existing names and deduplicates shared workspace references", () => {
    const existing = { id: "missing-workspace", name: "My workspace", user_id: "current-owner", created_at: chat.created_at };
    expect(prepareBackupRestore({ ...backup, conversations: [chat, { ...chat, id: "chat-2" }] }, "current-owner", [existing]).workspaces).toEqual([existing]);
  });
  it("restores workspace metadata including empty workspaces under the current owner", () => {
    const workspace = { id: "empty", name: "Research", user_id: "previous-owner", created_at: chat.created_at };
    expect(prepareBackupRestore({ ...backup, workspaces: [workspace] }, "current-owner", []).workspaces).toContainEqual({ ...workspace, user_id: "current-owner" });
  });
  it("keeps chats without a workspace unattached", () => {
    const result = prepareBackupRestore({ ...backup, conversations: [{ ...chat, workspace_id: null }] }, "current-owner", []);
    expect(result.workspaces).toEqual([]);
    expect(result.conversations[0]?.workspace_id).toBeNull();
  });
});
describe("workspace backup import", () => {
  it("creates a fresh copy with consistent links", async () => {
    const { remapWorkspaceBackup } = await import("./backup-data");
    let n = 0;
    const ws = { id: "w", name: "Lab", user_id: "u", created_at: chat.created_at };
    const msg = (id: string, parent_id: string | null) => ({ id, parent_id, conversation_id: "chat", user_id: "u", role: "user", content: "", attachments: [], model: null, created_at: chat.created_at });
    const out = remapWorkspaceBackup({ kind: "workspace", workspaces: [ws], conversations: [{ ...chat, workspace_id: "w" }], messages: [msg("q", null), msg("reply", "q")], prompts: [], settings: null,
      files: [{ workspace_id: "w", path: "a.txt", mime: "text/plain", data: "" }] }, () => `n${n++}`);
    const w = out.workspaces![0]!; const c = out.conversations[0]!;
    expect(w.id).not.toBe("w");
    expect(c.workspace_id).toBe(w.id);
    expect(c.current_leaf_id).toBe(out.messages[1]!.id);
    expect(out.messages[1]!.parent_id).toBe(out.messages[0]!.id);
    expect(out.messages.every((m) => m.conversation_id === c.id)).toBe(true);
    expect(out.files![0]!.workspace_id).toBe(w.id);
  });
});
