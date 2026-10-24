import { getModel, resolveThinking } from "@/lib/models";
import { DIDNT_REPLY } from "./reply-continuation";
import { nativeModelId } from "./provider-keys.server";
import type { InBody, ToolCall, ToolDef } from './chat-request';
export type { InBody } from './chat-request';

// Translate the studio's neutral chat/tool format to each provider and parse their streams back.

export function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json" } });
}

const GEMINI_NO_TOOLS =
  "You have no tools or function calling in this conversation. Always answer directly in plain text and never attempt a function or tool call.";

const schemaOf = (t: ToolDef) => (t.parameters && typeof t.parameters === "object" ? t.parameters : { type: "object", properties: {} });
const parseArgs = (a: string) => { try { const v = JSON.parse(a || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } };

// Thinking tokens count against the same output budget as the answer on every
// provider we call. A cap sized for text-only replies gets eaten entirely by a
// heavy think, ending the stream before a word of the answer — so when thinking
// is on, the effective budget is at least the effort's floor.
const THINK_FLOOR: Record<string, number> = { minimal: 4096, low: 10240, medium: 16384, high: 32768, xhigh: 49152, max: 64000 };

export function buildRequest(body: InBody, model: NonNullable<ReturnType<typeof getModel>>) {
  body = { ...body, messages: body.messages.map((m) => ({ ...m,
    content: m.role === "assistant" && !m.content?.trim() && !m.toolCalls?.length ? DIDNT_REPLY : m.content,
  })) };
  const p = body.params ?? {};
  const thinking = resolveThinking(model.id, p.thinking, p.thinkingEffort);
  // Haiku uses a bounded thinking budget (below), so it only needs room for that budget plus an answer.
  const floor = !thinking.enabled ? 256 : model.id === "anthropic/claude-haiku-4-5" ? 2048 : THINK_FLOOR[thinking.effort] ?? 10240;
  const maxTokens = Math.max(floor, Math.min(64000, Math.round(p.maxTokens ?? 4096)));
  const tools = (body.tools ?? []).slice(0, 128);
  if (model.provider === "openai") {
    const input: unknown[] = [];
    for (const m of body.messages) {
      if (m.role === "user") input.push({ role: "user", content: [{ type: "input_text", text: m.content }, ...(m.images ?? []).map((u) => ({ type: "input_image", image_url: u }))] });
      else if (m.role === "tool") input.push({ type: "function_call_output", call_id: m.toolCallId, output: m.content });
      else {
        if (m.content) input.push({ role: "assistant", content: [{ type: "output_text", text: m.content }] });
        for (const c of m.toolCalls ?? []) input.push({ type: "function_call", call_id: c.id, name: c.name, arguments: c.args || "{}" });
      }
    }
    return {
      path: "/responses",
      payload: {
        model: nativeModelId(model.id),
        instructions: body.system || undefined,
        input,
        ...(tools.length ? { tools: tools.map((t) => ({ type: "function", name: t.name, description: t.description ?? "", parameters: schemaOf(t), strict: false })) } : {}),
        stream: true,
        store: false,
        max_output_tokens: maxTokens,
        reasoning: thinking.enabled ? { effort: thinking.effort, summary: "auto" } : { effort: "none" },
      },
    };
  }
  if (model.provider === "anthropic") {
    const messages: { role: string; content: unknown[] }[] = [];
    // Claude rejects text blocks that are empty or whitespace-only ("text content
    // blocks must contain non-whitespace text"), so placeholders must be real words.
    const textBlock = (t: string): { type: "text"; text: string } | null => {
      const s = (t ?? "").trim();
      return s ? { type: "text", text: t } : null;
    };
    for (const m of body.messages) {
      if (m.role === "tool") {
        const block = { type: "tool_result", tool_use_id: m.toolCallId, content: (m.content ?? "").trim() || "(empty result)" };
        const last = messages[messages.length - 1];
        if (last?.role === "user" && (last.content as { type: string }[]).every((b) => b.type === "tool_result")) last.content.push(block);
        else messages.push({ role: "user", content: [block] });
      } else if (m.role === "user") {
        const text = textBlock(m.content) ?? ((m.images?.length ?? 0) ? null : { type: "text" as const, text: "(empty)" });
        messages.push({ role: "user", content: [
          ...(m.images ?? []).map((u) => {
            const match = /^data:([^;]+);base64,(.*)$/.exec(u);
            return { type: "image", source: { type: "base64", media_type: match?.[1] ?? "image/jpeg", data: match?.[2] ?? "" } };
          }),
          ...(text ? [text] : []),
        ] });
      } else {
        const content: unknown[] = [];
        const text = textBlock(m.content);
        if (text) content.push(text);
        for (const c of m.toolCalls ?? []) content.push({ type: "tool_use", id: c.id, name: c.name, input: parseArgs(c.args) });
        messages.push({ role: "assistant", content: content.length ? content : [{ type: "text", text: DIDNT_REPLY }] });
      }
    }
    return {
      path: "/messages",
      payload: {
        model: nativeModelId(model.id),
        system: body.system || undefined,
        max_tokens: maxTokens,
        stream: true,
        ...(!thinking.enabled ? { thinking: { type: "disabled" } } : thinking.mode === "budget"
          ? { thinking: { type: "enabled", budget_tokens: Math.min(({ low: 1024, medium: 2048, high: 4096 } as Record<string, number>)[thinking.effort] ?? 1024, maxTokens - 1024) } }
          : { thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: thinking.effort } }),
        ...(model.temperature && p.temperature !== undefined ? { temperature: Math.min(1, p.temperature) } : {}),
        ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description ?? "", input_schema: schemaOf(t) })) } : {}),
        messages,
      },
    };
  }
  // Without tools, Gemini sometimes invents a call and aborts with MALFORMED_FUNCTION_CALL — say so plainly.
  const system = [body.system, tools.length ? "" : GEMINI_NO_TOOLS].filter(Boolean).join("\n\n");
  return {
    path: "/chat/completions",
    payload: {
      model: nativeModelId(model.id),
      stream: true,
      max_tokens: maxTokens,
      ...(model.provider === "google" ? { extra_body: { google: { thinking_config: { thinking_level: thinking.effort, include_thoughts: true } } } } : {}),
      ...(model.temperature && p.temperature !== undefined ? { temperature: Math.max(0, Math.min(2, p.temperature)) } : {}),
      ...(model.penalties && p.frequencyPenalty ? { frequency_penalty: p.frequencyPenalty } : {}),
      ...(model.penalties && p.presencePenalty ? { presence_penalty: p.presencePenalty } : {}),
      ...(tools.length ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: schemaOf(t) } })) } : {}),
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        ...body.messages.map((m) => {
          if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
          if (m.role === "assistant" && m.toolCalls?.length) {
            return {
              role: "assistant", content: m.content || null,
              // Echo provider extras (e.g. Gemini thought signatures) exactly as received.
              tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" }, ...(c.meta && typeof c.meta === "object" ? c.meta : {}) })),
            };
          }
          return {
            role: m.role,
            content: m.images?.length
              ? [{ type: "text", text: m.content }, ...m.images.map((u) => ({ type: "image_url", image_url: { url: u } }))]
              : m.content,
          };
        }),
      ],
    },
  };
}

