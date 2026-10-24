import { getModel } from "@/lib/models";

// Tiny animated pixel mascots, drawn as SVG grids. o = body, k = ink, w = light, b = beret.
const SPRITES = {
  anthropic: {
    name: "Clawd", color: "var(--mascot-claw)", anim: "oc-bob",
    rows: ["..oooooooooo..", "..okooooooko..", "oooooooooooooo", "oooooooooooooo", "..oooooooooo..", "...o.o..o.o...", "...o.o..o.o..."],
  },
  google: {
    name: "Pixel droid", color: "var(--mascot-droid)", anim: "oc-hop",
    rows: ["..o..o..", ".oooooo.", "ookookoo", "oooooooo", "........", "oooooooo", "oooooooo", ".oooooo."],
  },
  openai: {
    name: "Dot", color: "var(--mascot-dot)", anim: "oc-sway",
    rows: ["....b.....", "..bbbbbb..", ".bbbbbbbb.", "..oooooo..", ".ookookoo.", ".ookookoo.", ".oooooooo.", "..oooooo.."],
  },
} as const;

export function Mascot({ model, size = 20, className = "", still = false }: { model: string | null | undefined; size?: number; className?: string; still?: boolean }) {
  const p = getModel(model ?? "")?.provider;
  if (!p) return null;
  const s = SPRITES[p];
  const w = Math.max(...s.rows.map((r) => r.length));
  const h = s.rows.length;
  const fill = (c: string) => (c === "k" ? "var(--mascot-ink, #111)" : c === "w" ? "var(--mascot-light)" : c === "b" ? "var(--mascot-beret)" : s.color);
  return (
    <span className={`inline-flex shrink-0 ${still ? "" : s.anim} ${className}`} style={{ width: size, height: size }}>
    <svg role="img" aria-label={s.name} viewBox={`0 0 ${w} ${w}`} width={size} height={size}
      shapeRendering={p === "openai" ? "geometricPrecision" : "crispEdges"} className="overflow-visible">
      <title>{s.name}</title>
      {p === "openai" ? ["b", "o", "k"].map((color) => {
        // One path per colour: subpaths of a single path rasterize together, so rows never show seams.
        const off = (w - h) / 2;
        const d = s.rows.map((row, y) => [...row].map((c, x) => (c === color ? `M${x} ${y + off}h1v1h-1z` : "")).join("")).join("");
        return <path key={color} d={d} style={{ fill: fill(color) }} className={!still && color === "k" ? "oc-blink" : undefined} />;
      }) : s.rows.flatMap((r, y) => [...r].map((c, x) => (c === "." ? null : (
        <rect key={`${x}-${y}`} x={x} y={y + (w - h) / 2} width={1.02} height={1.02} style={{ fill: fill(c) }}
          className={still ? undefined : p === "google" && y === 0 ? "oc-antenna" : p === "anthropic" && y >= 5 ? "oc-legs" : undefined} />
      ))))}
    </svg>
    </span>
  );
}
