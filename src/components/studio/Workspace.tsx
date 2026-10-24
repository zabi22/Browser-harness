import { formatAttachment, compressText, COMPRESSION_GUIDELINE } from "@/lib/compress";
/** Local compaction must reach this fraction of the original tokens, else fall back to AI summary. */
const LOCAL_COMPACT_RATIO = 0.6;
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowUp, Brain, Check, ChevronLeft, ChevronRight, Copy, Eraser, FileText, Film, Gauge, ImageIcon, Library, Loader2, Menu, Mic, Music, Paperclip, Pause, Pencil, RotateCcw, Scissors, Sparkles, Square, Trash2, Wrench, X, PanelRight, Command, FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { getModel } from "@/lib/models";
import { deepestLeaf, latestLeaf, pathTo, siblingsOf } from "@/lib/tree";
import { CONTEXT_ROLE, activeContext, chunkText, estimateTokens, fileTokenLimit, formatTokens, messageTokens } from "@/lib/context";
import {
  DEFAULT_SETTINGS, download, mediaCall, readFile, recordWav, streamChat, transcribe,
  type Attachment, type Msg, type Settings,
} from "@/lib/studio-client";
import { LeftPanel, type ConvRow } from "./LeftPanel";
import { RightPanel, type PromptRow } from "./RightPanel";
import { Markdown } from "./Markdown";
import { Mascot } from "./Mascot";
import { ThinkingControls } from "./ThinkingControls";
import { runAgentLoop, type Steering } from '@/lib/agent-loop';
import { PermissionControls } from './PermissionControls';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { decision, type Capability } from '@/lib/agent-policy';
import type { Skill } from "@/lib/skills";
import { listFiles, loadWorkspaces, readBlob, type WorkspaceRow, type WsFile } from "@/lib/workspace-fs";
import { linuxFor } from "@/lib/linux-environment";
import { inactiveAttachments, partialReply, readRecovery, recoveryKey, recoveryMessages, type RunRecovery } from '@/lib/run-recovery';
import { prepareChatImport } from '@/lib/chat-import';

type ApiMsg = { role: "user" | "assistant"; content: string; images: string[] };
type Streaming = { parentId: string; text: string; tools: Attachment[]; reasoning: string };

/** Cross-tab run ownership. Holding a Web Lock also keeps background tabs from being frozen mid-reply. */
async function runLocked(convId: string) {
  if (typeof navigator === 'undefined' || !navigator.locks) return false;
  const state = await navigator.locks.query();
  return !!state.held?.some((l) => l.name === `obh-run:${convId}`);
}
function holdRunLock(convId: string): Promise<(() => void) | null> {
  if (typeof navigator === 'undefined' || !navigator.locks) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    void navigator.locks.request(`obh-run:${convId}`, { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(null); return; }
      return new Promise<void>((done) => resolve(done));
    });
  });
}

