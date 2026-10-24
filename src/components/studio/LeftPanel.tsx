import { Link } from "@tanstack/react-router";
import { Copy, Download, Film, Globe, ImageIcon, LogOut, MessageSquare, MoreHorizontal, Music, Palette, Plus, Settings2, ShieldCheck, Trash2, Upload } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Mascot } from "./Mascot";
import { ProjectsPanel } from "./ProjectsPanel";
import { Rocket } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { IMAGE_MODELS, MODELS, MUSIC_MODELS, VIDEO_MODELS, getImageModel, getModel, getVideoModel } from "@/lib/models";
import { THEMES, type Settings } from "@/lib/studio-client";
import { VSlider } from "./VSlider";
import { ThinkingControls } from "./ThinkingControls";
import { McpPanel } from "./McpPanel";
import { SkillsPanel } from "./SkillsPanel";
import type { Skill } from "@/lib/skills";
import { FilesPanel } from "./FilesPanel";
import { PermissionControls } from './PermissionControls';
import { EnvironmentPanel } from './EnvironmentPanel';
import { GitPanel } from './GitPanel';
import { FolderOpen, GitBranch, ScanText, Sparkles, Terminal } from "lucide-react";
import { toast } from "sonner";
import { useRef, useState } from "react";
import { WorkspaceTransferDialog } from "./WorkspaceTransferDialog";
import type { WorkspaceRow, WsFile } from "@/lib/workspace-fs";

export interface WsProps {
  list: WorkspaceRow[]; active: string | null; files: WsFile[]; reloadFiles: () => void; reload: () => Promise<void> | void;
  exportAs: (withFiles: boolean) => void; select: (id: string) => void;
}

export interface ConvRow { id: string; title: string; updated_at: string }

const GROUPS = [
  { key: "openai", label: "OpenAI" },
  { key: "anthropic", label: "Anthropic" },
  { key: "google", label: "Google" },
] as const;

export interface SessionActions {
  clone: (id: string) => void; exportAs: (id: string, fmt: "txt" | "json") => void; remove: (id: string) => void;
  importChat: (file: File) => Promise<void>;
}