type Out = { d?: string; r?: string; error?: string; native?: string; tool?: ToolCall; truncated?: boolean; refusal?: boolean };

/** Stateful per-stream parser: text deltas, finished tool calls, terminal errors. */
export function makeExtractor(provider: string) {
  const partial = new Map<number, { id: string; name: string; args: string; meta?: Record<string, unknown> }>();
  let sawTool = false;
  // A stream can end truncated (token limit) with or without visible text. If
  // tool calls already went out, the loop continues — stay quiet. Otherwise say
  // why the reply is empty instead of saving a thinking-only ghost.
  const truncation = (): Out[] => {
    if (sawTool) return [];
    return [{ truncated: true }];
  };
  const errText = (ev: any): string | undefined => {
    const m = ev?.response?.error?.message ?? ev?.error?.message ?? (typeof ev?.error === "string" ? ev.error : undefined) ??
      ev?.message ?? ev?.response?.error?.code ?? ev?.error?.code ?? ev?.code;
    if (!m) return undefined;
    return typeof m === "string" && m.trim() ? m.trim() : `Provider error (${m})`;
  };
  const flush = (): Out[] => {
    const out = [...partial.values()].filter((c) => c.name).map((c) => ({ tool: { id: c.id, name: c.name, args: c.args, ...(c.meta ? { meta: c.meta } : {}) } }));
    partial.clear();
    return out;
  };
  const step = (ev: any): Out[] => {
    if (provider === "openai") {
      if (ev.type === "response.output_text.delta") return [{ d: ev.delta }];
      if (ev.type === "response.reasoning_summary_text.delta" && typeof ev.delta === "string") return [{ r: ev.delta }];
      if (ev.type === "response.output_item.done" && ev.item?.type === "function_call") {
        sawTool = true;
        return [{ tool: { id: ev.item.call_id ?? ev.item.id, name: ev.item.name, args: ev.item.arguments ?? "{}" } }];
      }
      if (ev.type === "response.incomplete" && ev.response?.incomplete_details?.reason === "max_output_tokens") return truncation();
      if (ev.type === "response.failed" || ev.type === "error") return [{ error: errText(ev) ?? "Model error" }];
      return [];
    }
    if (provider === "anthropic") {
      if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
        sawTool = true;
        partial.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, args: "" });
      }
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") return [{ d: ev.delta.text }];
      if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta" && typeof ev.delta.thinking === "string") return [{ r: ev.delta.thinking }];
      if (ev.type === "content_block_delta" && ev.delta?.type === "input_json_delta") {
        const c = partial.get(ev.index); if (c) c.args += ev.delta.partial_json ?? "";
      }
      if (ev.type === "content_block_stop" && partial.has(ev.index)) {
        const c = partial.get(ev.index); partial.delete(ev.index);
        if (!c) return [];
        return [{ tool: { id: c.id, name: c.name, args: c.args || "{}" } }];
      }
      if (ev.type === "message_delta" && ev.delta?.stop_reason === "max_tokens") return truncation();
      if (ev.type === "message_delta" && ev.delta?.stop_reason === "refusal") {
        // Anthropic's streaming safety classifier can end a harmless reply mid-sentence; it's terminal, never replayed.
        const det = ev.delta?.stop_details ?? ev.stop_details;
        const cat = typeof det?.category === "string" ? det.category : "";
        return [{ error: `The model declined to answer.${cat ? ` (${cat})` : ""}`, refusal: true }];
      }
      if (ev.type === "error") return [{ error: errText(ev) ?? "Model error" }];
      return [];
    }
    if (ev.error || ev.code) return [{ error: errText(ev) ?? "Model error" }];
    const choice = ev.choices?.[0];
    const out: Out[] = [];
    for (const tc of choice?.delta?.tool_calls ?? []) {
      sawTool = true;
      const i = tc.index ?? partial.size;
      const c = partial.get(i) ?? { id: "", name: "", args: "" };
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.name += tc.function.name;
      if (tc.function?.arguments) c.args += tc.function.arguments;
      const { index: _i, id: _id, type: _t, function: _f, ...extra } = tc;
      if (Object.keys(extra).length) c.meta = { ...(c.meta ?? {}), ...extra };
      partial.set(i, c);
    }
    const d = choice?.delta?.content;
    if (typeof d === "string" && d) out.push({ d });
    const rc = choice?.delta?.reasoning_content;
    if (typeof rc === "string" && rc) out.push({ r: rc });
    if (choice?.finish_reason === "error" || choice?.native_finish_reason === "MALFORMED_FUNCTION_CALL") {
      const native = String(choice?.native_finish_reason ?? "");
      if (native === "MALFORMED_FUNCTION_CALL") out.push({ error: "The model made a broken tool call and stopped.", native });
      else if (/SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/i.test(native)) out.push({ error: `The model stopped for safety reasons (${native}).`, native });
      else out.push({ error: `The model stopped with an error${native ? ` (${native})` : ""}.`, native });
    } else if (choice?.finish_reason === "length") {
      // Thinking ate the budget. Any finished tool calls still count; otherwise explain the empty reply.
      const tools = flush();
      if (tools.length) out.push(...tools);
      else out.push(...truncation());
    } else if (choice?.finish_reason) out.push(...flush());
    return out;
  };
  return { step, flush };
}

