import { useState } from "react";
import { Loader2, Plug, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { mcpTools, type McpServer } from "@/lib/mcp-client";

export function McpPanel({ servers, onChange }: { servers: McpServer[]; onChange: (s: McpServer[]) => void }) {
  const [status, setStatus] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const patch = (id: string, p: Partial<McpServer>) => onChange(servers.map((s) => (s.id === id ? { ...s, ...p } : s)));

  const test = async (s: McpServer) => {
    setBusy(s.id);
    try {
      const tools = await mcpTools(s, true);
      setStatus((x) => ({ ...x, [s.id]: `${tools.length} tool${tools.length === 1 ? "" : "s"}: ${tools.map((t) => t.name).join(", ")}` }));
    } catch (e) {
      setStatus((x) => ({ ...x, [s.id]: "" }));
      toast.error((e as Error).message);
    }
    setBusy(null);
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Plug className="h-3.5 w-3.5" /> MCP servers</div>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
          onClick={() => onChange([...servers, { id: crypto.randomUUID(), name: `server${servers.length + 1}`, url: "", headers: "", enabled: true }])}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
      {servers.map((s) => (
        <div key={s.id} className="space-y-1.5 rounded-md border border-border p-2">
          <div className="flex items-center gap-1.5">
            <Input className="h-7 text-xs" value={s.name} placeholder="Name" onChange={(e) => patch(s.id, { name: e.target.value })} />
            <Switch checked={s.enabled} onCheckedChange={(v) => patch(s.id, { enabled: v })} aria-label="Enable server" />
          </div>
          <Input className="h-7 font-mono text-[11px]" value={s.url} placeholder="https://host/mcp" onChange={(e) => patch(s.id, { url: e.target.value })} />
          <Textarea className="min-h-0 font-mono text-[11px]" rows={2} value={s.headers} placeholder={"Optional headers, one per line\nAuthorization: Bearer …"}
            onChange={(e) => patch(s.id, { headers: e.target.value })} />
          <div className="flex items-center gap-1">
            <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" disabled={!s.url || busy === s.id} onClick={() => test(s)}>
              {busy === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Connect
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs hover:text-destructive" onClick={() => onChange(servers.filter((x) => x.id !== s.id))} aria-label="Remove server">
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          {status[s.id] && <p className="line-clamp-3 text-[11px] text-muted-foreground">{status[s.id]}</p>}
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">Your browser connects directly, so servers on your network work. They must use https and allow this site via CORS.</p>
    </div>
  );
}
