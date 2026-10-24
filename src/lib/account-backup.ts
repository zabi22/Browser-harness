import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { prepareBackupRestore, remapWorkspaceBackup, type BackupData, type BackupFile } from "./backup-data";
import { blobToDataUrl, listFiles, readBlob, writeFile } from "./workspace-fs";

type Table = "conversations" | "messages" | "prompts" | "workspaces" | "skills" | "git_repositories";

async function fetchAll(table: Table, filter?: { col: string; ids: string[] }) {
  const out: any[] = [];
  if (filter && !filter.ids.length) return out;
  for (let from = 0; ; from += 1000) {
    let q: any = supabase.from(table).select("*");
    if (filter) q = q.in(filter.col, filter.ids);
    if (table !== "git_repositories") q = q.order("created_at");
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function collectFiles(workspaceIds: string[]): Promise<BackupFile[]> {
  const out: BackupFile[] = [];
  for (const ws of workspaceIds) for (const f of await listFiles(ws))
    out.push({ workspace_id: ws, path: f.path, mime: f.mime, data: await blobToDataUrl(await readBlob(ws, f.path)) });
  return out;
}

/** Everything the user owns, or one workspace when `workspaceId` is given. */
export async function collectBackup(workspaceId?: string): Promise<BackupData> {
  if (workspaceId) {
    const workspaces = await fetchAll("workspaces", { col: "id", ids: [workspaceId] });
    const conversations = await fetchAll("conversations", { col: "workspace_id", ids: [workspaceId] });
    const messages = await fetchAll("messages", { col: "conversation_id", ids: conversations.map((c) => c.id) });
    const git = await fetchAll("git_repositories", { col: "workspace_id", ids: [workspaceId] });
    return { kind: "workspace", workspaces, conversations, messages, git, prompts: [], files: await collectFiles([workspaceId]), settings: null };
  }
  const [workspaces, conversations, messages, prompts, skills, git, settings] = await Promise.all([
    fetchAll("workspaces"), fetchAll("conversations"), fetchAll("messages"), fetchAll("prompts"),
    fetchAll("skills"), fetchAll("git_repositories"), supabase.from("studio_settings").select("data").maybeSingle(),
  ]);
  if (settings.error) throw new Error(settings.error.message);
  return { kind: "account", workspaces, conversations, messages, prompts, skills, git,
    files: await collectFiles(workspaces.map((w) => w.id)), settings: settings.data?.data ?? null };
}

/** Restores a backup. Workspace backups are imported as a fresh copy. */
export async function restoreBackup(input: BackupData) {
  const data = input.kind === "workspace" ? remapWorkspaceBackup(input) : input;
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in before restoring a backup");
  const uid = u.user.id;
  const { data: existing, error: we } = await supabase.from("workspaces").select("*");
  if (we) throw new Error(we.message);
  const r = prepareBackupRestore(data, uid, existing ?? []);
  const up = async (table: Table, rows: any[]) => {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from(table).upsert(rows.slice(i, i + 200));
      if (error) throw new Error(error.message);
    }
  };
  await up("workspaces", r.workspaces);
  await up("conversations", r.conversations);
  // Insert IDs before branch links; timestamps do not guarantee parent order.
  await up("messages", r.messages.map((row) => ({ ...row, parent_id: null })));
  await up("messages", r.messages);
  await up("prompts", r.prompts);
  await up("skills", r.skills);
  await up("git_repositories", r.git);
  for (const f of r.files) await writeFile(f.workspace_id, f.path, await (await fetch(f.data)).blob(), f.mime);
  if (data.settings) {
    const { error } = await supabase.from("studio_settings").upsert({ user_id: uid, data: data.settings as Json });
    if (error) throw new Error(error.message);
  }
  return { workspaces: r.workspaces.length, chats: r.conversations.length, files: r.files.length, workspaceId: r.workspaces[0]?.id };
}
