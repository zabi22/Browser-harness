import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { supabase } from "@/integrations/supabase/client";
import { listFiles, readBlob, writeFile } from "./workspace-fs";
import { repoFs, bytesTo64, from64, type RepoData } from "./git-fs";
import { sha256 } from "./disk-codec";
export interface Repository {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  data: RepoData;
  revision: string;
  updated_at: string;
}
export const listRepos = async (ws: string) => {
  const { data, error } = await supabase
    .from("git_repositories")
    .select("*")
    .eq("workspace_id", ws)
    .order("name");
  if (error) throw error;
  return (data ?? []) as unknown as Repository[];
};
export async function getRepo(id: string) {
  const { data, error } = await supabase.from("git_repositories").select("*").eq("id", id).single();
  if (error) throw error;
  return data as unknown as Repository;
}
export async function createRepo(ws: string, name: string, description = "") {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name))
    throw new Error("Use letters, numbers, hyphens or underscores");
  const data: RepoData = {};
  await git.init({ fs: repoFs(data), dir: "/", defaultBranch: "main" });
  const { data: row, error } = await supabase
    .from("git_repositories")
    .insert({ workspace_id: ws, name, description, data: data as never })
    .select("*")
    .single();
  if (error) throw error;
  return row as unknown as Repository;
}
export async function saveRepo(repo: Repository) {
  if (JSON.stringify(repo.data).length > 12_000_000)
    throw new Error("Repository exceeds the 12 MB small-repository limit");
  const revision = crypto.randomUUID();
  const { data, error } = await supabase
    .from("git_repositories")
    .update({ data: repo.data as never, revision, updated_at: new Date().toISOString() })
    .eq("id", repo.id)
    .eq("revision", repo.revision)
    .select("id")
    .maybeSingle();
  if (error || !data)
    throw new Error("Repository changed in another tab. Pull again before pushing.");
  repo.revision = revision;
}
export const CLONE_TOKEN_TTL_MS=300000;
export const cloneExpiry=(now:number)=>new Date(now+CLONE_TOKEN_TTL_MS).toISOString();
export async function repoOperation(
  ws: string,
  name: string,
  action: string,
  args: Record<string, unknown> = {},
) {
  if (action === "init") {
    const r = await createRepo(ws, name, String(args["description"] ?? ""));
    return `Created ${r.name} (${r.id})`;
  }
  const repo = (await listRepos(ws)).find((r) => r.name === name);
  if (!repo) throw new Error("Repository not found");
  const fs = repoFs(repo.data),
    dir = "/";
  switch (action) {
    case "status":
      return JSON.stringify(await git.statusMatrix({ fs, dir }));
    case "log":
      return JSON.stringify(await git.log({ fs, dir, depth: 20 }).catch(() => []));
    case "branch":
      await git.branch({ fs, dir, ref: String(args["branch"] ?? "main"), checkout: true });
      break;
    case "checkout":
      await git.checkout({ fs, dir, ref: String(args["branch"] ?? "main") });
      break;
    case "commit": {
      const prefix = String(args["prefix"] ?? "");
      const files = await listFiles(ws);
      const selected=new Set(files.filter(f=>!prefix||f.path.startsWith(prefix)).map(f=>prefix?f.path.slice(prefix.length).replace(/^\//,''):f.path));
      for(const p of await git.listFiles({fs,dir})){
        if(!selected.has(p)){await git.remove({fs,dir,filepath:p});await fs.promises.unlink('/'+p).catch(()=>{});}
      }
      for (const f of files) {
        if (prefix && !f.path.startsWith(prefix)) continue;
        const p = prefix ? f.path.slice(prefix.length).replace(/^\//, "") : f.path;
        if (p.startsWith(".git/") || !p) continue;
        await fs.promises.writeFile(
          "/" + p,
          new Uint8Array(await (await readBlob(ws, f.path)).arrayBuffer()),
        );
        await git.add({ fs, dir, filepath: p });
      }
      const oid = await git.commit({
        fs,
        dir,
        message: String(args["message"] ?? "Workspace update"),
        author: { name: "OBH owner", email: "owner@obh.local" },
      });
      await saveRepo(repo);
      return `Committed and pushed ${oid}`;
    }
    case "add":
      await git.add({ fs, dir, filepath: String(args["path"] ?? ".") });
      break;
    case "diff": {
      const matrix = await git.statusMatrix({ fs, dir });
      return (
        matrix
          .filter(([, h, w, s]) => h !== w || h !== s)
          .map(([p, h, w, s]) => `${p}: HEAD ${h}, working ${w}, staged ${s}`)
          .join("\n") || "Clean"
      );
    }
    case "pull": {
      await git.checkout({
        fs,
        dir,
        ref: (await git.currentBranch({ fs, dir })) ?? "main",
        force: true,
      });
      for (const [p, b] of Object.entries(repo.data)) {
        if (p.startsWith("/.git/")) continue;
        await writeFile(ws, p.slice(1), new Blob([from64(b).buffer as ArrayBuffer]));
      }
      return "Pulled cloud repository files into workspace";
    }
    case "push":
      await saveRepo(repo);
      return "Repository pushed to cloud";
    default:
      throw new Error("Unknown Git operation");
  }
  await saveRepo(repo);
  return `${action} completed`;
}
export async function cloneExternal(ws: string, name: string, url: string) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.username || u.password)
    throw new Error("Use an HTTPS URL without embedded credentials");
  const data: RepoData = {};
  await git.clone({ fs: repoFs(data), http, dir: "/", url, depth: 1, singleBranch: true });
  const { data: row, error } = await supabase
    .from("git_repositories")
    .insert({ workspace_id: ws, name, data: data as never })
    .select("*")
    .single();
  if (error) throw error;
  return row as unknown as Repository;
}
export async function cloneUrl(repo: Repository) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const token_hash = await sha256(new TextEncoder().encode(token));
  const { error } = await supabase
    .from("git_clone_tokens")
    .insert({
      repository_id: repo.id,
      user_id: u.user.id,
      token_hash,
      expires_at: cloneExpiry(Date.now()),
    });
  if (error) throw error;
  const url = new URL(`/api/public/git/${repo.id}`, window.location.origin);
  url.username = "obh";
  url.password = token;
  return url.href;
}
export async function repoZip(repo: Repository) {
  const JSZip = (await import("jszip")).default,
    z = new JSZip();
  for (const [p, b] of Object.entries(repo.data))
    if (!p.startsWith("/.git/")) z.file(`${repo.name}/${p.slice(1)}`, from64(b));
  return z.generateAsync({ type: "blob" });
}
export async function repoTree(repo: Repository) {
  const fs = repoFs(repo.data);
  return {
    files: Object.keys(repo.data)
      .filter((p) => !p.startsWith("/.git/"))
      .map((p) => p.slice(1)),
    commits: await git.log({ fs, dir: "/", depth: 20 }).catch(() => []),
    branches: await git.listBranches({ fs, dir: "/" }).catch(() => []),
    branch:await git.currentBranch({fs,dir:'/'})??'main',
  };
}
export async function commitChanges(repo:Repository,oid:string){
  const fs=repoFs(repo.data);const {commit}=await git.readCommit({fs,dir:'/',oid});
  const changes: {path:string;before:string;after:string}[]=[];
  await git.walk({fs,dir:'/',trees:commit.parent[0]?[git.TREE({ref:commit.parent[0]}),git.TREE({ref:oid})]:[git.TREE({ref:oid})],map:async(path,entries)=>{
    const [a,b]=commit.parent[0]?entries:[undefined,entries[0]];
    if(path==='.' || (a&&await a.type()==='tree') || (b&&await b.type()==='tree'))return;
    if(await a?.oid()===await b?.oid())return;
    const decode=async(entry:typeof a)=>{const bytes=await entry?.content();return bytes?new TextDecoder().decode(bytes).slice(0,50000):'';};
    changes.push({path,before:await decode(a),after:await decode(b)});
  }});
  return changes;
}
export { bytesTo64 };
