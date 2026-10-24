import { useState } from "react";
import { Library, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";

export interface PromptRow {
  id: string;
  kind: string;
  title: string;
  content: string;
  enabled: boolean;
  created_at: string;
}

function PromptCard({
  p,
  onChange,
  onDelete,
}: {
  p: PromptRow;
  onChange: (p: PromptRow) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(p);
  const save = async (next: PromptRow) => {
    onChange(next);
    const { error } = await supabase
      .from("prompts")
      .update({ title: next.title, content: next.content, enabled: next.enabled })
      .eq("id", p.id);
    if (error) toast.error(error.message);
  };
  return (
    <div
      className={`space-y-2 rounded-lg border p-3 transition-colors ${draft.enabled ? "border-primary/50 bg-primary/5" : "border-border bg-card/50"}`}
    >
      <div className="flex items-center gap-2">
        <Input
          className="h-8 text-sm font-medium"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          onBlur={() => save(draft)}
        />
        <Switch
          checked={draft.enabled}
          onCheckedChange={(v) => {
            const n = { ...draft, enabled: v };
            setDraft(n);
            save(n);
          }}
          aria-label="Active"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onDelete}
          aria-label="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <Textarea
        className="min-h-28 font-mono text-xs"
        value={draft.content}
        placeholder="Write the text here…"
        onChange={(e) => setDraft({ ...draft, content: e.target.value })}
        onBlur={() => save(draft)}
      />
    </div>
  );
}

export function RightPanel({
  prompts,
  setPrompts,
}: {
  prompts: PromptRow[];
  setPrompts: (p: PromptRow[]) => void;
}) {
  const add = async (kind: string) => {
    const { data, error } = await supabase
      .from("prompts")
      .insert({
        kind,
        title: kind === "system" ? "New system prompt" : "New fragment",
        enabled: true,
      })
      .select()
      .single();
    if (error) return void toast.error(error.message);
    setPrompts([...prompts, data as PromptRow]);
  };
  const del = async (id: string) => {
    const { error } = await supabase.from("prompts").delete().eq("id", id);
    if (error) return void toast.error(error.message);
    setPrompts(prompts.filter((p) => p.id !== id));
  };
  const list = (kind: string) => prompts.filter((p) => p.kind === kind);
  const section = (kind: string, hint: string) => (
    <TabsContent value={kind} className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-4">
      {list(kind).map((p) => (
        <PromptCard
          key={p.id}
          p={p}
          onDelete={() => del(p.id)}
          onChange={(n) => setPrompts(prompts.map((x) => (x.id === n.id ? n : x)))}
        />
      ))}
      <Button variant="outline" size="sm" className="w-full" onClick={() => add(kind)}>
        <Plus className="h-4 w-4" /> {kind === "system" ? "New instruction" : "New fragment"}
      </Button>
    </TabsContent>
  );
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border px-5 py-5">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Library className="h-3.5 w-3.5" /> CONTEXT
        </div>
        <h2 className="text-2xl font-normal">Library</h2>
      </div>
      <Tabs defaultValue="system" className="flex min-h-0 flex-1 flex-col px-4 pt-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="system">System prompts</TabsTrigger>
          <TabsTrigger value="fragment">Fragments</TabsTrigger>
        </TabsList>
        {section("system", "Every active system prompt is sent as the model's instructions.")}
        {section("fragment", "Active fragments are quietly added after each message you send.")}
      </Tabs>
    </div>
  );
}
