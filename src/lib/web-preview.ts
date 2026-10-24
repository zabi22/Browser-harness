// Bundles a web project's workspace files in the browser and returns HTML for a sandboxed preview frame.
// npm packages load from esm.sh through an import map; nothing from the app (session, keys) is passed in.
import * as wfs from "./workspace-fs";

const ESBUILD_VERSION = "0.28.2";
let ready: Promise<typeof import("esbuild-wasm")> | null = null;
function esbuild() {
  return (ready ??= (async () => {
    const mod = await import("esbuild-wasm");
    await mod.initialize({
      wasmURL: `https://unpkg.com/esbuild-wasm@${ESBUILD_VERSION}/esbuild.wasm`,
    });
    return mod;
  })());
}

/** Bare package name of a specifier ("@a/b/c" -> "@a/b", "x/y" -> "x"). */
export function pkgName(spec: string) {
  const p = spec.split("/");
  return spec.startsWith("@") ? p.slice(0, 2).join("/") : p[0]!;
}
export function importMap(specs: Iterable<string>) {
  const imports: Record<string, string> = {
    react: "https://esm.sh/react@19",
    "react/jsx-runtime": "https://esm.sh/react@19/jsx-runtime",
    "react-dom": "https://esm.sh/react-dom@19?external=react",
    "react-dom/client": "https://esm.sh/react-dom@19/client?external=react",
  };
  for (const s of specs) imports[s] ??= `https://esm.sh/${s}?external=react,react-dom`;
  return { imports };
}
/** Resolve a relative import against the importing file, trying TS/JS extensions and index files. */
export function resolveLocal(from: string, spec: string, files: Set<string>) {
  const base = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  const joined = wfs.normPath((spec.startsWith("/") ? "" : base + "/") + spec);
  for (const c of [
    "",
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    ".css",
    "/index.tsx",
    "/index.ts",
    "/index.jsx",
    "/index.js",
  ])
    if (files.has(joined + c)) return joined + c;
  return null;
}

export async function buildPreview(ws: string, root: string, entry: string) {
  const all = await wfs.listFiles(ws);
  const prefix = root ? wfs.normPath(root) + "/" : "";
  const paths = new Set(all.filter((f) => f.path.startsWith(prefix)).map((f) => f.path));
  const entryPath = wfs.normPath(prefix + entry);
  if (!paths.has(entryPath)) throw new Error(`Entry file ${entryPath} not found`);
  const cache = new Map<string, string>();
  const read = async (p: string) => {
    if (!cache.has(p)) cache.set(p, await wfs.readText(ws, p));
    return cache.get(p)!;
  };
  const bare = new Set<string>();
  const css: string[] = [];
  const es = await esbuild();
  const out = await es.build({
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    format: "esm",
    jsx: "automatic",
    target: "es2022",
    plugins: [
      {
        name: "workspace",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => {
            if (a.kind === "entry-point") return { path: a.path, namespace: "ws" };
            if (/^(https?:)?\/\//.test(a.path)) return { path: a.path, external: true };
            if (a.path.startsWith(".") || a.path.startsWith("/")) {
              const r = resolveLocal(
                a.importer,
                a.path.startsWith("/") ? prefix + a.path.slice(1) : a.path,
                paths,
              );
              if (!r) return { errors: [{ text: `Cannot find ${a.path} from ${a.importer}` }] };
              return { path: r, namespace: "ws" };
            }
            bare.add(a.path);
            return { path: a.path, external: true };
          });
          b.onLoad({ filter: /.*/, namespace: "ws" }, async (a) => {
            const text = await read(a.path);
            if (a.path.endsWith(".css")) {
              css.push(text.replace(/@import\s+["']tailwindcss["'];?/g, ""));
              return { contents: "", loader: "js" };
            }
            const ext = a.path.split(".").pop()!;
            return {
              contents: text,
              loader: (["tsx", "ts", "jsx", "js", "json"].includes(ext) ? ext : "text") as "tsx",
            };
          });
        },
      },
    ],
  });
  const js = out.outputFiles[0]!.text;
  const title =
    (await read(prefix + "index.html").catch(() => "")).match(/<title>(.*?)<\/title>/)?.[1] ??
    "Preview";
  const esc = (s: string) => s.replace(/<\/script/gi, "<\\/script");
  return {
    warnings: out.warnings.map((w) => w.text),
    html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<script type="importmap">${JSON.stringify(importMap(bare))}</script>
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<style type="text/tailwindcss">${css.join("\n").replace(/<\/style/gi, "")}</style>
<script>addEventListener("error",e=>parent.postMessage({obhPreviewError:String(e.message)},"*"));addEventListener("unhandledrejection",e=>parent.postMessage({obhPreviewError:String(e.reason)},"*"));</script>
</head><body><div id="root"></div><script type="module">${esc(js)}</script></body></html>`,
  };
}

/** Folders in the workspace that look like web projects (have src/main.tsx or frontend/src/main.tsx). */
export function findWebProjects(files: { path: string }[]) {
  const out: { root: string; entry: string }[] = [];
  for (const f of files) {
    const m = f.path.match(/^(.*?)(frontend\/)?src\/main\.(tsx|jsx|ts|js)$/);
    if (m)
      out.push({ root: (m[1] ?? "").replace(/\/$/, ""), entry: `${m[2] ?? ""}src/main.${m[3]}` });
  }
  return out;
}
