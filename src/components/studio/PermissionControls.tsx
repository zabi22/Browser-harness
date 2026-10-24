import { useState } from "react";
import { Shield, Settings2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { CAPABILITIES, defaultRules, type Capability, type Decision } from "@/lib/agent-policy";
import type { Settings } from "@/lib/studio-client";
export function PermissionControls({
  settings,
  onSettings,
  disabled = false,
}: {
  settings: Settings;
  onSettings: (p: Partial<Settings>) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [rules, setRules] = useState(defaultRules),
    [editing, setEditing] = useState<string | null>(null);
  const configure = () => {
    const preset = settings.permissionPresets.find((p) => p.id === settings.permissionMode);
    setEditing(preset?.id ?? null);
    setName(preset?.name ?? "");
    setRules(preset?.rules ?? defaultRules());
    setOpen(true);
  };
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Select
        disabled={disabled}
        value={settings.permissionMode ?? "none"}
        onValueChange={(v) =>
          v === "custom"
            ? (setEditing(null), setName(""), setRules(defaultRules()), setOpen(true))
            : onSettings({ permissionMode: v })
        }
      >
        <SelectTrigger className="h-7 w-32 text-xs" aria-label="Agent permissions">
          <Shield className="h-3 w-3" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          <SelectItem value="ask">Ask</SelectItem>
          <SelectItem value="yolo">YOLO Mode</SelectItem>
          {(settings.permissionPresets ?? []).map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom…</SelectItem>
        </SelectContent>
      </Select>
      <Button
        disabled={disabled}
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label="Configure permissions"
        title="Configure permissions"
        onClick={configure}
      >
        <Settings2 className="h-3 w-3" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Custom agent permissions</DialogTitle>
          </DialogHeader>
          <Input
            aria-label="Configuration name"
            placeholder="Configuration name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {Object.entries(CAPABILITIES).map(([k, label]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="text-sm">{label}</span>
              <Select
                value={rules[k as Capability]}
                onValueChange={(v) => setRules((r) => ({ ...r, [k]: v as Decision }))}
              >
                <SelectTrigger className="h-8 w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="ask">Ask</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
          <DialogFooter>
            {editing && (
              <Button
                variant="destructive"
                onClick={() => {
                  onSettings({
                    permissionMode: "none",
                    permissionPresets: settings.permissionPresets.filter((p) => p.id !== editing),
                  });
                  setOpen(false);
                }}
              >
                Delete configuration
              </Button>
            )}
            <Button
              disabled={!name.trim()}
              onClick={() => {
                const id = editing ?? crypto.randomUUID();
                onSettings({
                  permissionMode: id,
                  permissionPresets: [
                    ...(settings.permissionPresets ?? []).filter((p) => p.id !== id),
                    { id, name: name.trim(), rules },
                  ],
                });
                setOpen(false);
                setName("");
              }}
            >
              Save configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
