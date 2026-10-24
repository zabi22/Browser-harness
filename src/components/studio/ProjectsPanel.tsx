import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Eye, FolderPlus, Loader2, RefreshCw, CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TEMPLATES,
  STAGE_LABELS,
  templateFiles,
  type BuildStage,
  type TemplateId,
} from "@/lib/project-templates";
import { buildPreview, findWebProjects } from "@/lib/web-preview";
import { writeFile, type WsFile } from "@/lib/workspace-fs";

export async function createProject(ws: string, id: TemplateId, name: string) {
  const folder =
    name
      .trim()
      .replace(/[^\w .-]+/g, "")
      .replace(/\s+/g, "-") || "project";
  const files = templateFiles(id, name.trim() || folder);
  for (const [p, c] of Object.entries(files)) await writeFile(ws, `${folder}/${p}`, c);
  return { folder, count: Object.keys(files).length };
}

export function ProjectsPanel({
  ws,
  files,
  reload,
}: {
  ws: string | null;
  files: WsFile[];
  reload: () => void;
}) {
  const [tpl, setTpl] = useState<TemplateId>("website");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ root: string; entry: string } | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [previewed, setPreviewed] = useState<Set<string>>(new Set());
  const webs = useMemo(() => findWebProjects(files), [files]);
  const roots = useMemo(
    () => [
      ...new Set(
        files
          .filter((f) => /(^|\/)(package\.json|go\.mod)$/.test(f.path))
          .map((f) => f.path.replace(/\/?(frontend\/)?(package\.json|go\.mod)$/, "")),
      ),
    ],
    [files],
  );

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.data?.obhPreviewError) setErr(String(e.data.obhPreviewError));
    };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, []);

  if (!ws) return <p className="px-2 py-4 text-xs text-muted-foreground">Loading workspace…</p>;

  const make = async () => {
    setBusy(true);
    try {
      const r = await createProject(ws, tpl, name || TEMPLATES.find((t) => t.id === tpl)!.label);
      toast.success(`Saved ${r.count} files in ${r.folder}/`);
      setName("");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  };
  const run = async (p: { root: string; entry: string }) => {
    setPreview(p);
    setHtml(null);
    setErr(null);
    try {
      const r = await buildPreview(ws, p.root, p.entry);
      setHtml(r.html);
      setPreviewed((s) => new Set(s).add(p.root));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const stages = (root: string): Record<BuildStage, boolean> => ({
    source: true,
    preview: previewed.has(root),
    compiled: false,
    windowsTested: false,
    artifact: false,
  });

  return (
    <div className="space-y-4 px-1 py-2 text-sm">
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">New project</h3>
        <Select value={tpl} onValueChange={(v) => setTpl(v as TemplateId)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATES.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{TEMPLATES.find((t) => t.id === tpl)?.hint}</p>
        <Input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button className="w-full" size="sm" disabled={busy} onClick={make}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}{" "}
          Create project files
        </Button>
      </section>
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Projects</h3>
        {!roots.length && <p className="text-xs text-muted-foreground">No projects yet.</p>}
        {roots.map((root) => {
          const w = webs.find((x) => x.root === root);
          const st = stages(root);
          return (
            <div key={root} className="space-y-2 rounded-md border p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{root || "(workspace root)"}</span>
                {w && (
                  <Button size="sm" variant="outline" onClick={() => run(w)}>
                    <Eye className="h-4 w-4" /> Preview
                  </Button>
                )}
              </div>
              <ul className="space-y-0.5 text-xs">
                {(Object.keys(STAGE_LABELS) as BuildStage[]).map((k) => (
                  <li
                    key={k}
                    className={
                      st[k]
                        ? "flex items-center gap-1"
                        : "flex items-center gap-1 text-muted-foreground"
                    }
                  >
                    {st[k] ? (
                      <CheckCircle2 className="h-3 w-3 text-primary" />
                    ) : (
                      <Circle className="h-3 w-3" />
                    )}
                    {STAGE_LABELS[k]}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                Builds and publishing unlock once GitHub and Cloudflare are connected.
              </p>
            </div>
          );
        })}
      </section>
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="flex h-[85vh] max-w-5xl flex-col">
          <DialogHeader className="flex-row items-center justify-between space-y-0 pr-8">
            <DialogTitle>Preview · {preview?.root}</DialogTitle>
            <Button size="sm" variant="ghost" onClick={() => preview && run(preview)}>
              <RefreshCw className="h-4 w-4" /> Rebuild
            </Button>
          </DialogHeader>
          {err && (
            <pre className="max-h-32 overflow-auto rounded bg-destructive/10 p-2 text-xs text-destructive">
              {err}
            </pre>
          )}
          {html ? (
            <iframe
              title="Website preview"
              sandbox="allow-scripts allow-forms"
              srcDoc={html}
              className="min-h-0 flex-1 rounded border bg-background"
            />
          ) : (
            !err && (
              <div className="grid flex-1 place-items-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )
          )}
          <p className="text-xs text-muted-foreground">
            Browser preview only. For desktop apps this shows the window's web UI, not proof that
            the Windows app works.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
