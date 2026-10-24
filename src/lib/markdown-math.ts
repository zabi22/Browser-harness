export const MATH_CURRENCY_GUIDELINE = "Formatting: Write monetary amounts with an explicit currency code, e.g. USD 25, EUR 50, or CAD 10, not a bare dollar sign. Reserve $...$ for mathematical expressions; for standalone numeric math use \\( ... \\), and use \\[ ... \\] for display equations. Preserve original formatting when quoting text or writing code.";

/** Promote dollar equations while leaving currency and prose literal. */
function looksLikeMath(value: string): boolean {
  if (!value || value.trim() !== value) return false;
  if (/^[+-]?\d[\d,.]*(?:\s*(?:USD|EUR|GBP|CAD|AUD|dollars?|cents?))?$/i.test(value)) return false;
  const withoutCommands = value.replace(/\\[a-zA-Z]+/g, "");
  if (/[a-zA-Z]{3,}/.test(withoutCommands.replace(/\{[^}]*\}/g, ""))) return false;
  return /\\[a-zA-Z]+|[=+*/^_<>]|[{}()[\]]/.test(value)
    || /^[a-zA-Z](?:\s*[-,]\s*[a-zA-Z])*$/.test(value)
    || /^\d[\d.]*\s*-\s*\d[\d.]*$/.test(value);
}

function normalizeDollars(text: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\") {
      result += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (text.startsWith("$$", i)) {
      const end = text.indexOf("$$", i + 2);
      if (end < 0) return result + text.slice(i);
      result += text.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    if (text[i] === "$") {
      let end = i + 1;
      while (end < text.length && text[end] !== "$" && text[end] !== "\n") {
        end += text[end] === "\\" ? 2 : 1;
      }
      const value = text.slice(i + 1, end);
      if (text[end] === "$" && !text.startsWith("$$", end) && looksLikeMath(value)) {
        result += `$$${value}$$`;
        i = end + 1;
        continue;
      }
    }
    result += text[i];
    i += 1;
  }
  return result;
}

export function normalizeMath(text: string): string {
  return text
    .split(/(`{3,}[^\n]*\n[\s\S]*?`{3,}|~{3,}[^\n]*\n[\s\S]*?~{3,}|`+[^`\n]*`+)/g)
    .map((part, i) => i % 2 === 1 ? part : normalizeDollars(part
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$$${m.trim()}$$`)))
    .join("");
}

export const mathOptions = { singleDollarTextMath: false };