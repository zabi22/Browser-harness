export const CAPABILITIES = {
  search: "Enabled web search",
  shell: "Offline Linux commands",
  filesRead: "Read workspace files",
  filesWrite: "Write and edit files",
  filesDelete: "Delete workspace files",
  cloudSync: "Cloud file pull / push",
  skills: "Load saved skills",
  media: "Enabled image / video generation",
  fetch: "Fetch public URLs",
  mcp: "MCP connections and tools",
  browser: "Read-only local browser actions",
  skillImport: "Import skills",
  network: "Linux networking",
  restart: "Restart Linux",
  wasm: "External WASM processes",
  timeout: "Change session timeouts",
  git: "Git repositories",
  autostart: "Start Linux automatically",
  build: "Remote builds (GitHub Actions)",
  publish: "Publish, roll back, domains",
} as const;
export type Capability = keyof typeof CAPABILITIES;
export type Decision = "no" | "ask" | "yes";
export type PermissionMode = "none" | "ask" | "yolo" | string;
export interface PermissionPreset {
  id: string;
  name: string;
  rules: Record<Capability, Decision>;
}
const baseline = new Set<Capability>([
  "search",
  "shell",
  "filesRead",
  "filesWrite",
  "cloudSync",
  "skills",
  "media",
]);
/** Actions that always need an explicit click: never auto-approved, not even by YOLO or a custom preset. */
export const ALWAYS_ASK = new Set<Capability>(["build", "publish", "filesDelete"]);
export function decision(
  mode: PermissionMode,
  capability: Capability,
  presets: PermissionPreset[] = [],
): Decision {
  const d = rawDecision(mode, capability, presets);
  return ALWAYS_ASK.has(capability) && d === "yes" ? "ask" : d;
}
function rawDecision(
  mode: PermissionMode,
  capability: Capability,
  presets: PermissionPreset[],
): Decision {
  if (mode === "yolo") return "yes";
  if (mode === "ask" && ["shell", "filesWrite", "cloudSync", "media"].includes(capability))
    return "ask";
  if (mode === "none" || mode === "ask")
    return baseline.has(capability) ? "yes" : mode === "ask" ? "ask" : "no";
  return presets.find((p) => p.id === mode)?.rules[capability] ?? "no";
}
export function defaultRules(): Record<Capability, Decision> {
  return Object.fromEntries(
    Object.keys(CAPABILITIES).map((k) => [k, decision("none", k as Capability)]),
  ) as Record<Capability, Decision>;
}
export function boundedTimeout(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 10 || n > 1800)
    throw new Error("Timeout must be between 10 and 1800 seconds");
  return Math.round(n);
}
