import git from "isomorphic-git";
import { repoFs, type RepoData } from "./git-fs";
export const pkt = (s: string) => {
  const b = new TextEncoder().encode(s),
    out = new Uint8Array(b.length + 4);
  out.set(new TextEncoder().encode((b.length + 4).toString(16).padStart(4, "0")));
  out.set(b, 4);
  return out;
};
export const joinBytes = (parts: Uint8Array[]) => {
  const all = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let i = 0;
  for (const b of parts) {
    all.set(b, i);
    i += b.length;
  }
  return all;
};
export async function advertise(data: RepoData) {
  const fs = repoFs(data);
  const branches = await git.listBranches({ fs, dir: "/" });
  const refs: [string, string][] = [];
  for (const ref of branches)
    refs.push([await git.resolveRef({ fs, dir: "/", ref }), `refs/heads/${ref}`]);
  const branch = (await git.currentBranch({ fs, dir: "/" })) ?? "main";
  const head = refs.find(([, r]) => r === `refs/heads/${branch}`)?.[0];
  const caps = `side-band-64k symref=HEAD:refs/heads/${branch} agent=OBH/1.0`;
  const lines: Uint8Array[] = [
    pkt("# service=git-upload-pack\n"),
    new TextEncoder().encode("0000"),
  ];
  if (head) refs.unshift([head, "HEAD"]);
  if (!refs.length)
    lines.push(pkt("0000000000000000000000000000000000000000 capabilities^{}\0" + caps + "\n"));
  else
    refs.forEach(([oid, ref], i) =>
      lines.push(pkt(`${oid} ${ref}${i === 0 ? "\0" + caps : ""}\n`)),
    );
  lines.push(new TextEncoder().encode("0000"));
  return joinBytes(lines);
}
export function parsePkts(bytes: Uint8Array) {
  const lines: string[] = [];
  let pos = 0;
  while (pos + 4 <= bytes.length) {
    const header=new TextDecoder().decode(bytes.slice(pos,pos+4));
    if(!/^[0-9a-fA-F]{4}$/.test(header)) throw new Error('Invalid Git packet');
    const len = parseInt(header, 16);
    if (!Number.isFinite(len) || len < 0 || len > 65520) throw new Error("Invalid Git packet");
    pos += 4;
    if (len === 0) continue;
    if (len < 4 || pos + len - 4 > bytes.length) throw new Error("Incomplete Git packet");
    lines.push(new TextDecoder().decode(bytes.slice(pos, pos + len - 4)));
    pos += len - 4;
  }
  if(pos!==bytes.length) throw new Error('Incomplete Git packet');
  return lines;
}
export async function uploadPack(data: RepoData, body: Uint8Array) {
  const lines = parsePkts(body);
  const fs = repoFs(data);
  const wants = lines.filter((s) => s.startsWith("want ")).map((s) => s.slice(5, 45));
  const tips = new Set<string>();
  for (const b of await git.listBranches({ fs, dir: "/" }))
    tips.add(await git.resolveRef({ fs, dir: "/", ref: b }));
  if (wants.some((w) => !tips.has(w)))
    throw new Error("Only advertised branch tips may be fetched");
  if (!lines.some((l) => l.trim() === "done")) return pkt("NAK\n");
  const seen = new Set<string>();
  const visit = async (oid: string) => {
    if (seen.has(oid)) return;
    if (seen.size >= 50000) throw new Error("Repository object limit exceeded");
    seen.add(oid);
    const obj = await git.readObject({ fs, dir: "/", oid, format: "content" });
    if (obj.type === "commit") {
      const { commit } = await git.readCommit({ fs, dir: "/", oid });
      await visit(commit.tree);
      for (const p of commit.parent) await visit(p);
    }
    if (obj.type === "tree") {
      const { tree } = await git.readTree({ fs, dir: "/", oid });
      for (const entry of tree) if (entry.type !== "commit") await visit(entry.oid);
    }
  };
  for (const w of wants) await visit(w);
  const { packfile } = await git.packObjects({ fs, dir: "/", oids: [...seen] });
  if (!packfile) throw new Error("Could not pack repository");
  const pack = new Uint8Array(packfile);
  if (pack.length > 16000000) throw new Error("Repository pack exceeds 16 MB");
  const sideband = lines.some((l) => l.includes("side-band-64k"));
  const parts = [pkt("NAK\n")];
  if (sideband) {
    for (let i = 0; i < pack.length; i += 60000) {
      const p = pack.slice(i, i + 60000),
        b = new Uint8Array(p.length + 5);
      b.set(new TextEncoder().encode(b.length.toString(16).padStart(4, "0")));
      b[4] = 1;
      b.set(p, 5);
      parts.push(b);
    }
    parts.push(new TextEncoder().encode("0000"));
  } else parts.push(pack);
  return joinBytes(parts);
}
export async function authenticateGit(request: Request, id: string) {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return null;
  let token = "";
  try {
    token = atob(auth.slice(6)).split(":").slice(1).join(":");
  } catch {
    return null;
  }
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: t } = await supabaseAdmin
    .from("git_clone_tokens")
    .select("repository_id,user_id,expires_at")
    .eq("repository_id", id)
    .eq("token_hash", hash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!t) return null;
  const { data: r } = await supabaseAdmin
    .from("git_repositories")
    .select("data")
    .eq("id", id)
    .eq("user_id", t.user_id)
    .single();
  return r?.data as RepoData | undefined;
}
export async function gitResponse(request: Request, id: string, service: "refs" | "pack") {
  const data = await authenticateGit(request, id);
  if (!data)
    return new Response("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="OBH Git"', "Cache-Control": "no-store" },
    });
  try {
    const parts:Uint8Array[]=[];
    let size=0;
    if(service==='pack' && request.body){
      const reader=request.body.getReader();
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1000000){await reader.cancel();return new Response('Request too large',{status:413});}parts.push(value);}
    }
    const bytes =
      service === "refs"
        ? await advertise(data)
        : await uploadPack(data, joinBytes(parts));
    return new Response(bytes.slice().buffer, {
      headers: {
        "Content-Type":
          service === "refs"
            ? "application/x-git-upload-pack-advertisement"
            : "application/x-git-upload-pack-result",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response((e as Error).message, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
