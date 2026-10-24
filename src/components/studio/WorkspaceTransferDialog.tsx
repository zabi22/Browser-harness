import { useRef, useState } from "react";
import { Download, FileArchive, FileJson, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { collectBackup, restoreBackup } from "@/lib/account-backup";
import { download } from "@/lib/studio-client";
import type { WsProps } from "./LeftPanel";

type Format = "backup" | "zip" | "md";
const FORMATS: { id: Format; label: string; hint: string; Icon: typeof FileJson }[] = [
  {
    id: "backup",
    label: "Full workspace backup",
    hint: "Chats with branches, files and Git. Can be imported again.",
    Icon: FileJson,
  },
  {
    id: "zip",
    label: "Readable archive (.zip)",
    hint: "Chats as text plus every file. For reading, not importing.",
    Icon: FileArchive,
  },
  {
    id: "md",
    label: "Chats as text (.md)",
    hint: "One readable document with every chat.",
    Icon: FileText,
  },
];

export function WorkspaceTransferDialog({
  open,
  onOpenChange,
  ws,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ws: WsProps;
}) {
  const [format, setFormat] = useState<Format>("backup");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = ws.list.find((w) => w.id === ws.active);

  const doExport = async () => {
    if (!ws.active) return;
    if (format !== "backup") {
      ws.exportAs(format === "zip");
      return;
    }
    setBusy(true);
    try {
      const data = await collectBackup(ws.active);
      const name = (current?.name ?? "workspace").replace(/[^\w-]+/g, "_");
      download(
        `${name}.obh-workspace.json`,
        JSON.stringify({ app: "obh-workspace", v: 1, data }),
        "application/json",
      );
      toast.success(
        `Exported ${data.conversations.length} chats and ${data.files?.length ?? 0} files`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  };

  const doImport = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      const parsed = JSON.parse(await picked.text());
      if (parsed?.app !== "obh-workspace" || parsed.data?.kind !== "workspace")
        throw new Error("This is not an OBH workspace backup");
      const r = await restoreBackup(parsed.data);
      await ws.reload();
      if (r.workspaceId) ws.select(r.workspaceId);
      toast.success(`Imported ${r.chats} chats and ${r.files} files`);
      setPicked(null);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Workspace import &amp; export</DialogTitle>
          <DialogDescription>
            Move a single workspace. For everything in your account, use Settings.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="export">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="export">
              <Download className="h-4 w-4" /> Export
            </TabsTrigger>
            <TabsTrigger value="import">
              <Upload className="h-4 w-4" /> Import
            </TabsTrigger>
          </TabsList>
          <TabsContent value="export" className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label className="text-xs">Workspace</Label>
              <Select value={ws.active ?? ""} onValueChange={ws.select}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ws.list.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              {FORMATS.map(({ id, label, hint, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFormat(id)}
                  className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${format === id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
            <Button className="w-full" disabled={busy || !ws.active} onClick={doExport}>
              <Download className="h-4 w-4" /> {busy ? "Packing…" : "Export"}
            </Button>
          </TabsContent>
          <TabsContent value="import" className="space-y-3 pt-2">
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                setPicked(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-center hover:bg-muted/50"
            >
              <Upload className="h-6 w-6 text-primary" />
              <span className="text-sm font-medium">
                {picked ? picked.name : "Choose a workspace backup"}
              </span>
              <span className="text-xs text-muted-foreground">
                .obh-workspace.json — imported as a new copy, nothing is overwritten
              </span>
            </button>
            <Button className="w-full" disabled={busy || !picked} onClick={doImport}>
              {busy ? "Importing…" : "Import workspace"}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
