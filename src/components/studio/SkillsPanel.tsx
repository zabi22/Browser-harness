import { useState } from "react";
import { toast } from "sonner";
import { Github, Loader2, Sparkles, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { importSkillFromUrl, type Skill } from "@/lib/skills";

export function SkillsPanel({ skills, reload }: { skills: Skill[]; reload: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const importSkill = async () => {
    const u = url.trim();
    if (!u || busy) return;
    setBusy(true);
    try {
      const sk = await importSkillFromUrl(u);
      toast.success(`Skill "${sk.name}" imported`);
      setUrl("");
      reload();
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" /> Skills
      </div>
      {skills.length > 0 ? (
        <div className="space-y-1.5">
          {skills.map((k) => (
            <div
              key={k.id}
              className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs">{k.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {k.description || k.source || "—"}
                </div>
              </div>
              <Switch
                checked={k.enabled}
                aria-label={`Enable ${k.name}`}
                onCheckedChange={async (v) => {
                  await supabase.from("skills").update({ enabled: v }).eq("id", k.id);
                  reload();
                }}
              />
              <button
                aria-label={`Delete ${k.name}`}
                onClick={async () => {
                  if (!confirm(`Delete skill "${k.name}"?`)) return;
                  await supabase.from("skills").delete().eq("id", k.id);
                  reload();
                }}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          No skills yet. Import one from GitHub below — or just ask the model to import one for you.
        </p>
      )}
      <div className="flex gap-1.5">
        <Input
          placeholder="https://github.com/…/SKILL.md"
          value={url}
          className="h-8 text-xs"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && importSkill()}
        />
        <Button
          size="sm"
          className="h-8"
          onClick={importSkill}
          disabled={busy || !url.trim()}
          aria-label="Import skill"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Github className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        The model sees only skill names and descriptions; it reads the full instructions on demand.
      </p>
    </div>
  );
}
