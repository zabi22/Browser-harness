import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  FilePlus,
  FileText,
  Folder,
  ImageIcon,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { downloadBlob } from "./EnvironmentPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  blobToDataUrl,
  isTextMime,
  readBlob,
  removeFile,
  renameFile,
  writeFile,
  type WsFile,
} from "@/lib/workspace-fs";

const fmt = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;

export function FilesPanel({
  ws,
  files,
  reload,
}: {
  ws: string | null;
  files: WsFile[];
  reload: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<{
    path: string;
    text?: string;
    image?: string;
    isNew?: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Group by folder for a simple tree.
  const groups = useMemo(() => {
    const m = new Map<string, WsFile[]>();
    for (const f of files) {
      const d = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
      m.set(d, [...(m.get(d) ?? []), f]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [files]);

  if (!ws) return <p className="px-2 py-4 text-xs text-muted-foreground">Loading workspace…</p>;

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(list)) await writeFile(ws, f.name, f, f.type || undefined);
      toast.success(`Uploaded ${list.length} file(s)`);
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
    reload();
  };
  const openFile = async (f: WsFile) => {
    try {
      const b = await readBlob(ws, f.path);
      if (f.mime.startsWith("image/")) setOpen({ path: f.path, image: await blobToDataUrl(b) });
      else if (isTextMime(f.mime)) setOpen({ path: f.path, text: await b.text() });
      else toast.info("This file type can't be edited here, but the model can still use it.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const save = async () => {
    if (!open || open.text == null) return;
    setBusy(true);
    try {
      await writeFile(ws, open.path, open.text);
      toast.success("Saved");
      setOpen(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="secondary"
          className="flex-1"
          onClick={() => setOpen({ path: "notes.md", text: "", isNew: true })}
        >
          <FilePlus className="h-4 w-4" /> New
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="flex-1"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Upload className="h-4 w-4" /> Upload
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {!files.length && (
        <p className="px-2 py-4 text-xs text-muted-foreground">
          No files yet. The model can create files here too.
        </p>
      )}
      {groups.map(([dir, list]) => (
        <div key={dir}>
          {dir && (
            <div className="flex items-center gap-1.5 px-2 pt-2 text-[11px] font-semibold text-muted-foreground">
              <Folder className="h-3.5 w-3.5" />
              {dir}
            </div>
          )}
          {list.map((f) => (
            <div
              key={f.id}
              className={`group flex items-center rounded-md text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground ${dir ? "pl-3" : ""}`}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
                onClick={() => openFile(f)}
              >
                {f.mime.startsWith("image/") ? (
                  <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="truncate">{f.path.split("/").pop()}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] opacity-60">
                  {fmt(f.size)}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="Download file"
                aria-label={`Download ${f.path}`}
                onClick={async () => {
                  try {
                    downloadBlob(await readBlob(ws, f.path), f.path.split("/").pop() ?? "file");
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                <Download className="h-3 w-3" />
              </Button>
              <button
                className="rounded p-1 opacity-0 hover:bg-muted group-hover:opacity-100"
                aria-label={`Rename ${f.path}`}
                onClick={async () => {
                  const to = prompt("New path", f.path);
                  if (to && to !== f.path) {
                    try {
                      await renameFile(ws, f.path, to);
                      reload();
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }
                }}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                className="mr-1 rounded p-1 opacity-0 hover:bg-muted hover:text-destructive group-hover:opacity-100"
                aria-label={`Delete ${f.path}`}
                onClick={async () => {
                  if (confirm(`Delete ${f.path}?`)) {
                    try {
                      await removeFile(ws, f.path);
                      reload();
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }
                }}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ))}

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              {open?.isNew ? (
                <input
                  className="w-full rounded border border-border bg-background px-2 py-1"
                  value={open.path}
                  onChange={(e) => setOpen({ ...open, path: e.target.value })}
                />
              ) : (
                open?.path
              )}
            </DialogTitle>
          </DialogHeader>
          {open?.image ? (
            <img src={open.image} alt={open.path} className="max-h-[70vh] w-full object-contain" />
          ) : (
            <Textarea
              className="h-[60vh] font-mono text-xs"
              spellCheck={false}
              value={open?.text ?? ""}
              onChange={(e) => open && setOpen({ ...open, text: e.target.value })}
            />
          )}
          {open?.text != null && (
            <DialogFooter>
              <Button disabled={busy} onClick={save}>
                Save
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
