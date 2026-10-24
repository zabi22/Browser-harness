import { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Download, CloudUpload, Square, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { linuxFor } from "@/lib/linux-environment";
import { listProcesses, subscribeProcesses, stopProcess } from "@/lib/wasm-processes";
import { toast } from "sonner";
import { atConsoleBottom } from "@/lib/linux-console";
import type { Settings } from "@/lib/studio-client";
export function downloadBlob(b: Blob, name: string) {
  const url = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function EnvironmentPanel({
  ws,
  settings,
  onSettings,
}: {
  ws: string | null;
  settings?: Settings;
  onSettings?: (p: Partial<Settings>) => void;
}) {
  const [, rerender] = useState(0),
    [command, setCommand] = useState(""),
    [busy, setBusy] = useState(false),
    [cmdRunning, setCmdRunning] = useState(false);
  const cmdAbort = useRef<AbortController | null>(null);
  const env = ws ? linuxFor(ws) : null;
  const consoleRef = useRef<HTMLPreElement>(null);
  const follow = useRef(true);
  useEffect(() => env?.subscribe(() => rerender((n) => n + 1)), [env]);
  useEffect(() => subscribeProcesses(() => rerender((n) => n + 1)), []);
  useEffect(() => {
    follow.current = true;
  }, [ws]);
  useEffect(() => {
    env?.setMemory(settings?.linuxMemory ?? 512);
  }, [env, settings?.linuxMemory]);
  useEffect(() => {
    const el = consoleRef.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [env?.output, ws]);
  if (!env) return null;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const runCommand = () => {
    const cmd = command.trim();
    if (!cmd || cmdRunning) return;
    const ctrl = new AbortController();
    cmdAbort.current = ctrl;
    setCmdRunning(true);
    setCommand("");
    void env
      .exec(cmd, ctrl.signal)
      .catch((e) => {
        if (!ctrl.signal.aborted) toast.error((e as Error).message);
      })
      .finally(() => {
        cmdAbort.current = null;
        setCmdRunning(false);
      });
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Terminal className="h-4 w-4 text-primary" />
          Alpine Linux
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{env.state}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        {settings?.linuxMemory ?? 512} MiB · single-core x86 (Pentium-class) · Python 3.12 · offline
      </div>
      {settings && onSettings && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="lx-mem" className="text-xs">
            Memory
          </Label>
          <Select
            value={String(settings.linuxMemory ?? 512)}
            onValueChange={(v) => {
              const mib = Number(v);
              onSettings({ linuxMemory: mib });
              env.setMemory(mib);
              if (["running", "paused", "unsynced"].includes(env.state))
                toast.info("Memory applies when Linux restarts");
            }}
          >
            <SelectTrigger id="lx-mem" aria-label="Linux memory" className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[512, 1024, 2048, 4096].map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m >= 1024 ? `${m / 1024} GiB` : `${m} MiB`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {settings && onSettings && (
        <div className="flex items-center justify-between">
          <Label htmlFor="lx-auto" className="text-xs">
            Start Linux when a workspace opens
          </Label>
          <Switch
            id="lx-auto"
            checked={settings.linuxAutostart ?? false}
            onCheckedChange={(v) => onSettings({ linuxAutostart: v })}
          />
        </div>
      )}
      {settings && onSettings && (settings.linuxAutostart ?? false) && (
        <p className="text-[11px] text-muted-foreground">
          Also needs the "Start Linux automatically" permission (Ask or YOLO allow it).
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        <Button
          variant="secondary"
          size="icon"
          disabled={busy}
          title="Start / resume"
          aria-label="Start Linux"
          onClick={() => act(() => (env.state === "paused" ? env.resume() : env.start()))}
        >
          <Play className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={busy || env.state !== "running"}
          title="Pause"
          aria-label="Pause Linux"
          onClick={() => act(() => env.pause())}
        >
          <Pause className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={busy || !["running", "paused", "unsynced"].includes(env.state)}
          title="Save disk to cloud"
          aria-label="Save Linux disk"
          onClick={() => act(() => env.checkpoint())}
        >
          <CloudUpload className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          title="Save and restart"
          aria-label="Restart Linux"
          onClick={() => act(() => env.restart())}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          title="Download local disk"
          aria-label="Download Linux disk"
          onClick={() =>
            act(async () => {
              const b = await env.exportLocal();
              if (b) downloadBlob(b, "linux-disk.zip");
            })
          }
        >
          <Download className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          title="Save and stop"
          aria-label="Stop Linux"
          onClick={() =>
            act(async () => {
              await env.checkpoint();
              if (env.state === "running" || env.state === "paused") env.stop();
            })
          }
        >
          <Square className="h-4 w-4" />
        </Button>
      </div>
      {env.error && <p className="break-words text-xs text-destructive">{env.error}</p>}
      {env.state === "conflict" && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => act(() => env.resolveConflict(false))}
          >
            Keep local
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => act(() => env.resolveConflict(true))}
          >
            Use cloud
          </Button>
        </div>
      )}
      <pre
        ref={consoleRef}
        aria-label="Linux output"
        onScroll={(e) => {
          follow.current = atConsoleBottom(e.currentTarget);
        }}
        className="h-64 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[10px] whitespace-pre-wrap break-words"
      >
        {env.output || "Linux stopped"}
      </pre>
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          runCommand();
        }}
      >
        <Input
          aria-label="Linux command"
          className="font-mono text-xs"
          placeholder="$ command"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
        />
        {cmdRunning ? (
          <Button
            type="button"
            size="icon"
            variant="destructive"
            title="Stop the running command"
            aria-label="Stop Linux command"
            onClick={() => cmdAbort.current?.abort()}
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="icon" aria-label="Run Linux command">
            <Play className="h-4 w-4" />
          </Button>
        )}
      </form>
      {cmdRunning && (
        <p className="text-[11px] text-muted-foreground">
          Command running — you can keep using the app; press stop to cancel it.
        </p>
      )}
      <div className="border-t border-border pt-3 text-xs font-semibold">WASM processes</div>
      {listProcesses().map((p) => (
        <div key={p.id} className="space-y-1 border-b border-border py-2">
          <div className="flex justify-between">
            <span className="truncate text-xs">
              {p.name} · {p.state}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              aria-label={`Stop ${p.name}`}
              onClick={() => stopProcess(p.id)}
            >
              <Square className="h-3 w-3" />
            </Button>
          </div>
          <pre className="max-h-32 overflow-auto text-[10px] whitespace-pre-wrap">{p.output}</pre>
        </div>
      ))}
    </div>
  );
}
