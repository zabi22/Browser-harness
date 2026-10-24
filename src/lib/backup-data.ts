import type { Tables } from "@/integrations/supabase/types";

export interface BackupFile {
  workspace_id: string;
  path: string;
  mime: string;
  data: string; /* data URL */
}

export interface BackupData {
  kind?: "account" | "workspace";
  workspaces?: Tables<"workspaces">[];
  conversations: Tables<"conversations">[];
  messages: Tables<"messages">[];
  prompts: Tables<"prompts">[];
  skills?: Tables<"skills">[];
  git?: Tables<"git_repositories">[];
  files?: BackupFile[];
  settings: unknown;
}

/** Legacy backups contain workspace references but omit workspace rows. */
export function prepareBackupRestore(
  data: BackupData,
  userId: string,
  existing: Tables<"workspaces">[],
) {
  const workspaces = new Map(existing.map((row) => [row.id, row]));
  for (const row of data.workspaces ?? []) workspaces.set(row.id, { ...row, user_id: userId });
  for (const chat of data.conversations) {
    if (chat.workspace_id && !workspaces.has(chat.workspace_id)) {
      workspaces.set(chat.workspace_id, {
        id: chat.workspace_id,
        user_id: userId,
        name: "Restored workspace",
        created_at: chat.created_at,
      });
    }
  }
  const own = <T extends { user_id: string }>(rows: T[]) =>
    rows.map((row) => ({ ...row, user_id: userId }));
  const referenced = new Set(data.conversations.map((row) => row.workspace_id));
  const included = new Set((data.workspaces ?? []).map((row) => row.id));
  return {
    workspaces: own(
      [...workspaces.values()].filter((row) => referenced.has(row.id) || included.has(row.id)),
    ),
    conversations: own(data.conversations),
    messages: own(data.messages),
    prompts: own(data.prompts),
    skills: own(data.skills ?? []),
    git: own(data.git ?? []),
    files: data.files ?? [],
  };
}

/** Re-key a single-workspace backup so importing creates a new copy instead of overwriting the original. */
export function remapWorkspaceBackup(
  data: BackupData,
  newId: () => string = () => crypto.randomUUID(),
): BackupData {
  const ids = new Map<string, string>();
  const map = (id: string | null | undefined) => {
    if (!id) return id ?? null;
    if (!ids.has(id)) ids.set(id, newId());
    return ids.get(id)!;
  };
  return {
    ...data,
    workspaces: (data.workspaces ?? []).map((w) => ({
      ...w,
      id: map(w.id)!,
      name: `${w.name} (imported)`,
    })),
    conversations: data.conversations.map((c) => ({
      ...c,
      id: map(c.id)!,
      workspace_id: map(c.workspace_id),
      current_leaf_id: map(c.current_leaf_id),
    })),
    messages: data.messages.map((m) => ({
      ...m,
      id: map(m.id)!,
      conversation_id: map(m.conversation_id)!,
      parent_id: map(m.parent_id),
    })),
    git: (data.git ?? []).map((g) => ({ ...g, id: newId(), workspace_id: map(g.workspace_id)! })),
    files: (data.files ?? []).map((f) => ({ ...f, workspace_id: map(f.workspace_id)! })),
  };
}
