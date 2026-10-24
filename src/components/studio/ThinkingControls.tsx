import { Brain } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resolveThinking, THINKING_EFFORTS } from "@/lib/models";
import type { Settings } from "@/lib/studio-client";

export function ThinkingControls({
  settings,
  onSettings,
  compact = false,
  disabled = false,
}: {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const state = resolveThinking(settings.model, settings.thinking, settings.thinkingEffort);
  return (
    <div className={`flex min-w-0 items-center ${compact ? "gap-1.5" : "gap-2"}`}>
      <Brain className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      {!compact && (
        <span className="flex-1 text-xs">Thinking{!state.canDisable ? " · required" : ""}</span>
      )}
      <Switch
        aria-label={compact ? "Composer thinking" : "Model thinking"}
        checked={state.enabled}
        disabled={disabled || !state.canDisable || !state.efforts.length}
        title={
          !state.efforts.length
            ? "Verified thinking controls are unavailable for this connection"
            : state.canDisable
              ? "Thinking"
              : "This model requires thinking"
        }
        onCheckedChange={(thinking) => onSettings({ thinking })}
      />
      <Select
        value={state.effort}
        disabled={disabled || !state.enabled}
        onValueChange={(effort) =>
          onSettings({ thinkingEffort: THINKING_EFFORTS.find((e) => e === effort) ?? "low" })
        }
      >
        <SelectTrigger
          aria-label={compact ? "Composer effort" : "Model effort"}
          className="h-7 w-24 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {state.efforts.map((effort) => (
            <SelectItem key={effort} value={effort}>
              {effort}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
