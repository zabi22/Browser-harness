import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteProviderKey, listProviderKeys, saveProviderKey } from "@/lib/provider-keys.functions";

type P = "openai" | "anthropic" | "google" | "custom";
const PROVIDERS: { id: P; label: string; where: string; placeholder: string }[] = [
  { id: "openai", label: "OpenAI", where: "platform.openai.com → API keys. Also powers image tools, OCR and voice typing.", placeholder: "sk-..." },
  { id: "anthropic", label: "Anthropic", where: "console.anthropic.com → API keys", placeholder: "sk-ant-..." },
  { id: "google", label: "Google Gemini", where: "aistudio.google.com → Get API key", placeholder: "AIza..." },
  { id: "custom", label: "OpenRouter / any compatible API", where: "openrouter.ai → Keys, or any OpenAI-compatible service. Pick the model by id in the Models tab.", placeholder: "sk-or-..." },
];

export function ApiKeysSection() {
  const list = useServerFn(listProviderKeys);
  const save = useServerFn(saveProviderKey);
  const remove = useServerFn(deleteProviderKey);
  const [saved, setSaved] = useState<Record<string, { base_url: string | null }>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const reload = () => list().then((rows) => {
    setSaved(Object.fromEntries(rows.map((r) => [r.provider, { base_url: r.base_url }])));
    const c = rows.find((r) => r.provider === "custom"); if (c?.base_url) setBase(c.base_url);
  }).catch(() => toast.error("Could not load your keys"));
  useEffect(() => { void reload(); }, []);

  const onSave = async (p: P) => {
    const key = draft[p]?.trim();
    if (!key) return;
    setBusy(p);
    try {
      await save({ data: { provider: p, key, baseUrl: p === "custom" ? base.trim() : "" } });
      setDraft((d) => ({ ...d, [p]: "" }));
      toast.success("Key saved");
      await reload();
    } catch (e) { toast.error((e as Error).message || "Could not save key"); }
    setBusy(null);
  };
  const onRemove = async (p: P) => {
    setBusy(p);
    try { await remove({ data: { provider: p } }); toast.success("Key removed"); await reload(); }
    catch { toast.error("Could not remove key"); }
    setBusy(null);
  };

  return (
    <section className="space-y-4 border-t border-border py-7">
      <h2 className="flex items-center gap-3 text-2xl font-normal"><KeyRound className="h-4 w-4 text-primary" /> API keys</h2>
      <p className="text-sm text-muted-foreground">Bring your own keys. They're encrypted before they're stored and only ever used to send your own requests. Usage is billed by each provider to you.</p>
      {PROVIDERS.map((p) => (
        <div key={p.id} className="space-y-2 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`k-${p.id}`} className="text-sm">{p.label}</Label>
            {saved[p.id]
              ? <span className="flex items-center gap-2 text-xs text-primary">Saved
                  <Button size="sm" variant="ghost" disabled={busy === p.id} onClick={() => onRemove(p.id)} aria-label={`Remove ${p.label} key`}><Trash2 className="h-3.5 w-3.5" /></Button></span>
              : <span className="text-xs text-muted-foreground">Not set</span>}
          </div>
          <p className="text-xs text-muted-foreground">{p.where}</p>
          {p.id === "custom" && <Input value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://openrouter.ai/api/v1 (default)" aria-label="Base URL" />}
          <div className="flex gap-2">
            <Input id={`k-${p.id}`} type="password" autoComplete="off" value={draft[p.id] ?? ""} placeholder={saved[p.id] ? "Enter a new key to replace" : p.placeholder}
              onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))} />
            <Button disabled={busy === p.id || !draft[p.id]?.trim()} onClick={() => onSave(p.id)}>Save</Button>
          </div>
        </div>
      ))}
    </section>
  );
}
