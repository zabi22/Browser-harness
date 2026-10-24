import { supabase } from "@/integrations/supabase/client";
import type { McpServer } from "./mcp-client";
import type { PermissionPreset } from "./agent-policy";
import {
  DEFAULT_MODEL,
  IMAGE_MODELS,
  MUSIC_MODELS,
  VIDEO_MODELS,
  type ThinkingEffort,
} from "./models";
import { readSse } from "./sse";
import { z } from "zod";
export { recordWav } from "./record-wav";

export interface Attachment {
  type: "image" | "doc" | "video" | "music" | "tool" | "reasoning";
  name: string;
  /** Tool trace: arguments sent and a preview of the result. */
  args?: string;
  output?: string;
  dataUrl?: string;
  text?: string;
  /** Generated media: the prompt the model wrote, the video job id and stored file path. */
  prompt?: string;
  jobId?: string;
  path?: string;
  error?: string;
  generated?: boolean;
}
export interface Msg {
  id: string;
  conversation_id: string;
  parent_id: string | null;
  role: string;
  content: string;
  attachments: Attachment[];
  model: string | null;
  created_at: string;
}
export interface Settings {
  model: string;
  temperature: number;
  maxTokens: number;
  frequencyPenalty: number;
  presencePenalty: number;
  thinking: boolean;
  thinkingEffort: ThinkingEffort;
  searxngUrl: string;
  webSearch: boolean;
  theme: string;
  imageGen: boolean;
  imageModel: string;
  imageQuality: "low" | "medium" | "high";
  videoGen: boolean;
  videoModel: string;
  videoResolution: string;
  videoDuration: number;
  musicGen: boolean;
  musicModel: string;
  fetchTool: boolean;
  mcpServers: McpServer[];
  visionTools: boolean;
  permissionMode: string;
  permissionPresets: PermissionPreset[];
  modelTimeout: number;
  toolTimeout: number;
  searchProvider: "searxng" | "brave";
  linuxAutostart: boolean;
  /** Linux VM memory in MiB; applies on next start. */
  linuxMemory: number;
  continueAtLimit?: boolean;
  /** Follow-up requests allowed per reply; ignored when infiniteContinuations is on. */
  maxContinuations?: number;
  infiniteContinuations?: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  model: DEFAULT_MODEL,
  temperature: 0.7,
  maxTokens: 4096,
  frequencyPenalty: 0,
  presencePenalty: 0,
  thinking: true,
  thinkingEffort: "low",
  searxngUrl: "",
  webSearch: false,
  theme: "paper",
  imageGen: false,
  imageModel: IMAGE_MODELS[0]!.id,
  imageQuality: "medium",
  videoGen: false,
  videoModel: VIDEO_MODELS[0]!.id,
  videoResolution: "720p",
  videoDuration: 6,
  musicGen: false,
  musicModel: MUSIC_MODELS[0]!.id,
  fetchTool: true,
  mcpServers: [],
  visionTools: true,
  permissionMode: "none",
  permissionPresets: [],
  modelTimeout: 600,
  toolTimeout: 120,
  searchProvider: "searxng",
  linuxAutostart: false,
  linuxMemory: 512,
  continueAtLimit: false,
};
export const THEMES = [
  { id: "paper", label: "Paper & Ink" },
  { id: "nebula", label: "Nebula indigo" },
  { id: "amber", label: "Graphite & amber" },
  { id: "midnight", label: "Midnight" },
  { id: "forest", label: "Forest" },
  { id: "rosewood", label: "Rosewood" },
  { id: "violet", label: "Violet" },
  { id: "oled", label: "OLED black" },
] as const;

export interface ToolCall {
  id: string;
  name: string;
  args: string;
  meta?: unknown;
}
const streamEvent = z.object({
  d: z.string().optional(),
  r: z.string().optional(),
  error: z.string().optional(),
  refusal: z.boolean().optional(),
  truncated: z.boolean().optional(),
  tool: z
    .object({
      id: z.string(),
      name: z.string().min(1),
      args: z.string(),
      meta: z.unknown().optional(),
    })
    .optional(),
});

