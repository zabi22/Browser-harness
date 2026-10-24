// Workspace filesystem: file bytes in the private "workspace-files" bucket, an index row per file in workspace_files.
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "workspace-files";
export interface WsFile { id: string; path: string; size: number; mime: string; updated_at: string }
export interface WorkspaceRow { id: string; name: string; created_at: string }

export function normPath(p: string) {
  const parts: string[] = [];
  for (const seg of String(p ?? "").replace(/\\/g, "/").replace(/^\/?workspace\/?/, "").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop(); else parts.push(seg);
  }
  const out = parts.join("/");
  if (!out) throw new Error("A file path is required");
  return out;
}

const TEXT_EXT = /\.(txt|md|markdown|json|ya?ml|toml|csv|tsv|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|bash|zsh|sql|ini|cfg|conf|env|log|svg|tex|r|lua|swift|vue|svelte)$/i;
export function guessMime(path: string, fallback = "") {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const img: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", pdf: "application/pdf" };
  if (img[ext]) return img[ext];
  if (TEXT_EXT.test(path) || !path.includes(".")) return "text/plain";
  return fallback || "application/octet-stream";
}
export const isTextMime = (m: string) => m.startsWith("text/") || /json|xml|javascript|svg/.test(m);

async function uid() {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("Not signed in");
  return id;
}
const key = (u: string, ws: string, path: string) => `${u}/${ws}/${path}`;

