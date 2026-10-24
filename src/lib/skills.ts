// User skills (Anthropic SKILL.md style): the model sees names + descriptions,
// and reads the full content on demand via the load_skill tool. Browser-safe.
import { supabase } from "@/integrations/supabase/client";
import { authHeaders } from "./studio-client";

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  source: string | null;
  enabled: boolean;
  created_at?: string;
}

export const slugName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

/** Turn a GitHub URL into raw.githubusercontent.com candidates. Repo roots resolve to SKILL.md on main/master. */
export function githubRawCandidates(url: string): string[] {
  try {
    const u = new URL(url);
    if (u.hostname === "raw.githubusercontent.com") return [url];
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return [url];
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 5 && parts[2] === "blob")
      return [
        `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts[3]}/${parts.slice(4).join("/")}`,
      ];
    if (parts.length === 2)
      return [
        `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/main/SKILL.md`,
        `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/master/SKILL.md`,
      ];
    return [url];
  } catch {
    return [url];
  }
}

/** Parse SKILL.md frontmatter (name, description) from markdown text. */
export function parseSkill(
  text: string,
  fallbackName: string,
): { name: string; description: string; content: string } {
  let name = fallbackName;
  let description = "";
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(text);
  if (m) {
    for (const line of (m[1] ?? "").split("\n")) {
      const kv = /^(name|description)\s*:\s*(.+)$/.exec(line.trim());
      if (!kv) continue;
      const val = (kv[2] ?? "").trim().replace(/^["']|["']$/g, "");
      if (kv[1] === "name") name = val;
      else description = val;
    }
  }
  return {
    name: slugName(name) || fallbackName,
    description: description || "Imported skill",
    content: text.trim(),
  };
}

/** Download a SKILL.md (GitHub link or raw URL), parse it, and save it as the user's skill. */
export async function importSkillFromUrl(url: string, nameOverride?: string): Promise<Skill> {
  const fetchText = async (target: string) => {
    const res = await fetch("/api/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ url: target }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string; text?: string };
    if (!res.ok || j.error) throw new Error(j.error ?? `HTTP ${res.status}`);
    return j.text ?? "";
  };
  let text = "";
  const errs: string[] = [];
  for (const target of githubRawCandidates(url)) {
    try {
      text = await fetchText(target);
      if (text.trim()) break;
    } catch (e) {
      errs.push((e as Error).message);
    }
  }
  if (!text.trim()) throw new Error(errs.join("; ") || "empty document");
  const last = url.split("/").filter(Boolean).pop()?.replace(/\.md$/i, "") ?? "skill";
  const fallback = slugName(nameOverride ?? "") || slugName(last) || "skill";
  const sk = parseSkill(text, fallback);
  const { data: au } = await supabase.auth.getUser();
  if (!au.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("skills")
    .upsert(
      {
        user_id: au.user.id,
        name: sk.name,
        description: sk.description,
        content: sk.content,
        source: url,
        enabled: false,
      },
      { onConflict: "user_id,name" },
    )
    .select()
    .single();
  if (error) throw error;
  if (!data) throw new Error("Skill import did not return a saved record");
  return { id: data.id, ...sk, source: url, enabled: false };
}
