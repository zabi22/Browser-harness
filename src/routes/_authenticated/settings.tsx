import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Download, Lock, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { decryptBackup, encryptBackup, type EncryptedBackup } from "@/lib/backup";
import { download } from "@/lib/studio-client";
import type { BackupData } from "@/lib/backup-data";
import { ApiKeysSection } from "@/components/studio/ApiKeysSection";
import { collectBackup, restoreBackup } from "@/lib/account-backup";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — OBH" },
      { name: "description", content: "Manage your own AI provider keys and back up your OBH history." },
      { property: "og:title", content: "Settings — OBH" },
      { property: "og:description", content: "Manage your own AI provider keys and back up your OBH history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [pw, setPw] = useState("");
  const [rpw, setRpw] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportAll = async () => {
    if (pw.length < 8) return void toast.error("Use a password of at least 8 characters");
    setBusy(true);
    const t = toast.loading("Collecting every workspace, chat and file…");
    try {
      const data = await collectBackup();
      download(`obh-account-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await encryptBackup(data, pw)), "application/json");
      toast.success(`Backup ready: ${data.workspaces?.length} workspaces, ${data.conversations.length} chats, ${data.files?.length} files`);
    } catch (e) { toast.error((e as Error).message); } finally { toast.dismiss(t); }
    setBusy(false);
  };

  const restore = async (file: File) => {
    setBusy(true);
    const t = toast.loading("Restoring…");
    try {
      const data = await decryptBackup<BackupData>(JSON.parse(await file.text()) as EncryptedBackup, rpw);
      const r = await restoreBackup(data);
      toast.success(`Restored ${r.workspaces} workspaces, ${r.chats} chats and ${r.files} files`);
    } catch (e) { toast.error((e as Error).message); } finally { toast.dismiss(t); }
    setBusy(false);
  };

  return (
    <main className="min-h-dvh bg-background px-5 py-10 sm:py-16">
      <div className="mx-auto max-w-2xl space-y-8">
        <Link to="/studio/{-$chatId}" params={{ chatId: undefined }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to studio
        </Link>
        <div>
          <div className="mb-3 text-[10px] text-muted-foreground">HARNESS / ACCOUNT</div>
          <h1 className="mb-3 text-5xl font-normal">Settings</h1>
          <p className="text-sm text-muted-foreground">Your account, safely kept.</p>
        </div>

        <ApiKeysSection />

        <section className="space-y-4 border-t border-border py-7">
          <h2 className="flex items-center gap-3 text-2xl font-normal"><Download className="h-4 w-4 text-primary" /> Export full account backup</h2>
          <p className="text-sm text-muted-foreground">Includes every workspace with its chats, branches, files and Git repositories, plus your prompts, skills and settings. Workspace-only backups live in the workspace menu. Without the password, the file can't be read — and can't be recovered.</p>
          <div className="space-y-1"><Label htmlFor="pw">Backup password</Label>
            <Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          <Button onClick={exportAll} disabled={busy}><Lock className="h-4 w-4" /> Download backup</Button>
        </section>

        <section className="space-y-4 border-t border-border py-7">
          <h2 className="flex items-center gap-3 text-2xl font-normal"><Upload className="h-4 w-4 text-primary" /> Restore from backup</h2>
          <p className="text-sm text-muted-foreground">Everything in the backup is added to this account; matching items are overwritten.</p>
          <div className="space-y-1"><Label htmlFor="rpw">Backup password</Label>
            <Input id="rpw" type="password" value={rpw} onChange={(e) => setRpw(e.target.value)} /></div>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ""; }} />
          <Button variant="secondary" disabled={busy || !rpw} onClick={() => fileRef.current?.click()}>Choose backup file</Button>
        </section>
      </div>
    </main>
  );
}
