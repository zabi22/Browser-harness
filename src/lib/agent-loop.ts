import { streamChat, type Attachment, type Settings, type ToolCall } from "./studio-client";
import { buildTools, type ToolCtx } from "./tools";
import { linuxFor } from "./linux-environment";
import { MATH_CURRENCY_GUIDELINE } from "./markdown-math";
import { boundedTimeout } from './agent-policy';
import {stopSessionProcesses} from './wasm-processes';
import { continuationMessages, DIDNT_REPLY, MAX_CONTINUATIONS, steeringMessages, steeringNote } from './reply-continuation';
export interface Steering { queue: string[]; interrupt?: (() => void) | undefined }
export interface LoopResult {
  text: string;
  segments: Attachment[];
}
export async function runAgentLoop({
  settings,
  system,
  messages,
  skills,
  onSkillsChanged,
  ctx,
  signal,
  onUpdate,
  steering,
}: {
  settings: Settings;
  system: string;
  messages: unknown[];
  skills: Parameters<typeof buildTools>[1];
  onSkillsChanged: () => void;
  ctx: ToolCtx;
  signal: AbortSignal;
  onUpdate: (r: LoopResult) => void;
  /** Mid-run user notes. The UI pushes text and calls interrupt() to cut the current model step short. */
  steering?: Steering;
}) {
  let text = "",
    convo = messages;
  const segments: Attachment[] = [];
  const current = () => ctx.getSettings?.() ?? settings;
  const update = () => onUpdate({ text, segments: segments.map((s) => ({ ...s })) });
  const kit = await buildTools(settings, skills, onSkillsChanged, {...ctx,signal});
  const stopProcesses=()=>{if(ctx.sessionId)stopSessionProcesses(ctx.sessionId);};
  signal.addEventListener('abort',stopProcesses,{once:true});
  let restarts = 0;
  let continuations = 0;
  try {
    for (let step = 0; step < 50 && !signal.aborted; step++) {
      const stepCtrl = new AbortController();
      const abort = () => stepCtrl.abort();
      signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(
        () => stepCtrl.abort(new Error("Model step timed out")),
        boundedTimeout(current().modelTimeout ?? 600) * 1000,
      );
      let stepText = "",
        reasonIdx = -1;
      let stepReasoning = "", truncated = false;
      let calls: ToolCall[] = [];
      let steered = false;
      if (steering) steering.interrupt = () => { steered = true; stepCtrl.abort(); };
      try {
        const s = current();
        calls = await streamChat(
          {
            model: s.model,
            system: [system, MATH_CURRENCY_GUIDELINE].filter(Boolean).join("\n\n"),
            messages: convo,
            params: {
              temperature: s.temperature,
              maxTokens: s.maxTokens,
              frequencyPenalty: s.frequencyPenalty,
              presencePenalty: s.presencePenalty,
              thinking: s.thinking,
              thinkingEffort: s.thinkingEffort,
            },
            tools: kit.defs,
          },
          (d) => {
            text += d;
            stepText += d;
            // Answer text closes the current thinking bubble; later thinking opens a new one.
            if (d.trim()) reasonIdx = -1;
            update();
          },
          stepCtrl.signal,
          (r) => {
            stepReasoning += r;
            if (reasonIdx < 0)
              reasonIdx = segments.push({ type: "reasoning", name: "Thinking", text: "" }) - 1;
            const a = segments[reasonIdx];
            if (a) a.text = (a.text ?? "") + r;
            update();
          },
          () => { truncated = true; },
        );
      } catch (e) {
        if (steered && !signal.aborted) calls = [];
        else if (stepCtrl.signal.aborted && !signal.aborted) throw new Error("Model step timed out");
        else throw e;
      } finally {
        if (steering) steering.interrupt = undefined;
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
      const notes = steering?.queue.splice(0) ?? [];
      if (notes.length && !calls.length && !signal.aborted) {
        // User steering: keep the partial step as assistant text (never empty), then the note as a user turn.
        step--;
        convo = [...convo, ...steeringMessages(stepText, stepReasoning, notes)];
        if (text && !text.endsWith("\n")) text += "\n\n";
        segments.push({ type: "tool", name: "Your note", output: notes.join("\n\n") });
        update();
        continue;
      }
      if (!calls.length) {
        const cs = current();
        const infinite = !!cs.infiniteContinuations;
        const limit = Math.max(1, Math.round(cs.maxContinuations ?? MAX_CONTINUATIONS));
        if (truncated && cs.continueAtLimit && (infinite || continuations < limit) && !signal.aborted) {
          continuations++;
          // Continuations don't consume agent tool steps; Stop still cancels.
          step--;
          convo = [...convo, ...continuationMessages(stepText, stepReasoning)];
          segments.push({ type: "tool", name: "Reply continuation", output: `Continuing after output limit (${continuations}/${infinite ? "∞" : limit})` });
          update();
          continue;
        }
        if (!text.trim()) text = DIDNT_REPLY;
        if (truncated) text += current().continueAtLimit
          ? "\n\n_(Output limit reached; automatic continuation stopped.)_"
          : "\n\n_(Output limit reached.)_";
        update();
        return { text, segments };
      }
      convo = [...convo, { role: "assistant", content: stepText, toolCalls: calls }];
      if (text && !text.endsWith("\n")) text += "\n\n";
      const images: string[] = [];
      for (const c of calls) {
        if (signal.aborted) throw new Error("Stopped");
        const idx =
          segments.push({ type: "tool", name: kit.labels.get(c.name) ?? c.name, args: c.args }) - 1;
        update();
        let output = "";
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(c.args || "{}");
          if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error();
        } catch {
          output = "Invalid tool arguments";
          args = {};
        }
        if (!output) {
          const runner = kit.run.get(c.name);
          if (!runner) output = `Unknown or unavailable tool: ${c.name}`;
          else
            try {
              if (c.name === "restart_environment" && ++restarts > 3)
                throw new Error("Maximum three restarts per loop");
              const toolCtrl = new AbortController();
              const cancel = () => toolCtrl.abort();
              signal.addEventListener("abort", cancel, { once: true });
              // Boot/restart and user approvals have separate lifecycle waits. Ordinary tools use the session limit.
              const duration = ["bash", "restart_environment", "ask_user"].includes(c.name)
                ? Math.max(300, current().toolTimeout + 240)
                : boundedTimeout(current().toolTimeout ?? 120);
              let toolTimer: ReturnType<typeof setTimeout> | undefined;
              try {
                const r = await Promise.race([
                  runner(args, toolCtrl.signal),
                  new Promise<never>((_, reject) => {
                    toolTimer = setTimeout(() => {
                      toolCtrl.abort();
                      reject(new Error("Tool timed out"));
                    }, duration * 1000);
                  }),
                ]);
                output = r.output;
                if (r.attachment) segments.push(r.attachment);
                if (r.modelImage) images.push(r.modelImage);
              } finally {
                clearTimeout(toolTimer);
                signal.removeEventListener("abort", cancel);
              }
            } catch (e) {
              if (signal.aborted) throw new Error("Stopped");
              output = `Tool failed: ${(e as Error).message}`;
            }
        }
        const a = segments[idx];
        if (a) a.output = output.slice(0, 4000);
        update();
        convo = [...convo, { role: "tool", toolCallId: c.id, name: c.name, content: output }];
      }
      notes.push(...(steering?.queue.splice(0) ?? []));
      if (notes.length) {
        segments.push({ type: "tool", name: "Your note", output: notes.join("\n\n") });
        update();
      }
      if (images.length || notes.length)
        convo = [...convo, { role: "user", content: [images.length && "Images loaded by your tools", notes.length && steeringNote(notes)].filter(Boolean).join("\n\n"), images }];
    }
    if (!signal.aborted) text += "\n\n_(Agent step limit reached)_";
    return { text, segments };
  } finally {
    // Publish the complete snapshot even when a model or tool throws.
    update();
    signal.removeEventListener('abort',stopProcesses);
    if (ctx.workspaceId) {
      const env = linuxFor(ctx.workspaceId);
      if (env.state === "running" || env.state === "unsynced")
        await env.checkpoint().catch((e) => {
          segments.push({ type: "tool", name: "Disk checkpoint", output: (e as Error).message });
          update();
        });
    }
  }
}