/** Stream one model step. Text arrives via onDelta; returns the tool calls the model asked for. */
export async function streamChat(
  body: unknown,
  onDelta: (d: string) => void,
  signal: AbortSignal,
  onReasoning?: (r: string) => void,
  onTruncated?: () => void,
): Promise<ToolCall[]> {
  const calls: ToolCall[] = [];
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `Request failed (${res.status})`);
  }
  for await (const payload of readSse(res.body)) {
    if (payload === "[DONE]") return calls;
    const ev = streamEvent.parse(JSON.parse(payload) as unknown);
    if (ev.error) {
      const e = new Error(ev.error) as Error & { refusal?: boolean };
      if (ev.refusal) e.refusal = true;
      throw e;
    }
    if (ev.d) onDelta(ev.d);
    if (ev.r && onReasoning) onReasoning(ev.r);
    if (ev.tool?.name) {
      if (calls.length >= 128) throw new Error("Tool call limit exceeded");
      calls.push(ev.tool);
    }
    if (ev.truncated) onTruncated?.();
  }
  throw new Error("Connection interrupted before the reply finished");
}

/** Fetch top snippets from the user's SearXNG instance, directly from the browser. */
export async function searxSearch(base: string, q: string): Promise<string> {
  const url = `${base.replace(/\/+$/, "")}/search?q=${encodeURIComponent(q)}&format=json`;
  let r: Response;
  try {
    r = await fetch(url);
  } catch {
    // Browsers hide the reason; the usual causes are listed so the model can tell the user.
    throw new Error(
      `Could not reach the SearXNG server from this browser. Check that this device is on the same network/VPN (e.g. Tailscale) as ${base}, that it is running, and that it allows cross-origin requests from this site.`,
    );
  }
  if (r.status === 403)
    throw new Error(
      "SearXNG refused JSON results (403). Add `json` to search.formats in its settings.yml.",
    );
  if (!r.ok) throw new Error(`Search failed (${r.status})`);
  const j = await r.json();
  const results = (j.results ?? []).slice(0, 5) as {
    title?: string;
    url?: string;
    content?: string;
  }[];
  if (!results.length) return "";
  return results
    .map((x, i) => `[${i + 1}] ${x.title ?? ""} — ${x.url ?? ""}\n${x.content ?? ""}`)
    .join("\n\n");
}

export async function readFile(file: File): Promise<Attachment[]> {
  return readOne(file);
}
async function readOne(file: File): Promise<Attachment[]> {
  if (file.type.startsWith("image/")) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return [{ type: "image", name: file.name, dataUrl: c.toDataURL("image/jpeg", 0.85) }];
  }
  if (/\.(pdf|docx|pptx)$/i.test(file.name)) {
    const { parseDocument } = await import("./doc-parse");
    const { text, images } = await parseDocument(file);
    return [
      { type: "doc", name: file.name, text },
      ...images.map((dataUrl, i) => ({
        type: "image" as const,
        name: `${file.name} · image ${i + 1}`,
        dataUrl,
      })),
    ];
  }
  if (/\.(doc|ppt|xlsx?|zip)$/i.test(file.name))
    throw new Error(`${file.name}: use PDF, .docx, .pptx or a text file`);
  if (file.size > 25_000_000) throw new Error(`${file.name} is larger than 25 MB`);
  return [{ type: "doc", name: file.name, text: await file.text() }];
}

export function download(name: string, content: string, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
}

/** Call the internal media route (image / video jobs). */
export async function mediaCall<T>(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch("/api/media", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
    signal: signal ?? null,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
  return j as T;
}

export async function transcribe(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch("/api/media", {
    method: "POST",
    headers: await authHeaders(),
    body: form,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `Transcription failed (${res.status})`);
  return (j.text ?? "").trim();
}

/** Re-encode a generated PNG as a compact JPEG so it stores well in chat history. */
export async function compressDataUrl(url: string, max = 1024): Promise<string> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.88);
}
