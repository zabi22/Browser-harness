import { isValidElement, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { mathOptions, normalizeMath } from "@/lib/markdown-math";
import { Check, Copy } from "lucide-react";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";

const LABELS: Record<string, string> = {
  js: "javascript", ts: "typescript", py: "python", sh: "bash", shell: "bash", zsh: "bash", yml: "yaml", md: "markdown", plaintext: "txt", text: "txt",
};

function langOf(children: ReactNode): string {
  if (!isValidElement(children)) return "txt";
  const cls = String((children.props as { className?: string }).className ?? "");
  const m = /language-([\w+#-]+)/.exec(cls);
  const l = m?.[1]?.toLowerCase() ?? "txt";
  return LABELS[l] ?? l;
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [done, setDone] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background/70">
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-primary">{langOf(children)}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(ref.current?.innerText ?? "");
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {done ? "Copied" : "Copy code"}
        </button>
      </div>
      <pre ref={ref} className="!m-0 overflow-x-auto p-4 text-sm">{children}</pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="oc-md text-[15px] leading-relaxed [&_.katex-display]:overflow-x-auto [&_.katex-display]:py-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, mathOptions]]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore" }], rehypeHighlight]}
        components={{ pre: CodeBlock }}
      >
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  );
}