export function Workspace({ chatId }: { chatId?: string | undefined }) {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const settingsRef=useRef(settings);settingsRef.current=settings;
  const [approval,setApproval]=useState<{action:string;args:Record<string,unknown>;resolve:(v:boolean)=>void}|null>(null);
  const [question,setQuestion]=useState<{question:string;choices:string[];resolve:(v:string)=>void}|null>(null);
  const [answer,setAnswer]=useState('');
  const approve=(_cap:Capability,action:string,args:Record<string,unknown>,signal:AbortSignal)=>new Promise<boolean>(resolve=>{
    const stop=()=>{setApproval(null);resolve(false);};if(signal.aborted)return resolve(false);signal.addEventListener('abort',stop,{once:true});
    setApproval({action,args,resolve:v=>{signal.removeEventListener('abort',stop);setApproval(null);resolve(v);}});
  });
  const askUser=(q:string,choices:string[],signal:AbortSignal)=>new Promise<string>(resolve=>{
    const stop=()=>{setQuestion(null);resolve('User cancelled');};if(signal.aborted)return resolve('User cancelled');signal.addEventListener('abort',stop,{once:true});setAnswer('');
    setQuestion({question:q,choices,resolve:v=>{signal.removeEventListener('abort',stop);setQuestion(null);resolve(v);}});
  });
  const [conversations, setConversations] = useState<ConvRow[]>([]);
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [wsId, setWsId] = useState<string | null>(null);
  const wsIdRef = useRef(wsId);
  wsIdRef.current = wsId;
  const [files, setFiles] = useState<WsFile[]>([]);
  const reloadFiles = useCallback(async () => { if (wsId) setFiles(await listFiles(wsId).catch(() => [])); }, [wsId]);
  useEffect(() => { reloadFiles(); }, [reloadFiles]);
  const reloadWorkspaces = useCallback(async () => {
    try {
      const list = await loadWorkspaces();
      setWorkspaces(list);
      setWsId((cur) => (cur && list.some((w) => w.id === cur) ? cur : (list.find((w) => w.id === localStorage.getItem("obh:ws")) ?? list[0])?.id ?? null));
    } catch (e) { toast.error((e as Error).message); }
  }, []);
  useEffect(() => { reloadWorkspaces(); }, [reloadWorkspaces]);
  useEffect(() => { if (wsId) localStorage.setItem("obh:ws", wsId); }, [wsId]);
  useEffect(() => {
    if (!wsId || !settings.linuxAutostart) return;
    if (decision(settings.permissionMode ?? "none", "autostart", settings.permissionPresets ?? []) !== "yes") return;
    const env = linuxFor(wsId);
    if (env.state === "stopped") void env.start().catch((e) => toast.error((e as Error).message));
    // No cleanup: switching chats/panels must not stop the guest.
  }, [wsId, settings.linuxAutostart, settings.permissionMode, settings.permissionPresets]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [leaf, setLeaf] = useState<string | null>(null);
  const messagesRef = useRef<Msg[]>([]);
  messagesRef.current = messages;
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [compacting, setCompacting] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  // Runs keep going per chat; switching chats only changes which run is on screen.
  const runsRef = useRef(new Map<string, { run: RunRecovery; ctrl: AbortController; steering: Steering; interrupted: boolean; view: Streaming }>());
  const visibleChatRef = useRef(chatId);
  visibleChatRef.current = chatId;
  const [recovery, setRecovery] = useState<RunRecovery | null>(null);
  const [online, setOnline] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const journalWarningRef = useRef(false);
  const saveJournal = (run: RunRecovery) => {
    try { localStorage.setItem(recoveryKey(run.ownerId, run.conversationId), JSON.stringify(run)); }
    catch { if (!journalWarningRef.current) { journalWarningRef.current = true; toast.error('Not enough browser storage to save interruption recovery.'); } }
  };
  useEffect(() => {
    const offline = () => {
      setOnline(false);
      if (runsRef.current.size) {
        for (const live of runsRef.current.values()) { live.interrupted = true; saveJournal(live.run); live.ctrl.abort(); }
        toast.warning('Connection lost. Your progress is saved on this browser.');
      }
    };
    const connected = () => setOnline(true);
    const leaving = () => { for (const live of runsRef.current.values()) saveJournal(live.run); };
    setOnline(navigator.onLine);
    window.addEventListener('offline', offline);
    window.addEventListener('online', connected);
    window.addEventListener('pagehide', leaving);
    return () => {
      leaving();
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', connected);
      window.removeEventListener('pagehide', leaving);
      for (const live of runsRef.current.values()) { live.interrupted = true; live.ctrl.abort(); }
      abortRef.current?.abort();
    };
  }, []);
  const skipLoadRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // On phones, close the chat drawer once a chat is opened.
  useEffect(() => { setLeftOpen(false); }, [chatId]);

  const reloadSkills = useCallback(async () => {
    const { data } = await supabase.from("skills").select("*").order("created_at");
    setSkills((data ?? []) as unknown as Skill[]);
  }, []);

  useEffect(() => {
    let active=true;
    Promise.all([supabase.from('studio_settings').select('data').maybeSingle(),chatId?supabase.from('conversations').select('agent_settings').eq('id',chatId).maybeSingle():Promise.resolve({data:null})]).then(([global,session])=>{
      if(!active)return;
      const next={...DEFAULT_SETTINGS,...(global.data?.data as Partial<Settings>??{}),...(session.data?.agent_settings as Partial<Settings>??{})};
      settingsRef.current=next;setSettings(next);
    });
    return ()=>{active=false;};
  },[chatId]);
  useEffect(() => {
    supabase.from("prompts").select("*").order("created_at").then(({ data }) => setPrompts((data ?? []) as PromptRow[]));
    reloadSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    if (settings.theme && settings.theme !== "paper") el.dataset["theme"] = settings.theme;
    else delete el.dataset["theme"];
    el.classList.toggle("dark", settings.theme !== "paper");
  }, [settings.theme]);

  const loadConversations = useCallback(async () => {
    if (!wsId) return;
    const { data } = await supabase.from("conversations").select("id, title, updated_at").eq("workspace_id", wsId).order("updated_at", { ascending: false });
    setConversations(data ?? []);
  }, [wsId]);
  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    if (chatId && skipLoadRef.current === chatId) { skipLoadRef.current = null; return; }
    let active = true;
    setStreaming(chatId ? runsRef.current.get(chatId)?.view ?? null : null);
    setRecovery(null);
    if (!chatId) {
      setMessages([]); setLeaf(null);
      void supabase.auth.getSession().then(({ data }) => {
        if (!active || !data.session) return;
        const ownerId = data.session.user.id;
        const candidates: RunRecovery[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          const prefix = `obh:recovery:${ownerId}:`;
          if (!key?.startsWith(prefix)) continue;
          const saved = readRecovery(localStorage, ownerId, key.slice(prefix.length));
          if (!saved || runsRef.current.has(saved.conversationId)) continue;
          candidates.push(saved);
        }
        void (async () => {
          for (const saved of candidates) {
            if (await runLocked(saved.conversationId)) continue;
            const { data: c } = await supabase.from('conversations').select('workspace_id').eq('id', saved.conversationId).maybeSingle();
            if (!active || (c && c.workspace_id !== wsIdRef.current)) continue;
            setRecovery(saved); break;
          }
        })();
      });
      return () => { active = false; };
    }
    (async () => {
      const [{ data: conv }, { data: msgs }] = await Promise.all([
        supabase.from("conversations").select("current_leaf_id, workspace_id").eq("id", chatId).maybeSingle(),
        supabase.from("messages").select("*").eq("conversation_id", chatId).order("created_at"),
      ]);
      if (!active) return;
      if (!conv) { if (navigator.onLine) { toast.error("Chat not found"); navigate({ to: "/studio/{-$chatId}", params: { chatId: undefined } }); } return; }
      const list = (msgs ?? []) as unknown as Msg[];
      const { data: auth } = await supabase.auth.getSession();
      if (!active) return;
      const journal = auth.session ? readRecovery(localStorage, auth.session.user.id, chatId) : null;
      // A journal for a run that is still live (here or in another tab) is not an interruption.
      const saved = journal && !runsRef.current.has(chatId) && !(await runLocked(chatId)) ? journal : null;
      if (!active) return;
      if (saved && list.some(m => m.id === saved.draft.parent_id)) {
        const draft = partialReply(saved);
        const index = list.findIndex(m => m.id === draft.id);
        if (index >= 0) list[index] = draft; else list.push(draft);
        setRecovery(saved);
      }
      if (conv.workspace_id) setWsId(conv.workspace_id);
      setMessages(list);
      setLeaf(saved?.draft.id && list.some(m => m.id === saved.draft.id) ? saved.draft.id : conv.current_leaf_id && list.some((m) => m.id === conv.current_leaf_id) ? conv.current_leaf_id : latestLeaf(list));
    })();
    return () => { active = false; };
  }, [chatId, navigate]);

  const updateSettings = (p: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...p };
      settingsRef.current=next;
      if(chatId && ('permissionMode' in p || 'permissionPresets' in p || 'modelTimeout' in p || 'toolTimeout' in p))void supabase.from('conversations').update({agent_settings:{permissionMode:next.permissionMode,permissionPresets:next.permissionPresets,modelTimeout:next.modelTimeout,toolTimeout:next.toolTimeout} as never}).eq('id',chatId);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const { data: u } = await supabase.auth.getUser();
        if (u.user) await supabase.from("studio_settings").upsert({ user_id: u.user.id, data: next as never, updated_at: new Date().toISOString() });
      }, 600);
      return next;
    });
  };

  const path = useMemo(() => pathTo(leaf, messages), [leaf, messages]);
  const systemText = useMemo(() => prompts.filter((p) => p.kind === "system" && p.enabled && p.content.trim()).map((p) => p.content).join("\n\n"), [prompts]);
  const fragmentText = useMemo(() => prompts.filter((p) => p.kind === "fragment" && p.enabled && p.content.trim()).map((p) => p.content).join("\n\n"), [prompts]);

  const usage = useMemo(() => {
    const ctx = activeContext(path);
    const used = estimateTokens(systemText + ctx.summary + fragmentText) + ctx.messages.reduce((n, m) => n + messageTokens(m), 0) + estimateTokens(streaming?.text ?? "");
    const max = getModel(settings.model)?.context ?? 128_000;
    return { used, max, pct: Math.min(100, (used / max) * 100) };
  }, [path, systemText, fragmentText, streaming?.text, settings.model]);

  const setActiveLeaf = async (id: string | null, convId = chatId) => {
    setLeaf(id);
    if (convId) await supabase.from("conversations").update({ current_leaf_id: id, updated_at: new Date().toISOString() }).eq("id", convId);
  };

  /** Turn a path into model messages, honouring the latest truncate/summary marker. */
  const toApi = (history: Msg[], annotation = "") => {
    const ctx = activeContext(history);
    let anyCompressed = false;
    const msgs: ApiMsg[] = ctx.messages.map((m, i) => {
      const docs = m.attachments.filter((a) => a.type === "doc").map((a) => {
        const f = formatAttachment(a.name, a.text ?? "");
        if (f.compressed) anyCompressed = true;
        return f.block;
      }).join("");
      const isLast = i === ctx.messages.length - 1 && m.role === "user";
      return {
        role: m.role as "user" | "assistant",
        content: (m.role === "assistant" && !m.content.trim() ? "[Didn't reply]" : m.content) + docs + (isLast ? annotation + (fragmentText ? `\n\n${fragmentText}` : "") : ""),
        images: m.role === "user" ? m.attachments.filter((a) => a.type === "image").map((a) => a.dataUrl!).filter(Boolean) : [],
      };
    });
    const enabled = skills.filter((k) => k.enabled);
    const skillsText = enabled.length ? `Available skills — call the load_skill tool to read one in full before relying on it:\n${enabled.map((k) => `- ${k.name}: ${k.description || "no description"}`).join("\n")}` : "";
    const system = [anyCompressed && COMPRESSION_GUIDELINE, systemText, skillsText, ctx.summary && `Summary of the earlier conversation:\n${ctx.summary}`].filter(Boolean).join("\n\n");
    return { system, msgs };
  };

  const params = () => ({ temperature: settings.temperature, maxTokens: settings.maxTokens, frequencyPenalty: settings.frequencyPenalty, presencePenalty: settings.presencePenalty, thinking: settings.thinking, thinkingEffort: settings.thinkingEffort });

  /** Stream a reply to `userMsg`, running any tools the model calls, and save it as a new child (a new branch if one exists). */
  const generate = async (userMsg: Msg, all: Msg[], convId: string, previous?: RunRecovery) => {
    if (!navigator.onLine) return void toast.error('You are offline. Reconnect before continuing.');
    const { data: auth } = await supabase.auth.getSession();
    if (!auth.session) return void toast.error('Sign in to continue.');
    if (runsRef.current.has(convId)) return void toast.error('This chat is already replying.');
    const release = await holdRunLock(convId);
    if (!release) return void toast.error('This chat is already replying in another tab.');
    const startedOn = chatId;
    const visible = () => visibleChatRef.current === convId || (startedOn === undefined && visibleChatRef.current === undefined);
    const show = (v: Streaming) => { live.view = v; if (visible()) setStreaming(v); };
    const { system, msgs } = toApi(pathTo(userMsg.id, all));
    const run: RunRecovery = {
      ownerId: auth.session.user.id, conversationId: convId, updatedAt: new Date().toISOString(),
      draft: previous?.draft ?? { id: crypto.randomUUID(), conversation_id: convId, parent_id: userMsg.id, role: 'assistant', content: '', attachments: [], model: settings.model, created_at: new Date().toISOString() },
    };
    const ctrl = new AbortController();
    const live = { run, ctrl, steering: { queue: [] as string[] } as Steering, interrupted: false, view: { parentId: userMsg.id, text: "", tools: [], reasoning: "" } as Streaming };
    runsRef.current.set(convId, live);
    show(live.view);
    saveJournal(run);
    setRecovery(null);
    let out = previous?.draft.content ?? '';
    let failed: string | null = null;
    let refused = false;
    let trace: Attachment[] = previous ? inactiveAttachments(previous.draft.attachments) : [];
    const prefix = out ? out + '\n\n' : '';
    const priorTrace = trace;
    let lastSaved = 0;
    try {
      const result=await runAgentLoop({settings,system,messages:previous ? [...msgs, ...recoveryMessages(previous.draft)] : msgs,skills,onSkillsChanged:reloadSkills,
        ctx:{workspaceId:wsId??undefined,sessionId:convId,onFilesChanged:reloadFiles,getSettings:()=>settingsRef.current,approve,askUser,
          chatImages:()=>pathTo(userMsg.id, all).flatMap(m=>m.role==="user"?(m.attachments??[]).filter(a=>a.type==="image"&&a.dataUrl).map(a=>({name:a.name,dataUrl:a.dataUrl!})):[]),
          setTimeout:(kind,seconds)=>updateSettings(kind==='model'?{modelTimeout:seconds}:{toolTimeout:seconds})},
        signal:ctrl.signal,steering:live.steering,onUpdate:r=>{
          out=prefix+r.text;trace=[...priorTrace,...r.segments];
          run.draft={...run.draft,content:out,attachments:trace};run.updatedAt=new Date().toISOString();
          if (Date.now()-lastSaved>300) {saveJournal(run);lastSaved=Date.now();}
          show({parentId:userMsg.id,text:out,tools:trace,reasoning:''});
        }});
      out=prefix+result.text;trace=[...priorTrace,...result.segments];
    } catch (e) {
      if (!ctrl.signal.aborted && (e as { refusal?: boolean }).refusal) {
        // Provider refusal is terminal: keep what was written, no resume prompt (resuming would replay it).
        refused = true;
        toast.error((e as Error).message, { description: "The model provider's safety filter ended this reply. This came from the provider, not OBH, and can trigger on harmless topics." });
      } else if (!ctrl.signal.aborted) {
        failed = (e as Error).message;
        if (/flagged|cyber_policy|safety|content policy/i.test(failed)) {
          toast.error(failed, { description: "The provider's safety filter rejected this message — often triggered by a very large attached file or tool result." });
          failed = null;
        }
      }
    }
    const interrupted = live.interrupted || !!failed;
    runsRef.current.delete(convId);
    release();
    run.draft = { ...run.draft, content: out, attachments: trace };
    saveJournal(run);
    const onScreen = visible();
    if (onScreen) setStreaming(null);
    if (failed) toast.error(failed);
    if (interrupted) {
      const draft = partialReply(run);
      if (onScreen) {
        setRecovery(run);
        setMessages(prev => [...prev.filter(m => m.id !== draft.id), draft]);
        setLeaf(draft.id);
      }
      // Keep the journal for consent-based resume and as fallback for failed account writes.
      try {
        await supabase.from('messages').upsert({ ...draft, attachments: draft.attachments as never }).throwOnError();
        await supabase.from('conversations').update({ current_leaf_id: draft.id, updated_at: new Date().toISOString() }).eq('id', convId).throwOnError();
        await loadConversations();
      } catch { if (onScreen) toast.warning('Progress is saved in this browser. It could not be saved to your account yet.'); }
      return;
    }
    if (!out.trim() && !trace.length && !ctrl.signal.aborted && !refused) { localStorage.removeItem(recoveryKey(run.ownerId, convId)); await setActiveLeaf(userMsg.id, convId); loadConversations(); return; }
    const { data: aRow, error: aErr } = await supabase.from("messages")
      .upsert({ ...run.draft, content: (out.trim() ? out : "[Didn't reply]") + (refused ? "\n\n_(Stopped by the provider's safety filter)_" : ctrl.signal.aborted ? "\n\n_(stopped)_" : ""), attachments: inactiveAttachments(trace) as never })
      .select().single();
    if (aErr || !aRow) { if (visible()) { setRecovery(run); const draft = partialReply(run); setMessages(prev => [...prev.filter(m => m.id !== draft.id), draft]); setLeaf(draft.id); } toast.error(aErr?.message ?? "Could not save reply"); return; }
    if (visible()) setMessages((prev) => [...prev.filter(m => m.id !== aRow.id), aRow as unknown as Msg]);
    const { error: leafError } = await supabase.from('conversations').update({ current_leaf_id: aRow.id, updated_at: new Date().toISOString() }).eq('id', convId);
    if (visible()) setLeaf(aRow.id);
    if (leafError) { if (visible()) setRecovery(run); return; }
    localStorage.removeItem(recoveryKey(run.ownerId, convId));
    loadConversations();
  };

  const recoverRun = async (mode: 'resume' | 'restart' | 'keep') => {
    if (!recovery || recovering || streaming || !online) return;
    const run = recovery;
    const parent = messages.find(m => m.id === run.draft.parent_id);
    if (!parent) return void toast.error('The original prompt is no longer available.');
    setRecovering(true);
    try {
      const draft = partialReply(run);
      const { error } = await supabase.from('messages').upsert({ ...draft, attachments: draft.attachments as never });
      if (error) throw error;
      await supabase.from('conversations').update({ current_leaf_id: draft.id }).eq('id', run.conversationId).throwOnError();
      localStorage.removeItem(recoveryKey(run.ownerId, run.conversationId));
      setRecovery(null);
      if (mode === 'keep') return;
      await generate(parent, messages, run.conversationId, mode === 'resume' ? run : undefined);
    } catch (e) { toast.error((e as Error).message || 'Could not reconnect. Your saved progress is still available.'); }
    finally { setRecovering(false); }
  };

  /** Persist a patch to one attachment of a message (local state + database). */
  // Latest attachments per message, kept outside React state so DB writes never depend on render timing.
  const attachRef = useRef(new Map<string, Attachment[]>());
  const patchAttachment = async (msgId: string, idx: number, patch: Partial<Attachment>) => {
    const base = attachRef.current.get(msgId) ?? messagesRef.current.find((m) => m.id === msgId)?.attachments ?? [];
    const attachments = base.map((a, i) => (i === idx ? { ...a, ...patch } : a));
    attachRef.current.set(msgId, attachments);
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, attachments } : m)));
    const write = () => supabase.from("messages").update({ attachments: attachments as never }).eq("id", msgId);
    let { error } = await write();
    if (error) { await new Promise((r) => setTimeout(r, 1500)); ({ error } = await write()); }
    if (error) toast.error("The generated media couldn't be saved to this chat.");
  };

  const send = async (text: string, attachments: Attachment[], parentId: string | null) => {
    if (recovery && recovery.conversationId === chatId) return void toast.info('Choose Resume, Restart, or Keep partial reply first.');
    if (streaming || compacting) return;
    if (!text.trim() && !attachments.length) return;
    let convId = chatId;
    if (!convId) {
      let targetWs = wsId;
      if (!targetWs) {
        const list = await loadWorkspaces().catch(() => []);
        targetWs = list[0]?.id ?? null;
        if (targetWs) setWsId(targetWs);
      }
      if (!targetWs) return void toast.error("No workspace available yet — try again in a moment");
      const { data, error } = await supabase.from("conversations").insert({ title: text.trim().slice(0, 60) || "New chat", workspace_id: targetWs, agent_settings:{permissionMode:settings.permissionMode,permissionPresets:settings.permissionPresets,modelTimeout:settings.modelTimeout,toolTimeout:settings.toolTimeout} as never }).select("id").single();
      if (error || !data) return void toast.error(error?.message ?? "Could not create chat");
      convId = data.id;
      if (targetWs === wsId) setConversations((prev) => [{ id: data.id, title: text.trim().slice(0, 60) || "New chat", updated_at: new Date().toISOString() }, ...prev.filter((c) => c.id !== data.id)]);
      skipLoadRef.current = convId;
      navigate({ to: "/studio/{-$chatId}", params: { chatId: convId } });
    }
    const { data: userRow, error: uErr } = await supabase.from("messages")
      .insert({ conversation_id: convId, parent_id: parentId, role: "user", content: text, attachments: attachments as never })
      .select().single();
    if (uErr || !userRow) return void toast.error(uErr?.message ?? "Could not save message");
    const userMsg = userRow as unknown as Msg;
    const all = [...messages.filter((m) => m.conversation_id === convId), userMsg];
    setMessages(all);
    setLeaf(userMsg.id);

    await generate(userMsg, all, convId);
  };

  const redo = (m: Msg) => {
    if (streaming || !chatId) return;
    const parent = messages.find((x) => x.id === m.parent_id);
    if (parent) generate(parent, messages, chatId);
  };

  const deleteMessage = async (m: Msg) => {
    if (!chatId || streaming) return;
    if (!confirm(m.role === "user" ? "Delete this prompt and everything after it?" : "Delete this message and everything after it?")) return;
    const { error } = await supabase.from("messages").delete().eq("id", m.id);
    if (error) return void toast.error(error.message);
    const gone = new Set([m.id]);
    let grew = true;
    while (grew) { grew = false; for (const x of messages) if (x.parent_id && gone.has(x.parent_id) && !gone.has(x.id)) { gone.add(x.id); grew = true; } }
    const rest = messages.filter((x) => !gone.has(x.id));
    setMessages(rest);
    const sib = siblingsOf(m, messages).filter((s) => s.id !== m.id).pop();
    await setActiveLeaf(sib ? deepestLeaf(sib.id, rest) : m.parent_id);
  };

  /** On-demand context compaction: drop or summarise everything before this point. */
  const compact = async (mode: "truncate" | "summarize") => {
    if (!chatId || !leaf || streaming || compacting) return;
    let content = "";
    if (mode === "summarize") {
      const { system, msgs } = toApi(path);
      if (!msgs.length && !activeContext(path).summary) return void toast.info("Nothing to summarize yet.");
      // First line of defence: free local compression. Use it if it saves enough.
      const prior = activeContext(path).summary;
      const transcript = (prior ? `Earlier summary:\n${prior}\n\n` : "") + msgs.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
      const packed = compressText(transcript);
      const before = estimateTokens(transcript), after = estimateTokens(packed);
      if (after <= before * LOCAL_COMPACT_RATIO) {
        content = `[Locally compressed transcript — ${COMPRESSION_GUIDELINE}]\n${packed}`;
        toast.info(`Compressed locally: ~${formatTokens(before)} → ~${formatTokens(after)} tokens, no AI used.`);
      }
    }
    if (mode === "summarize" && !content) {
      const { system, msgs } = toApi(path);
      setCompacting(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        await streamChat({
          model: settings.model, system,
          messages: [...msgs, { role: "user", content: "Summarize our whole conversation so far into a compact but complete brief I can use to continue later. Keep key facts, decisions, code, names and open questions. Reply with the summary only.", images: [] }],
          params: params(),
        }, (d) => { content += d; }, ctrl.signal);
      } catch (e) {
        if (!ctrl.signal.aborted) {
          const msg = (e as Error).message;
          if (/flagged|cyber_policy|safety|content policy/i.test(msg)) {
            toast.error(msg, { description: "The provider's safety filter rejected the summary request. Try 'Drop earlier context' instead." });
          } else toast.error(msg);
        }
        content = "";
      }
      abortRef.current = null;
      setCompacting(false);
      if (!content.trim()) return;
    }
    const { data, error } = await supabase.from("messages")
      .insert({ conversation_id: chatId, parent_id: leaf, role: CONTEXT_ROLE, content: content.trim() })
      .select().single();
    if (error || !data) return void toast.error(error?.message ?? "Could not compact");
    setMessages((p) => [...p, data as unknown as Msg]);
    await setActiveLeaf(data.id);
    toast.success(mode === "summarize" ? "Context summarized" : "Earlier context dropped");
  };

  const fetchConv = async (id: string) => {
    if (id === chatId) return { msgs: messages, leafId: leaf };
    const [{ data: conv }, { data: msgs }] = await Promise.all([
      supabase.from("conversations").select("current_leaf_id").eq("id", id).maybeSingle(),
      supabase.from("messages").select("*").eq("conversation_id", id).order("created_at"),
    ]);
    const list = (msgs ?? []) as unknown as Msg[];
    return { msgs: list, leafId: conv?.current_leaf_id ?? latestLeaf(list) };
  };

  const deleteChat = async (id: string) => {
    if (!confirm("Delete this chat permanently?")) return;
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    if (error) return void toast.error(error.message);
    await loadConversations();
    if (id === chatId) navigate({ to: "/studio/{-$chatId}", params: { chatId: undefined } });
  };

  const cloneChat = async (id: string) => {
    const { msgs, leafId } = await fetchConv(id);
    const title = conversations.find((c) => c.id === id)?.title ?? "Chat";
    const idMap = new Map(msgs.map((m) => [m.id, crypto.randomUUID()]));
    const newId = crypto.randomUUID();
    const { error } = await supabase.from("conversations").insert({ id: newId, workspace_id: wsId, title: `${title} (copy)`, current_leaf_id: (leafId && idMap.get(leafId)) || null });
    if (error) return void toast.error(error.message);
    if (msgs.length) {
      const rows = [...msgs].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((m) => ({
        id: idMap.get(m.id)!, conversation_id: newId, parent_id: m.parent_id ? idMap.get(m.parent_id)! : null,
        role: m.role, content: m.content, attachments: m.attachments as never, model: m.model, created_at: m.created_at,
      }));
      const { error: mErr } = await supabase.from("messages").insert(rows);
      if (mErr) return void toast.error(mErr.message);
    }
    toast.success("Chat cloned");
    await loadConversations();
    navigate({ to: "/studio/{-$chatId}", params: { chatId: newId } });
  };

  const exportChat = async (id: string, fmt: "txt" | "json") => {
    const { msgs, leafId } = await fetchConv(id);
    const p = pathTo(leafId, msgs);
    const title = conversations.find((c) => c.id === id)?.title ?? "chat";
    const safe = title.replace(/[^\w-]+/g, "_").slice(0, 40);
    if (fmt === "txt") {
      const txt = p.map((m) => m.role === CONTEXT_ROLE
        ? `[${m.content ? `Context summary]\n${m.content}` : "Earlier context dropped]"}`
        : `${m.role === "user" ? "You" : getModel(m.model ?? "")?.label ?? "Assistant"}:\n${m.content}`).join("\n\n---\n\n");
      download(`${safe}.txt`, txt);
    } else {
      download(`${safe}.json`, JSON.stringify({ title, activePath: p.map((m) => m.id), messages: msgs }, null, 2), "application/json");
    }
  };

  const importChat = async (file: File) => {
    if (!wsId) return void toast.error('Choose a workspace first.');
    let createdId: string | undefined;
    try {
      const imported = prepareChatImport(JSON.parse(await file.text()));
      await supabase.from('conversations').insert({ id: imported.conversationId, workspace_id: wsId, title: imported.title }).throwOnError();
      createdId = imported.conversationId;
      const write = async (rows: Msg[]) => {
        for (let i = 0; i < rows.length; i += 200) await supabase.from('messages').upsert(rows.slice(i, i + 200).map(m => ({ ...m, attachments: m.attachments as never }))).throwOnError();
      };
      await write(imported.messages.map(m => ({ ...m, parent_id: null })));
      await write(imported.messages);
      await supabase.from('conversations').update({ current_leaf_id: imported.leafId }).eq('id', imported.conversationId).throwOnError();
      await loadConversations();
      navigate({ to: '/studio/{-$chatId}', params: { chatId: imported.conversationId } });
      toast.success(`Imported ${imported.messages.length} messages`);
    } catch (e) {
      if (createdId) await supabase.from('conversations').delete().eq('id', createdId);
      toast.error((e as Error).message || 'Could not import chat.');
    }
  };

  /** Export the whole workspace: chats as Markdown, optionally zipped with every workspace file. */
  const exportWorkspace = async (withFiles: boolean) => {
    if (!wsId) return;
    const name = (workspaces.find((w) => w.id === wsId)?.name ?? "workspace").replace(/[^\w-]+/g, "_");
    const chats: { name: string; md: string }[] = [];
    for (const c of conversations) {
      const { msgs, leafId } = await fetchConv(c.id);
      const md = `# ${c.title}\n\n` + pathTo(leafId, msgs).filter((m) => m.role !== CONTEXT_ROLE)
        .map((m) => `## ${m.role === "user" ? "You" : getModel(m.model ?? "")?.label ?? "Assistant"}\n\n${m.content}`).join("\n\n");
      chats.push({ name: `${c.title.replace(/[^\w-]+/g, "_").slice(0, 40)}_${c.id.slice(0, 6)}.md`, md });
    }
    if (!withFiles) return download(`${name}.md`, chats.map((c) => c.md).join("\n\n---\n\n"), "text/markdown");
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    for (const c of chats) zip.file(`chats/${c.name}`, c.md);
    const t = toast.loading("Packing files…");
    try {
      for (const f of await listFiles(wsId)) zip.file(`files/${f.path}`, await readBlob(wsId, f.path));
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${name}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) { toast.error((e as Error).message); } finally { toast.dismiss(t); }
  };

  const title = conversations.find((c) => c.id === chatId)?.title ?? "New chat";
  const actions = { clone: cloneChat, exportAs: exportChat, remove: deleteChat, importChat };
  const left = <LeftPanel settings={settings} onSettings={updateSettings} conversations={conversations} activeId={chatId} actions={actions} skills={skills} reloadSkills={reloadSkills}
    ws={{ list: workspaces, active: wsId, files, reloadFiles, reload: reloadWorkspaces, exportAs: exportWorkspace,
      select: (id: string) => { setWsId(id); navigate({ to: "/studio/{-$chatId}", params: { chatId: undefined } }); } }} />;
  const right = <RightPanel prompts={prompts} setPrompts={setPrompts} />;
  const busy = !!streaming || compacting;
  const tone = usage.pct > 85 ? "bg-destructive" : usage.pct > 60 ? "bg-chart-1" : "bg-primary";

  return (
    <div className={`grid h-dvh grid-cols-1 grid-rows-[64px_minmax(0,1fr)] overflow-hidden bg-background lg:grid-cols-[260px_minmax(0,1fr)] ${inspectorOpen ? "2xl:grid-cols-[260px_minmax(0,1fr)_300px]" : ""}`}>
      <div className="col-span-full flex min-w-0 items-center justify-between gap-3 border-b border-border bg-card px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground"><Command className="h-4 w-4" /></div><span className="truncate font-display text-2xl">Harness</span><span className="ml-3 hidden border-l border-border pl-4 text-xs text-muted-foreground sm:block">Control center</span></div>
        <div className="flex min-w-0 items-center gap-3 text-xs"><span className="hidden max-w-44 truncate text-muted-foreground md:block">{workspaces.find(w => w.id === wsId)?.name ?? "Workspace"}</span><span className="flex items-center gap-2 text-muted-foreground"><span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-chart-2" : "bg-destructive"}`} />{online ? "Connected" : "Offline"}</span><Button variant="outline" size="icon" className="h-8 w-8" aria-label="Toggle context library" title="Context library" onClick={() => { if (window.matchMedia('(min-width: 1536px)').matches) setInspectorOpen(v => !v); else setRightOpen(true); }}><PanelRight className="h-4 w-4" /></Button></div>
      </div>
      <Dialog open={!!approval} onOpenChange={v=>{if(!v)approval?.resolve(false);}}><DialogContent><DialogHeader><DialogTitle>Agent approval</DialogTitle></DialogHeader><div className="font-mono text-sm">{approval?.action}</div><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">{JSON.stringify(approval?.args,null,2)}</pre><DialogFooter><Button variant="secondary" onClick={()=>approval?.resolve(false)}>Deny</Button><Button onClick={()=>approval?.resolve(true)}>Allow once</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={!!question} onOpenChange={v=>{if(!v)question?.resolve('User cancelled');}}><DialogContent><DialogHeader><DialogTitle>{question?.question}</DialogTitle></DialogHeader>{question?.choices.map(c=><Button key={c} variant="secondary" onClick={()=>question.resolve(c)}>{c}</Button>)}<Input aria-label="Answer agent" value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="Your answer"/><DialogFooter><Button onClick={()=>question?.resolve(answer)} disabled={!answer.trim()}>Answer</Button></DialogFooter></DialogContent></Dialog>
      <aside className="hidden min-h-0 overflow-hidden border-r border-border lg:block">{left}</aside>
      <Sheet open={leftOpen} onOpenChange={setLeftOpen}>
        <SheetContent side="left" className="w-[85vw] max-w-[320px] p-0"><SheetTitle className="sr-only">Menu</SheetTitle>{left}</SheetContent>
      </Sheet>
      <Sheet open={rightOpen} onOpenChange={setRightOpen}>
        <SheetContent side="right" className="w-[90vw] max-w-[360px] p-0"><SheetTitle className="sr-only">Context library</SheetTitle>{right}</SheetContent>
      </Sheet>

      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
        {recovery && recovery.conversationId !== chatId && !chatId && <div role="alert" className="border-b border-border bg-muted px-4 py-3"><p className="mb-2 text-sm">A previous reply was interrupted. Saved progress is available.</p><Button size="sm" onClick={() => navigate({ to: '/studio/{-$chatId}', params: { chatId: recovery.conversationId } })}>Open interrupted chat</Button></div>}
        {!online && <div role="status" className="border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground">Offline — waiting for a connection.</div>}
        {recovery && recovery.conversationId === chatId && <div role="alert" className="border-b border-border bg-muted px-4 py-3">
          <p className="text-sm font-medium">{recovery.reason === 'paused' ? 'Loop paused. Ready to continue?' : 'This reply was interrupted. Pick up where you left off?'}</p>
          <p className="mt-1 text-xs text-muted-foreground">Resume starts a new request with saved text and thinking. Restart creates a new branch; previous actions may already have completed.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" disabled={!online || recovering || !!streaming} onClick={() => recoverRun('resume')}>Resume reply</Button>
            <Button size="sm" variant="secondary" disabled={!online || recovering || !!streaming} onClick={() => recoverRun('restart')}>Restart reply</Button>
            <Button size="sm" variant="ghost" disabled={!online || recovering || !!streaming} onClick={() => recoverRun('keep')}>Keep partial reply</Button>
          </div>
        </div>}
        <header className="flex min-h-20 shrink-0 items-center gap-3 border-b border-border px-4 py-4 sm:px-7">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setLeftOpen(true)} aria-label="Menu"><Menu className="h-4 w-4" /></Button>
          <div className="min-w-0 flex-1">
            <div className="mb-1 truncate text-[10px] text-muted-foreground">STUDIO / CONVERSATION</div>
            <div className="truncate font-display text-2xl font-normal">{title}</div>
          </div>
          <div className="hidden items-center gap-2 border-r border-border pr-4 text-xs text-muted-foreground md:flex"><Mascot model={settings.model} size={18} still /><span>{getModel(settings.model)?.label}</span></div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-auto gap-2 px-2 py-2" aria-label="Context usage">
                <Gauge className="h-4 w-4 text-muted-foreground" />
                <div className="hidden w-16 xl:block">
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full ${tone} transition-all`} style={{ width: `${Math.max(2, usage.pct)}%` }} /></div>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">{formatTokens(Math.max(0, usage.max - usage.used))} left</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="font-normal">
                <div className="text-sm font-semibold">Context window</div>
                <div className="font-mono text-xs text-muted-foreground">~{formatTokens(usage.used)} of {formatTokens(usage.max)} tokens used ({usage.pct.toFixed(1)}%)</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!leaf || busy} onClick={() => compact("summarize")}><Sparkles className="h-4 w-4" /> Summarize earlier messages</DropdownMenuItem>
              <DropdownMenuItem disabled={!leaf || busy} onClick={() => compact("truncate")}><Scissors className="h-4 w-4" /> Drop earlier messages</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <Thread path={path} messages={messages} streaming={streaming} compacting={compacting} model={settings.model} onSwitch={switchBranchFor(messages, setActiveLeaf)}
          onEdit={(m, text) => send(text, m.attachments, m.parent_id)} onRedo={redo} onDelete={deleteMessage} busy={busy} onPatch={patchAttachment} />

        <Composer settings={settings} onSettings={updateSettings} busy={busy} model={settings.model} draftKey={chatId ?? "new"} onStop={() => { abortRef.current?.abort(); if (chatId) runsRef.current.get(chatId)?.ctrl.abort(); }}
          onPause={streaming ? () => { const live = chatId ? runsRef.current.get(chatId) : undefined; if (!live) return; live.run.reason = 'paused'; live.interrupted = true; saveJournal(live.run); live.ctrl.abort(); } : undefined}
          onSend={(text, att) => send(text, att, leaf)}
          onSteer={streaming && chatId ? (t) => { const l = runsRef.current.get(chatId); if (!l) return false; l.steering.queue.push(t); l.steering.interrupt?.(); return true; } : undefined} webSearch={(settings.webSearch && !!settings.searxngUrl) || settings.fetchTool || settings.imageGen || settings.videoGen || settings.mcpServers?.some((x) => x.enabled)} />
      </main>

      {inspectorOpen && <aside className="hidden min-h-0 overflow-hidden border-l border-border 2xl:block">{right}</aside>}
    </div>
  );
}

function switchBranchFor(messages: Msg[], setActiveLeaf: (id: string | null) => void) {
  return (m: Msg, dir: -1 | 1) => {
    const sibs = siblingsOf(m, messages);
    const target = sibs[sibs.findIndex((s) => s.id === m.id) + dir];
    if (target) setActiveLeaf(deepestLeaf(target.id, messages));
  };
}

type Patch = (msgId: string, idx: number, patch: Partial<Attachment>) => void;

function Thread({ path, messages, streaming, compacting, model, onSwitch, onEdit, onRedo, onDelete, busy, onPatch }: {
  path: Msg[]; messages: Msg[]; streaming: Streaming | null; compacting: boolean; model: string;
  onSwitch: (m: Msg, dir: -1 | 1) => void; onEdit: (m: Msg, text: string) => void; onRedo: (m: Msg) => void; onDelete: (m: Msg) => void; busy: boolean; onPatch: Patch;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  // Auto-scroll only while the user is pinned to the bottom; scrolling up detaches until they return.
  useEffect(() => {
    if (stickRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [path.length, streaming?.text, streaming?.tools, compacting]);
  useEffect(() => { stickRef.current = true; }, [path.length === 0]);

  if (!path.length && !streaming) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8 text-center">
        <div className="mb-5 flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-card"><Mascot model={model} size={32} still /></div>
        <div className="mb-3 text-[10px] text-muted-foreground">OPEN BROWSER HARNESS</div>
        <h1 className="max-w-lg text-4xl font-normal sm:text-5xl">A blank page.<br /><span className="italic text-muted-foreground">A new possibility.</span></h1>
        <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-chart-2" />{getModel(model)?.label}</div>
        <div className="mt-8 hidden w-full max-w-lg grid-cols-3 border-y border-border py-4 text-xs text-muted-foreground sm:grid"><span className="flex items-center justify-center gap-2"><Brain className="h-3.5 w-3.5" />Thinking</span><span className="flex items-center justify-center gap-2 border-x border-border"><FolderOpen className="h-3.5 w-3.5" />Workspace</span><span className="flex items-center justify-center gap-2"><Wrench className="h-3.5 w-3.5" />Tools</span></div>
      </div>
    );
  }
  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto scroll-smooth"
      onScroll={() => {
        const el = scrollRef.current;
        if (!el) return;
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        stickRef.current = distance < 64;
      }}
    >
      <div className="mx-auto max-w-3xl space-y-8 px-5 py-8 sm:px-8">
        {path.map((m) => m.role === CONTEXT_ROLE ? (
          <ContextMarker key={m.id} m={m} onDelete={onDelete} busy={busy} />
        ) : (
          <MessageView key={m.id} m={m} siblings={siblingsOf(m, messages)} onSwitch={onSwitch} onEdit={onEdit} onRedo={onRedo} onDelete={onDelete} busy={busy} onPatch={onPatch} />
        ))}
        {streaming && (
          <div className="space-y-1">
            <div className="flex items-center gap-2"><Mascot model={model} size={16} /><span className="font-mono text-[11px] text-muted-foreground">{getModel(model)?.label ?? "Assistant"}</span></div>
            {streaming.tools.length > 0 && <AgentSegments items={streaming.tools} live />}
            {streaming.reasoning && <ThinkingPanel text={streaming.reasoning} live />}
            {streaming.text ? <Markdown text={streaming.text} /> : (
              <div className="flex gap-1 py-2">{[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-pulse rounded-full bg-primary" style={{ animationDelay: `${i * 150}ms` }} />)}</div>
            )}
          </div>
        )}
        {compacting && <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><Sparkles className="h-3.5 w-3.5 animate-pulse text-primary" /> Summarizing the conversation…</div>}
      </div>
    </div>
  );
}

function ContextMarker({ m, onDelete, busy }: { m: Msg; onDelete: (m: Msg) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="group space-y-2">
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <button onClick={() => m.content && setOpen(!open)} className="flex items-center gap-1.5 font-mono uppercase tracking-wider">
          {m.content ? <><Sparkles className="h-3 w-3 text-primary" /> Context summarized {open ? "▴" : "▾"}</> : <><Scissors className="h-3 w-3" /> Earlier context dropped</>}
        </button>
        <button disabled={busy} onClick={() => onDelete(m)} className="opacity-0 group-hover:opacity-100" aria-label="Undo compaction"><X className="h-3 w-3" /></button>
        <div className="h-px flex-1 bg-border" />
      </div>
      {open && <div className="rounded-lg border border-border bg-card/50 p-3 text-sm"><Markdown text={m.content} /></div>}
    </div>
  );
}

function BranchNav({ m, siblings, onSwitch }: { m: Msg; siblings: Msg[]; onSwitch: (m: Msg, d: -1 | 1) => void }) {
  if (siblings.length < 2) return null;
  const i = siblings.findIndex((s) => s.id === m.id);
  return (
    <div className="flex items-center gap-0.5 font-mono text-[11px] text-muted-foreground">
      <button className="rounded p-0.5 hover:bg-muted disabled:opacity-30" disabled={i === 0} onClick={() => onSwitch(m, -1)} aria-label="Previous version"><ChevronLeft className="h-3.5 w-3.5" /></button>
      {i + 1} / {siblings.length}
      <button className="rounded p-0.5 hover:bg-muted disabled:opacity-30" disabled={i === siblings.length - 1} onClick={() => onSwitch(m, 1)} aria-label="Next version"><ChevronRight className="h-3.5 w-3.5" /></button>
    </div>
  );
}

const actionCls = "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground group-hover:opacity-100 disabled:opacity-30";

function MessageView({ m, siblings, onSwitch, onEdit, onRedo, onDelete, busy, onPatch }: {
  m: Msg; siblings: Msg[]; onSwitch: (m: Msg, d: -1 | 1) => void; onEdit: (m: Msg, t: string) => void;
  onRedo: (m: Msg) => void; onDelete: (m: Msg) => void; busy: boolean; onPatch: Patch;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [copied, setCopied] = useState(false);
  const images = m.attachments.filter((a) => a.type === "image");
  const docs = m.attachments.filter((a) => a.type === "doc");
  const thinking = m.attachments.find((a) => a.type === "reasoning")?.text;

  if (m.role === "user") {
    return (
      <div className="group flex flex-col items-end gap-1">
        {editing ? (
          <div className="w-full max-w-[85%] space-y-2 rounded-xl border border-primary/40 bg-card p-3">
            <Textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-24" />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(m.content); }}>Cancel</Button>
              <Button size="sm" disabled={busy || !draft.trim()} onClick={() => { setEditing(false); onEdit(m, draft); }}>Resubmit</Button>
            </div>
          </div>
        ) : (
          <div className="max-w-[90%] space-y-2 rounded-md border border-border bg-card px-4 py-3 text-card-foreground sm:max-w-[85%]">
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">{images.map((a, i) => <img key={i} src={a.dataUrl} alt={a.name} className="max-h-60 rounded-lg" />)}</div>
            )}
            {docs.map((a, i) => <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground"><FileText className="h-3.5 w-3.5" />{a.name}</div>)}
            {m.content && <div className="break-words whitespace-pre-wrap text-[15px]">{m.content}</div>}
          </div>
        )}
        <div className="flex items-center gap-1">
          <BranchNav m={m} siblings={siblings} onSwitch={onSwitch} />
          {!editing && (
            <>
              <button disabled={busy} onClick={() => onEdit(m, m.content)} className={actionCls}><RotateCcw className="h-3 w-3" /> Resubmit</button>
              <button disabled={busy} onClick={() => setEditing(true)} className={actionCls}><Pencil className="h-3 w-3" /> Edit prompt</button>
              <button disabled={busy} onClick={() => onDelete(m)} className={`${actionCls} hover:text-destructive`}><Trash2 className="h-3 w-3" /> Delete</button>
            </>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="group space-y-1">
      <div className="flex items-center gap-2">
        <Mascot model={m.model} size={16} />
        <span className="font-mono text-[11px] text-muted-foreground">{getModel(m.model ?? "")?.label ?? "Assistant"}</span>
        <BranchNav m={m} siblings={siblings} onSwitch={onSwitch} />
      </div>
      <AgentSegments items={m.attachments} />
      <Markdown text={m.content} />
      {m.attachments.some((a) => a.generated) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {m.attachments.map((a, i) => (a.generated ? <GeneratedMedia key={i} a={a} onPatch={(p) => onPatch(m.id, i, p)} /> : null))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <button onClick={() => { navigator.clipboard.writeText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className={actionCls}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? "Copied" : "Copy"}
        </button>
        <button disabled={busy} onClick={() => onRedo(m)} className={actionCls}><RotateCcw className="h-3 w-3" /> Redo</button>
        <button disabled={busy} onClick={() => onDelete(m)} className={`${actionCls} hover:text-destructive`}><Trash2 className="h-3 w-3" /> Delete</button>
      </div>
    </div>
  );
}

function AgentSegments({items,live=false}:{items:Attachment[];live?:boolean}) {
 return <>{items.map((a,i)=>a.type==='reasoning'?<ThinkingPanel key={i} text={a.text??''} live={live&&i===items.length-1}/>:a.type==='tool'?<ToolList key={i} items={[a]} live={live&&i===items.length-1}/>:null)}</>;
}

function ToolList({ items, live = false }: { items: Attachment[]; live?: boolean }) {
  const tools = items.filter((a) => a.type === "tool");
  const media = live ? items.filter((a) => a.generated) : [];
  return (
    <div className="space-y-1.5 py-1">
      {tools.map((t, i) => (
        <details key={i} className="group/tool rounded-lg border border-border bg-card/40 text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-muted-foreground">
            {t.output === undefined ? <Loader2 className="h-3 w-3 animate-spin text-primary" /> : <Wrench className="h-3 w-3 text-primary" />}
            <span className="font-mono text-foreground">{t.name}</span>
            <span className="truncate">{argPreview(t.args)}</span>
            <ChevronRight className="ml-auto h-3 w-3 shrink-0 transition-transform group-open/tool:rotate-90" />
          </summary>
          <div className="space-y-2 border-t border-border px-2.5 py-2 font-mono text-[11px]">
            {t.args && t.args !== "{}" && <pre className="whitespace-pre-wrap break-all text-muted-foreground">{t.args}</pre>}
            {t.output !== undefined && <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words">{t.output}</pre>}
          </div>
        </details>
      ))}
      {media.length > 0 && <div className="flex flex-wrap gap-1.5">{media.map((a, i) => <span key={i} className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{a.type === "video" ? "video queued" : a.type === "music" ? (a.error ? "audio failed" : "audio ready") : a.error ? "image failed" : "image ready"}</span>)}</div>}
    </div>
  );
}

function ThinkingPanel({ text, live = false }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(live);
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="group/think rounded-lg border border-border bg-card/40 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-muted-foreground">
        <Brain className={`h-3 w-3 text-primary ${live ? "animate-pulse" : ""}`} />
        <span className="font-mono">{live ? "Thinking…" : "Thinking"}</span>
        <ChevronRight className="ml-auto h-3 w-3 shrink-0 transition-transform group-open/think:rotate-90" />
      </summary>
      <div className="max-h-60 overflow-auto whitespace-pre-wrap break-words border-t border-border px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">{text}</div>
    </details>
  );
}

function argPreview(args?: string) {
  try { const v = Object.values(JSON.parse(args || "{}") as Record<string, unknown>)[0]; return typeof v === "string" ? v.slice(0, 80) : ""; } catch { return ""; }
}

function GeneratedMedia({ a, onPatch }: { a: Attachment; onPatch: (p: Partial<Attachment>) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const pending = a.type === "video" && !!a.jobId && !a.path && !a.error;

  useEffect(() => {
    if (!pending) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await mediaCall<{ status: string; progress?: number; path?: string; error?: string }>({ action: "video-status", id: a.jobId });
        if (stop) return;
        if (r.status === "completed" && r.path) return onPatch({ path: r.path });
        if (r.status === "failed") return onPatch({ error: r.error ?? "Video generation failed" });
        setProgress(r.progress ?? 0);
      } catch (e) {
        if (!stop) return onPatch({ error: (e as Error).message });
      }
      if (!stop) timer = setTimeout(poll, 8000);
    };
    timer = setTimeout(poll, 4000);
    return () => { stop = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, a.jobId]);

  useEffect(() => {
    if (!a.path) return;
    supabase.storage.from("media").createSignedUrl(a.path, 3600).then(({ data }) => setUrl(data?.signedUrl ?? null));
  }, [a.path]);

  const Icon = a.type === "video" ? Film : a.type === "music" ? Music : ImageIcon;
  const body = a.error ? (
    <div className="flex aspect-square items-center justify-center p-4 text-center text-xs text-destructive">{a.error}</div>
  ) : a.type === "image" && a.dataUrl ? (
    <a href={a.dataUrl} download={`${a.name}.jpg`}><img src={a.dataUrl} alt={a.prompt ?? "Generated image"} className="w-full" /></a>
  ) : a.type === "video" && url ? (
    <video src={url} controls playsInline className="w-full" />
  ) : a.type === "music" && url ? (
    <div className="p-3"><audio src={url} controls className="w-full" /></div>
  ) : (
    <div className="flex aspect-video flex-col items-center justify-center gap-2 bg-muted/40 text-xs text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
      {a.type === "video" ? `Rendering video${progress ? ` · ${Math.round(progress)}%` : "…"}` : a.type === "music" ? "Composing audio…" : "Painting image…"}
    </div>
  );
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card">
      {body}
      {a.prompt && <figcaption className="flex gap-1.5 border-t border-border px-3 py-2 text-[11px] text-muted-foreground"><Icon className="mt-0.5 h-3 w-3 shrink-0" /><span className="line-clamp-2">{a.prompt}</span></figcaption>}
    </figure>
  );
}

function MicButton({ onText, disabled }: { onText: (t: string) => void; disabled: boolean }) {
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const [levels, setLevels] = useState<number[]>(() => Array(20).fill(0));
  const rec = useRef<{ stop: () => Promise<File> } | null>(null);
  const toggle = async () => {
    if (state === "busy") return;
    if (state === "idle") {
      try {
        setLevels(Array(20).fill(0));
        rec.current = await recordWav((l) => setLevels((p) => [...p.slice(1), l]));
        setState("rec");
      } catch { toast.error("Microphone access was blocked"); }
      return;
    }
    setState("busy");
    try {
      const file = await rec.current!.stop();
      const text = await transcribe(file);
      if (text) onText(text); else toast.info("No speech detected");
    } catch (e) { toast.error((e as Error).message); }
    rec.current = null;
    setState("idle");
  };
  return (
    <div className="flex items-center gap-1.5">
      {state === "rec" && (
        <div className="flex h-6 items-center gap-[2px] rounded-full bg-destructive/10 px-2" aria-label="Recording audio level">
          {levels.map((l, i) => (
            <span key={i} className="w-[2px] rounded-full bg-destructive transition-[height] duration-75" style={{ height: `${Math.max(2, l * 18)}px` }} />
          ))}
        </div>
      )}
      <Button variant={state === "rec" ? "destructive" : "ghost"} size="icon" className="h-8 w-8" onClick={toggle} disabled={disabled && state === "idle"}
        aria-label={state === "rec" ? "Stop recording" : "Speak"} title={state === "rec" ? "Stop and transcribe" : "Speech to text"}>
        {state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" /> : state === "rec" ? <Square className="h-3.5 w-3.5 animate-pulse" /> : <Mic className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function Composer({ busy, onSend, onStop, onPause, onSteer, webSearch, draftKey, model, settings, onSettings }: {
  settings: Settings; onSettings: (patch: Partial<Settings>) => void;
  busy: boolean; model: string; onSend: (t: string, a: Attachment[]) => void; onStop: () => void; onPause?: (() => void) | undefined; onSteer?: ((t: string) => boolean) | undefined; webSearch: boolean; draftKey: string;
}) {
  const [text, setTextRaw] = useState("");
  const storeKey = `openchat:draft:${draftKey}`;
  useEffect(() => { setTextRaw(localStorage.getItem(storeKey) ?? ""); }, [storeKey]);
  const setText = (v: string | ((p: string) => string)) => setTextRaw((p) => {
    const next = typeof v === "function" ? v(p) : v;
    if (next) localStorage.setItem(storeKey, next); else localStorage.removeItem(storeKey);
    return next;
  });
  const [att, setAtt] = useState<Attachment[]>([]);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!busy) taRef.current?.focus(); }, [busy]);

  const [ask, setAsk] = useState<{ name: string; tokens: number; limit: number; resolve: (ok: boolean) => void } | null>(null);
  const [summarizing, setSummarizing] = useState<string[]>([]);
  const confirmSummary = (name: string, tokens: number, limit: number) =>
    new Promise<boolean>((resolve) => setAsk({ name, tokens, limit, resolve }));

  /** Summarise an oversized text file in chunks that each fit the model's budget. */
  const summarizeText = async (name: string, text: string, limit: number) => {
    const chunks = chunkText(text, Math.floor(limit * 4 * 0.8));
    const parts: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      let out = "";
      await streamChat({
        model, system: "You condense documents faithfully.",
        messages: [{ role: "user", images: [], content: `Summarize part ${i + 1} of ${chunks.length} of the file "${name}". Keep key facts, names, numbers, code and structure. Reply with the summary only.\n\n${chunks[i]}` }],
        params: {},
      }, (d) => { out += d; }, new AbortController().signal);
      parts.push(chunks.length > 1 ? `[Part ${i + 1}/${chunks.length}]\n${out.trim()}` : out.trim());
    }
    return parts.join("\n\n");
  };

  const addFiles = async (files: FileList | File[]) => {
    const limit = fileTokenLimit(getModel(model)?.context ?? 128_000);
    for (const f of Array.from(files)) {
      try {
        const a = await readFile(f);
        const doc = a.find((x) => x.type === "doc");
        const tokens = doc ? estimateTokens(doc.text ?? "") : 0;
        if (doc && tokens > limit) {
          // No AI summary: try the free local compressor, reject if still too big.
          const packed = compressText(doc.text ?? "", Math.floor(limit * 3.5));
          const packedTokens = estimateTokens(packed);
          if (/\.(pdf|docx|pptx)$/i.test(f.name) || packedTokens > limit) {
            toast.error(`${f.name} is too long for this model (~${formatTokens(tokens)} tokens, max ${formatTokens(limit)}).`);
            continue;
          }
          setAtt((p) => [...p, { ...doc, text: packed }]);
          toast.info(`${f.name} was compressed to fit (~${formatTokens(packedTokens)} tokens).`);
          continue;
        }
        setAtt((p) => [...p, ...a]);
      } catch (e) { toast.error((e as Error).message); }
    }
  };
  const submit = () => {
    if (busy) {
      if (onSteer && text.trim() && onSteer(text.trim())) setText("");
      return;
    }
    if (!text.trim() && !att.length) return;
    onSend(text, att); setText(""); setAtt([]);
  };

  return (
    <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-7 sm:pb-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
        className={`studio-composer mx-auto max-w-3xl rounded-lg border bg-card p-3 transition-colors focus-within:border-ring ${drag ? "border-dashed border-primary bg-primary/5" : "border-border"}`}
      >
        <AlertDialog open={!!ask} onOpenChange={(o) => { if (!o && ask) { ask.resolve(false); setAsk(null); } }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>File too long for this model</AlertDialogTitle>
              <AlertDialogDescription>
                {ask && <>“{ask.name}” is about {formatTokens(ask.tokens)} tokens; this model allows up to {formatTokens(ask.limit)} per file. Summarize it first and attach the summary? Choosing No skips the file.</>}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { ask?.resolve(false); setAsk(null); }}>No</AlertDialogCancel>
              <AlertDialogAction onClick={() => { ask?.resolve(true); setAsk(null); }}>Yes, summarize</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {(att.length > 0 || summarizing.length > 0) && (
          <div className="flex flex-wrap gap-2 p-1">
            {summarizing.map((n) => (
              <div key={`s-${n}`} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> <span className="max-w-40 truncate">Summarizing {n}…</span>
              </div>
            ))}
            {att.map((a, i) => (
              <div key={i} className="relative flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2 py-1 text-xs">
                {a.type === "image" ? <img src={a.dataUrl} alt="" className="h-8 w-8 rounded object-cover" /> : <FileText className="h-4 w-4" />}
                <span className="max-w-32 truncate">{a.name}</span>
                <button onClick={() => setAtt(att.filter((_, j) => j !== i))} aria-label="Remove"><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}
        <Textarea
          ref={taRef} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
          aria-label="Message Harness"
          placeholder={drag ? "Drop files to attach" : busy && onSteer ? "Add a note to steer the reply…" : "What’s on your mind?"}
          className="max-h-40 min-h-20 resize-none border-0 bg-transparent px-1 text-base shadow-none focus-visible:ring-0 sm:max-h-60 md:text-sm"
        />
        <div className="mb-2 flex flex-wrap items-center gap-2 border-t border-border px-1 pt-3"><ThinkingControls compact settings={settings} onSettings={onSettings} disabled={busy} /><PermissionControls settings={settings} onSettings={onSettings} disabled={busy}/></div>
        <div className="flex items-center gap-2 px-1">
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => inputRef.current?.click()} aria-label="Attach files"><Paperclip className="h-4 w-4" /></Button>
          {webSearch && <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><Wrench className="h-3 w-3" />Tools active</span>}
          <div className="flex-1" />
          {(text || att.length > 0) && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setText(""); setAtt([]); taRef.current?.focus(); }} aria-label="Clear prompt" title="Clear prompt"><Eraser className="h-4 w-4" /></Button>
          )}
          <MicButton disabled={busy} onText={(t) => { setText((p) => (p.trim() ? `${p.replace(/\s+$/, "")} ${t}` : t)); taRef.current?.focus(); }} />
          {busy && onPause && <Button size="icon" variant="secondary" className="h-8 w-8" onClick={onPause} aria-label="Pause loop" title="Pause loop"><Pause className="h-3.5 w-3.5" /></Button>}
          {busy && onSteer && text.trim() && <Button size="icon" className="h-8 w-8" onClick={submit} aria-label="Send note to steer the reply" title="Send note to steer the reply"><ArrowUp className="h-4 w-4" /></Button>}
          {busy ? (
            <Button size="icon" variant="secondary" className="h-8 w-8" onClick={onStop} aria-label="Stop"><Square className="h-3.5 w-3.5" /></Button>
          ) : (
            <Button size="icon" className="h-8 w-8" onClick={submit} disabled={!text.trim() && !att.length} aria-label="Send"><ArrowUp className="h-4 w-4" /></Button>
          )}
        </div>
      </div>
    </div>
  );
}