export async function listFiles(ws: string): Promise<WsFile[]> {
  const { data, error } = await supabase.from("workspace_files").select("id, path, size, mime, updated_at").eq("workspace_id", ws).order("path");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function writeFile(ws: string, path: string, content: string | Blob, mime?: string) {
  const p = normPath(path);
  const blob = typeof content === "string" ? new Blob([content], { type: mime ?? guessMime(p) }) : content;
  const type = mime ?? (blob.type || guessMime(p));
  const media = /^(image|video)\//.test(type);
  if (blob.size > (media ? 1_000_000_000 : 25_000_000))
    throw new Error(`${p} is larger than ${media ? "1 GB" : "25 MB"}`);
  const u = await uid();
  const { error } = await supabase.storage.from(BUCKET).upload(key(u, ws, p), blob, { upsert: true, contentType: type });
  if (error) throw new Error(error.message);
  const { error: e2 } = await supabase.from("workspace_files").upsert({ workspace_id: ws, path: p, size: blob.size, mime: type, updated_at: new Date().toISOString() }, { onConflict: "workspace_id,path" });
  if (e2) throw new Error(e2.message);
  return p;
}

export async function readBlob(ws: string, path: string): Promise<Blob> {
  const p = normPath(path);
  const u = await uid();
  // Immediate re-reads after an upsert can serve briefly stale content at the
  // storage edge (read-after-write is not guaranteed). A unique query param
  // busts the cache so every read hits the origin for the latest bytes.
  const key = [u, ws, ...p.split("/")].map(encodeURIComponent).join("/");
  const { data: session } = await supabase.auth.getSession();
  const url = import.meta.env["VITE_SUPABASE_URL"] as string;
  const apiKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string;
  const res = await fetch(
    `${url}/storage/v1/object/authenticated/${BUCKET}/${key}?v=${crypto.randomUUID()}`,
    {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${session.session?.access_token ?? ""}`,
      },
      cache: "no-store",
    },
  );
  if (!res.ok) throw new Error(`No such file: ${p}`);
  return await res.blob();
}
export const readText = async (ws: string, path: string) => (await readBlob(ws, path)).text();

export async function removeFile(ws: string, path: string) {
  const p = normPath(path);
  const u = await uid();
  // Removing a folder removes everything under it.
  const files = (await listFiles(ws)).filter((f) => f.path === p || f.path.startsWith(p + "/"));
  if (!files.length) throw new Error(`No such file: ${p}`);
  await supabase.storage.from(BUCKET).remove(files.map((f) => key(u, ws, f.path)));
  const { error } = await supabase.from("workspace_files").delete().in("id", files.map((f) => f.id));
  if (error) throw new Error(error.message);
  return files.length;
}

export async function renameFile(ws: string, from: string, to: string) {
  const a = normPath(from), b = normPath(to);
  const u = await uid();
  const { error } = await supabase.storage.from(BUCKET).move(key(u, ws, a), key(u, ws, b));
  if (error) throw new Error(error.message);
  const { error: e2 } = await supabase.from("workspace_files").update({ path: b, updated_at: new Date().toISOString() }).eq("workspace_id", ws).eq("path", a);
  if (e2) throw new Error(e2.message);
}

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
}

/** Workspaces: make sure the user has at least one. Single-flight so concurrent callers never create duplicate "Default" rows. */
let loadingWorkspaces: Promise<WorkspaceRow[]> | null = null;
export function loadWorkspaces(): Promise<WorkspaceRow[]> {
  return (loadingWorkspaces ??= loadWorkspacesInner().finally(() => { loadingWorkspaces = null; }));
}
async function loadWorkspacesInner(): Promise<WorkspaceRow[]> {
  const select = () => supabase.from("workspaces").select("id, name, created_at").order("created_at");
  const { data, error } = await select();
  if (error) throw new Error(error.message);
  if (data?.length) return [...new Map(data.map((w) => [w.id, w])).values()];
  const { error: e2 } = await supabase.from("workspaces").insert({ name: "Default" });
  // Another tab may have created it first; either way, re-read the canonical list.
  const again = await select();
  if (again.error) throw new Error(again.error.message);
  if (again.data?.length) return [...new Map(again.data.map((w) => [w.id, w])).values()];
  throw new Error(e2?.message ?? "Could not create a workspace");
}

// Linux is shared by workspace; cloud files move only through explicit pull/push.
export async function runShell(_sessionId: string, ws: string, command: string, signal?: AbortSignal, timeout=120) {
  const {linuxFor}=await import('./linux-environment');
  return linuxFor(ws).exec(command,signal,timeout);
}
export async function pullShell(ws:string) {
  const {linuxFor}=await import('./linux-environment');const env=linuxFor(ws);
  const quote=(p:string)=>"'"+p.replace(/'/g,"'\\''")+"'";
  let count=0;
  for(const f of await listFiles(ws)){const p='/workspace/'+normPath(f.path);await env.exec('mkdir -p '+quote(p.slice(0,p.lastIndexOf('/'))));await env.write(p,new Uint8Array(await (await readBlob(ws,f.path)).arrayBuffer()));count++;}
  return `Pulled ${count} cloud files into Linux /workspace. Existing Linux-only files were preserved.`;
}
export async function syncShell(_sessionId: string, ws: string) {
  const {linuxFor}=await import('./linux-environment');const env=linuxFor(ws);
  // /tmp is guest-mounted; host9p reads must use the shared root filesystem.
  const index='/obh-paths-'+crypto.randomUUID()+'.json';
  let paths:string[];
  try {
    await env.exec("python3 - <<'PY'\nimport os,json\npaths=[]\nfor root,dirs,files in os.walk('/workspace'):\n for name in files:\n  p=os.path.join(root,name)\n  if not os.path.islink(p): paths.append(p)\nopen("+JSON.stringify(index)+",'w').write(json.dumps(paths))\nPY");
    paths=JSON.parse(new TextDecoder().decode(await env.read(index))) as string[];
  } finally { await env.exec("rm -f '"+index+"'"); }
  for(const p of paths){if(!p.startsWith('/workspace/'))throw new Error('Path outside workspace');const bytes=await env.read(p);await writeFile(ws,p.slice(11),new Blob([bytes.slice().buffer]));}
  return `Pushed ${paths.length} Linux files to cloud. Cloud-only files were preserved.`;
}
export function resetShell(_sessionId: string) { /* Manual cloud edits do not reboot Linux. */ }
