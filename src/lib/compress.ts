/** Client-side extractive token compression for large file attachments. */

export const COMPRESS_THRESHOLD = 10_000;

export const COMPRESSION_GUIDELINE =
  "You are receiving a compressed, high-density raw text extraction. Reconstruct the implied grammar, abbreviations, and skipped words natively in memory before generating your final response.";

const STOP_WORDS = new Set([
  "a", "an", "the", "which", "thereby", "is", "are", "was", "were", "be", "been", "being",
  "that", "this", "these", "those", "of", "to", "in", "on", "at", "for", "with", "by",
  "as", "it", "its", "and", "or", "so", "very", "really", "just", "quite", "also",
  "then", "there", "here", "thus", "hence", "whereby", "therefore", "furthermore",
  "moreover", "basically", "actually", "simply", "has", "have", "had", "do", "does", "did",
]);

/** Words that change meaning and must survive (negations, quantifiers). */
const KEEP = new Set(["not", "no", "never", "nor", "none", "all", "any", "only", "if", "but"]);

function pruneWhitespace(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v\u00a0]+/g, " ")
    .replace(/^[ ]*[|+\-=_*#~]{3,}[ ]*$/gm, "") // box/rule lines
    .replace(/ {2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function condensePunctuation(s: string): string {
  return s
    .replace(/([!?.,;:])\1+/g, "$1")
    .replace(/\.{3,}|…/g, "…")
    .replace(/([-=_*#~`|])\1{2,}/g, "$1$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{2,}\s*/gm, "# ")
    .replace(/\s+([,.;:!?])/g, "$1");
}

function filterLexical(s: string): string {
  return s
    .split("\n")
    .map((line) => {
      // Leave code-ish / numeric-heavy lines untouched to protect logic and facts.
      if (/[{}();=<>\[\]]/.test(line) || /^\s{2,}/.test(line)) return line;
      return line
        .split(" ")
        .filter((w) => {
          const bare = w.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
          if (!bare || KEEP.has(bare)) return true;
          // drop the word only if it carries no punctuation that matters
          return !(STOP_WORDS.has(bare) && /^[A-Za-z']+$/.test(w));
        })
        .join(" ");
    })
    .join("\n");
}

/**
 * Deduplicate lines: consecutive repeats collapse to "line ×N"; later exact
 * repeats of substantial lines are dropped. Huge win on logs, CSVs, transcripts.
 */
function dedupeLines(s: string): string {
  const out: string[] = [];
  const seen = new Set<string>();
  let prev = "", run = 0, dropped = false;
  const flush = () => { if (run > 1 && !dropped) out[out.length - 1] += ` ×${run}`; };
  for (const line of s.split("\n")) {
    const key = line.trim().toLowerCase();
    if (key && key === prev) { run++; continue; }
    flush(); prev = key; run = 1; dropped = false;
    if (key.length > 24 && seen.has(key)) { dropped = true; continue; }
    seen.add(key);
    out.push(line);
  }
  flush();
  return out.join("\n");
}

/**
 * Extractive budget fit: score sentences by TF-IDF (rare, repeated-in-doc terms
 * = informative), boost numbers/headings, keep the best in original order.
 */
function fitToBudget(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  const units = s.split(/(?<=[.!?])\s+|\n/).filter((u) => u.trim());
  const words = units.map((u) => u.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const df = new Map<string, number>(), tf = new Map<string, number>();
  for (const ws of words) {
    for (const w of ws) tf.set(w, (tf.get(w) ?? 0) + 1);
    for (const w of new Set(ws)) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const N = units.length;
  const scored = units.map((u, i) => {
    const ws = words[i] ?? [];
    let sc = 0;
    for (const w of new Set(ws)) sc += Math.log(1 + (tf.get(w) ?? 0)) * Math.log(N / (df.get(w) ?? 1));
    sc /= Math.sqrt(ws.length || 1);
    if (/\d/.test(u)) sc *= 1.3;
    if (/^#|:$/.test(u.trim())) sc *= 1.5;
    if (i < 3 || i >= N - 2) sc *= 1.5; // intro/conclusion
    return { i, u, sc };
  });
  const keep = new Set<number>();
  let used = 0;
  for (const x of [...scored].sort((a, b) => b.sc - a.sc)) {
    if (used + x.u.length + 6 > maxChars) continue;
    keep.add(x.i); used += x.u.length + 6;
  }
  let out = "", gap = false;
  for (const x of scored) {
    if (keep.has(x.i)) { out += (gap ? "\n[…]\n" : out ? "\n" : "") + x.u; gap = false; } else gap = true;
  }
  return out;
}

/**
 * Pipeline, cheapest-and-safest first: whitespace → dedupe → punctuation →
 * stop-word filter → (only if still over budget) extractive sentence selection.
 */
export function compressText(text: string, maxChars?: number): string {
  let s = pruneWhitespace(text);
  s = dedupeLines(s);
  s = pruneWhitespace(condensePunctuation(filterLexical(s)));
  return maxChars ? fitToBudget(s, maxChars) : s;
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&apos;");

/** Format an attachment for the payload, compressing when it exceeds the threshold. */
export function formatAttachment(name: string, text: string): { block: string; compressed: boolean } {
  if (text.length <= COMPRESS_THRESHOLD) return { block: `\n\n[File: ${name}]\n${text}`, compressed: false };
  const data = compressText(text);
  return { block: `\n\n<CompressedFile name='${escapeAttr(name)}' data='${escapeAttr(data)}'/>`, compressed: true };
}