export function LeftPanel({ settings, onSettings, conversations, activeId, actions, skills, reloadSkills, ws }: {
  settings: Settings; onSettings: (p: Partial<Settings>) => void; conversations: ConvRow[]; activeId?: string | undefined; actions: SessionActions; skills: Skill[]; reloadSkills: () => void; ws: WsProps;
}) {
  const model = getModel(settings.model);
  const [transfer, setTransfer] = useState(false);
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <WorkspaceTransferDialog open={transfer} onOpenChange={setTransfer} ws={ws} />
      <div className="px-4 pb-2 pt-5 text-[10px] font-medium text-muted-foreground">WORKSPACE</div>
      <div className="flex items-center gap-1 px-3 pb-4">
        <Select value={ws.active ?? ""} onValueChange={ws.select}>
          <SelectTrigger className="h-10 min-w-0 flex-1 bg-background text-xs"><FolderOpen className="h-3.5 w-3.5 text-primary" /><SelectValue placeholder="Workspace" /></SelectTrigger>
          <SelectContent>{ws.list.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Workspace options"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={async () => {
              const name = prompt("Workspace name"); if (!name?.trim()) return;
              const { data, error } = await supabase.from("workspaces").insert({ name: name.trim() }).select("id").single();
              if (error || !data) return void toast.error(error?.message ?? "Could not create");
              await ws.reload(); ws.select(data.id);
            }}><Plus className="h-4 w-4" /> New workspace</DropdownMenuItem>
            <DropdownMenuItem onClick={async () => {
              const cur = ws.list.find((w) => w.id === ws.active); const name = prompt("Rename workspace", cur?.name); if (!name?.trim() || !cur) return;
              await supabase.from("workspaces").update({ name: name.trim() }).eq("id", cur.id); ws.reload();
            }}>Rename</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTransfer(true)}><Download className="h-4 w-4" /> Import / export…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={ws.list.length < 2} onClick={async () => {
              if (!ws.active || !confirm("Delete this workspace with all its chats and files?")) return;
              const { error } = await supabase.from("workspaces").delete().eq("id", ws.active);
              if (error) return void toast.error(error.message);
              await ws.reload();
            }}><Trash2 className="h-4 w-4" /> Delete workspace</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Tabs defaultValue="chats" className="studio-nav flex min-h-0 flex-1 flex-col px-3">
        <TabsList className="mb-3 grid h-auto w-full shrink-0 grid-cols-2 gap-1 rounded-none border-b border-border bg-transparent px-0 pb-4">
          <TabsTrigger value="chats" title="Chats" aria-label="Chats"><MessageSquare className="h-4 w-4" /><span className="text-xs">Chats</span></TabsTrigger>
          <TabsTrigger value="files" title="Files" aria-label="Files"><FolderOpen className="h-4 w-4" /><span className="text-xs">Files</span></TabsTrigger>
          <TabsTrigger value="models" title="Models and tools" aria-label="Models and tools"><Sparkles className="h-4 w-4" /><span className="text-xs">Models</span></TabsTrigger>
          <TabsTrigger value="linux" title="Linux" aria-label="Linux"><Terminal className="h-4 w-4" /><span className="text-xs">Linux</span></TabsTrigger>
          <TabsTrigger value="git" title="Git" aria-label="Git"><GitBranch className="h-4 w-4" /><span className="text-xs">Git</span></TabsTrigger>
          <TabsTrigger value="projects" title="Projects and preview" aria-label="Projects and preview"><Rocket className="h-4 w-4" /><span className="text-xs">Projects</span></TabsTrigger>
        </TabsList>
        <TabsContent value="chats" className="min-h-0 flex-1 overflow-y-auto">
          <div className="mb-2 flex gap-1">
          <Button asChild className="h-9 min-w-0 flex-1 justify-start" size="sm">
            <Link to="/studio/{-$chatId}" params={{ chatId: undefined }}><Plus className="h-4 w-4" /> New chat</Link>
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Import chat from JSON" title="Import chat from JSON" disabled={importing || !ws.active} onClick={() => importRef.current?.click()}><Upload className="h-4 w-4" /></Button>
          <input ref={importRef} hidden type="file" accept=".json,application/json" onChange={async e => {
            const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
            setImporting(true); try { await actions.importChat(file); } finally { setImporting(false); }
          }} />
          </div>
          <div className="mb-3 mt-5 flex items-center justify-between px-2 text-[10px] text-muted-foreground"><span>RECENT CHATS</span><span className="font-mono">{conversations.length.toString().padStart(2, "0")}</span></div>
          <div className="space-y-1">
            {conversations.map((c) => (
              <div key={c.id} className={`group flex items-center rounded-md transition-colors ${c.id === activeId ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"}`}>
                <Link to="/studio/{-$chatId}" params={{ chatId: c.id }} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2.5 text-xs">
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{c.title}</span>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="mr-1 h-6 w-6 opacity-60 hover:opacity-100 group-hover:opacity-100" aria-label={`Options for ${c.title}`}>
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => actions.clone(c.id)}><Copy className="h-4 w-4" /> Clone</DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger><Download className="h-4 w-4" /> Export</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onClick={() => actions.exportAs(c.id, "txt")}>Text file (.txt)</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => actions.exportAs(c.id, "json")}>Full structure (.json)</DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => actions.remove(c.id)}><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
            {!conversations.length && <div className="flex flex-col items-center gap-3 px-2 py-8 text-xs text-muted-foreground"><MessageSquare className="h-6 w-6 stroke-1" /><p>No conversations yet</p></div>}
          </div>
        </TabsContent>
        <TabsContent value="files" className="min-h-0 flex-1 overflow-y-auto pb-4">
          <FilesPanel ws={ws.active} files={ws.files} reload={ws.reloadFiles} />
        </TabsContent>
        <TabsContent value="linux" className="min-h-0 flex-1 overflow-y-auto pb-4"><EnvironmentPanel ws={ws.active} settings={settings} onSettings={onSettings}/></TabsContent>
        <TabsContent value="git" className="min-h-0 flex-1 overflow-y-auto pb-4"><GitPanel ws={ws.active}/></TabsContent>
        <TabsContent value="projects" className="min-h-0 flex-1 overflow-y-auto pb-4"><ProjectsPanel ws={ws.active} files={ws.files} reload={ws.reloadFiles}/></TabsContent>
        <TabsContent value="models" className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-4">
          <div className="space-y-2 border-b border-border py-2"><Label className="text-xs">Agent permissions</Label><PermissionControls settings={settings} onSettings={onSettings}/><div className="grid grid-cols-2 gap-2"><Label className="text-[11px]">Model timeout (s)<Input type="number" min={10} max={1800} value={settings.modelTimeout} onChange={e=>onSettings({modelTimeout:Math.max(10,Math.min(1800,Number(e.target.value)||600))})}/></Label><Label className="text-[11px]">Tool timeout (s)<Input type="number" min={10} max={1800} value={settings.toolTimeout} onChange={e=>onSettings({toolTimeout:Math.max(10,Math.min(1800,Number(e.target.value)||120))})}/></Label></div></div>
          <div className="rounded-lg border border-border bg-card/50 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Your keys · <Link to="/settings" className="underline">manage</Link>
            </div>
            <Select value={settings.model} onValueChange={(v) => onSettings({ model: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {GROUPS.map((g) => (
                  <SelectGroup key={g.key}>
                    <SelectLabel>{g.label}</SelectLabel>
                    {MODELS.filter((m) => m.provider === g.key).map((m) => (
                      <SelectItem key={m.id} value={m.id} className="cursor-pointer transition-colors hover:bg-primary/15 hover:text-foreground focus:bg-primary/20 data-[highlighted]:bg-primary/20"><span className="flex items-center gap-2"><Mascot model={m.id} size={14} still />{m.label}</span></SelectItem>
                    ))}
                  </SelectGroup>
                ))}
                {settings.model.startsWith("custom/") && (
                  <SelectGroup><SelectLabel>OpenRouter / custom</SelectLabel>
                    <SelectItem value={settings.model}>{settings.model.slice(7)}</SelectItem>
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
            <form className="mt-2" onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get("cm")?.toString().trim(); if (v) onSettings({ model: `custom/${v}` }); }}>
              <Label className="text-[11px]">OpenRouter / custom model id
                <Input name="cm" placeholder="e.g. meta-llama/llama-4-maverick — press Enter" /></Label>
            </form>
          </div>

          <div className="rounded-lg border border-border bg-card/50 p-3">
            <div className="mb-3 text-xs font-semibold text-muted-foreground">Parameter matrix</div>
            <div className="mb-4"><ThinkingControls settings={settings} onSettings={onSettings} /></div>
            <div className={`grid gap-1 ${model?.penalties ? "grid-cols-4" : model?.temperature ? "grid-cols-2" : "grid-cols-1"}`}>
              {model?.temperature && <VSlider label="Temp" value={settings.temperature} min={0} max={2} step={0.05}
                onChange={(v) => onSettings({ temperature: v })} format={(v) => v.toFixed(2)} />}
              <VSlider label="Max tok" value={Math.max(settings.model === "anthropic/claude-haiku-4-5" && settings.thinking ? 2048 : 256, settings.maxTokens)} min={settings.model === "anthropic/claude-haiku-4-5" && settings.thinking ? 2048 : 256} max={32000} step={256}
                onChange={(v) => onSettings({ maxTokens: v })} format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`)} />
              {model?.penalties && <><VSlider label="Freq pen" value={settings.frequencyPenalty} min={-2} max={2} step={0.1}
                onChange={(v) => onSettings({ frequencyPenalty: v })} format={(v) => v.toFixed(1)} />
              <VSlider label="Pres pen" value={settings.presencePenalty} min={-2} max={2} step={0.1}
                onChange={(v) => onSettings({ presencePenalty: v })} format={(v) => v.toFixed(1)} /></>}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <Label htmlFor="continue-limit" className="text-xs">Auto-continuation</Label>
              <Switch id="continue-limit" checked={settings.continueAtLimit ?? false} onCheckedChange={(v) => onSettings({ continueAtLimit: v })} />
            </div>
            {settings.continueAtLimit && <>
              <div className="mt-2 flex items-center justify-between gap-2">
                <Label htmlFor="continue-infinite" className="text-xs">Unlimited follow-ups</Label>
                <Switch id="continue-infinite" checked={settings.infiniteContinuations ?? false} onCheckedChange={(v) => onSettings({ infiniteContinuations: v })} />
              </div>
              {!settings.infiniteContinuations && <div className="mt-2 flex items-center justify-between gap-2">
                <Label htmlFor="continue-max" className="text-xs">Max follow-ups</Label>
                <input id="continue-max" type="number" min={1} max={100} value={settings.maxContinuations ?? 3}
                  onChange={(e) => onSettings({ maxContinuations: Math.min(100, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
                  className="h-7 w-16 rounded-md border border-input bg-background px-2 text-xs" />
              </div>}
            </>}
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-card/50 p-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="ig" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><ImageIcon className="h-3.5 w-3.5" /> Image tool</Label>
              <Switch id="ig" checked={settings.imageGen} onCheckedChange={(v) => onSettings({ imageGen: v })} />
            </div>
            <div className={`space-y-2 ${settings.imageGen ? "" : "pointer-events-none opacity-40"}`}>
              <Select value={settings.imageModel} onValueChange={(v) => onSettings({ imageModel: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{IMAGE_MODELS.map((m) => <SelectItem key={m.id} value={m.id} className="data-[highlighted]:bg-primary/20">{m.label}</SelectItem>)}</SelectContent>
              </Select>
              {/* Gemini shapes have no quality field, so the control only shows where it does something. */}
              {getImageModel(settings.imageModel)?.quality && <Select value={settings.imageQuality} onValueChange={(v) => onSettings({ imageQuality: v as Settings["imageQuality"] })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{(["low", "medium", "high"] as const).map((q) => <SelectItem key={q} value={q} className="data-[highlighted]:bg-primary/20">Quality: {q}</SelectItem>)}</SelectContent>
              </Select>}
            </div>
            <p className="text-[11px] text-muted-foreground">Lets the chat model draw pictures when you ask.</p>
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-card/50 p-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="vg" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Film className="h-3.5 w-3.5" /> Video tool</Label>
              <Switch id="vg" checked={settings.videoGen} onCheckedChange={(v) => onSettings({ videoGen: v })} />
            </div>
            <div className={`space-y-2 ${settings.videoGen ? "" : "pointer-events-none opacity-40"}`}>
              <Select value={settings.videoModel} onValueChange={(v) => {
                const m = getVideoModel(v);
                onSettings({
                  videoModel: v,
                  videoResolution: m && !m.resolutions.includes(settings.videoResolution) ? m.resolutions[0]! : settings.videoResolution,
                  videoDuration: m && !m.durations.includes(settings.videoDuration) ? m.durations[Math.floor(m.durations.length / 2)]! : settings.videoDuration,
                });
              }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{VIDEO_MODELS.map((m) => <SelectItem key={m.id} value={m.id} className="data-[highlighted]:bg-primary/20">{m.label}</SelectItem>)}</SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-2">
                <Select value={settings.videoResolution} onValueChange={(v) => onSettings({ videoResolution: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{(getVideoModel(settings.videoModel)?.resolutions ?? ["720p"]).map((r) => <SelectItem key={r} value={r} className="data-[highlighted]:bg-primary/20">{r}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={String(settings.videoDuration)} onValueChange={(v) => onSettings({ videoDuration: Number(v) })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{(getVideoModel(settings.videoModel)?.durations ?? [4, 6, 8]).map((d) => <SelectItem key={d} value={String(d)} className="data-[highlighted]:bg-primary/20">{d} seconds</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Short clips with sound. Slow (1–3 min) and uses more credits.</p>
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-card/50 p-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="mg" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Music className="h-3.5 w-3.5" /> Music tool</Label>
              <Switch id="mg" checked={settings.musicGen} onCheckedChange={(v) => onSettings({ musicGen: v })} />
            </div>
            <div className={`space-y-2 ${settings.musicGen ? "" : "pointer-events-none opacity-40"}`}>
              <Select value={settings.musicModel} onValueChange={(v) => onSettings({ musicModel: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{MUSIC_MODELS.map((m) => <SelectItem key={m.id} value={m.id} className="data-[highlighted]:bg-primary/20">{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">Songs with or without vocals, from a description or lyrics.</p>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-card/50 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Palette className="h-3.5 w-3.5" /> Theme</div>
            <Select value={settings.theme} onValueChange={(v) => onSettings({ theme: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{THEMES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-card/50 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Globe className="h-3.5 w-3.5" /> Web tools</div>
            <div className="flex items-center justify-between">
              <Label htmlFor="ws" className="text-xs">Search tool</Label>
              <Switch id="ws" checked={settings.webSearch} onCheckedChange={(v) => onSettings({ webSearch: v })} />
            </div>
            <Select value={settings.searchProvider??'searxng'} onValueChange={v=>onSettings({searchProvider:v as Settings['searchProvider']})}><SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="searxng">Private SearXNG</SelectItem><SelectItem value="brave">Brave Search API</SelectItem></SelectContent></Select>
            {settings.searchProvider==='brave'&&<p className="text-xs text-muted-foreground">Brave Search · private key required</p>}
            <div className={`space-y-1 ${settings.webSearch && settings.searchProvider!=='brave' ? "" : "hidden"}`}>
              <Label htmlFor="searx" className="text-xs">SearXNG instance URL</Label>
              <Input id="searx" placeholder="https://searx.example.com" value={settings.searxngUrl}
                onChange={(e) => onSettings({ searxngUrl: e.target.value })} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="ft" className="text-xs">Fetch tool (read web pages)</Label>
              <Switch id="ft" checked={settings.fetchTool} onCheckedChange={(v) => onSettings({ fetchTool: v })} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="vt" className="flex items-center gap-1.5 text-xs"><ScanText className="h-3.5 w-3.5" /> Image viewing &amp; OCR tools</Label>
              <Switch id="vt" checked={settings.visionTools ?? true} onCheckedChange={(v) => onSettings({ visionTools: v })} />
            </div>
            <p className="text-[11px] text-muted-foreground">The model decides when to search, open a page, or look at an image.</p>
          </div>

          <McpPanel servers={settings.mcpServers ?? []} onChange={(mcpServers) => onSettings({ mcpServers })} />

          <SkillsPanel skills={skills} reload={reloadSkills} />
        </TabsContent>
      </Tabs>
      <div className="flex gap-1 border-t border-border p-2">
        <Button asChild variant="ghost" size="sm" className="flex-1 justify-start">
          <Link to="/settings"><Settings2 className="h-4 w-4" /> Settings</Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()} aria-label="Sign out"><LogOut className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
