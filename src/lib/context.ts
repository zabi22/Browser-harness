// Pure helpers for the context window: markers, token estimates.
// A message with role "context" is a marker: empty content = earlier history dropped,
// non-empty content = a summary that replaces earlier history.
export interface CtxMsg { role: string; content: string; attachments?: { type: string; text?: string }[] }

export const CONTEXT_ROLE = "context";

/** Messages that are actually sent to the model, plus the active summary (if any). */
export function activeContext<T extends CtxMsg>(path: T[]): { messages: T[]; summary: string } {
  let cut = -1;
  for (let i = path.length - 1; i >= 0; i--) if (path[i]!.role === CONTEXT_ROLE) { cut = i; break; }
  return {
    messages: path.slice(cut + 1).filter((m) => m.role === "user" || m.role === "assistant"),
    summary: cut >= 0 ? path[cut]!.content : "",
  };
}

/** Rough token estimate: ~4 characters per token, ~1000 tokens per image. */
export function estimateTokens(text: string, images = 0): number {
  return Math.ceil(text.length / 4) + images * 1000;
}

export function messageTokens(m: CtxMsg): number {
  const docs = (m.attachments ?? []).filter((a) => a.type === "doc").reduce((n, a) => n + (a.text?.length ?? 0), 0);
  const imgs = (m.attachments ?? []).filter((a) => a.type === "image").length;
  return estimateTokens(m.content, imgs) + Math.ceil(docs / 4);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

/** A single attached file may use at most half of the model's context window. */
export function fileTokenLimit(context: number): number {
  return Math.floor(context * 0.5);
}

/** Split text into pieces of at most `maxChars`, preferring line breaks. */
export function chunkText(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + maxChars);
    if (end < text.length) { const nl = text.lastIndexOf("\n", end); if (nl > i + maxChars / 2) end = nl + 1; }
    out.push(text.slice(i, end)); i = end;
  }
  return out;
}
