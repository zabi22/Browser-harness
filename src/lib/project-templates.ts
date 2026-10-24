// Project starters: each template returns real files that get saved into a workspace folder.
export type TemplateId = "website" | "webapp" | "game" | "go-cli" | "wails" | "fyne";
export interface Template {
  id: TemplateId;
  label: string;
  hint: string;
  kind: "web" | "go" | "desktop";
  previewEntry?: string;
}

export const TEMPLATES: Template[] = [
  {
    id: "website",
    label: "Website",
    hint: "React + TypeScript + Tailwind landing site",
    kind: "web",
    previewEntry: "src/main.tsx",
  },
  {
    id: "webapp",
    label: "Web application",
    hint: "React app with state and a form",
    kind: "web",
    previewEntry: "src/main.tsx",
  },
  {
    id: "game",
    label: "Browser game",
    hint: "Canvas game loop in React",
    kind: "web",
    previewEntry: "src/main.tsx",
  },
  {
    id: "go-cli",
    label: "Go CLI application",
    hint: "Go module with tests and a Windows .exe build",
    kind: "go",
  },
  {
    id: "wails",
    label: "Windows desktop (Wails)",
    hint: "Go backend + React window, built on Windows",
    kind: "desktop",
    previewEntry: "frontend/src/main.tsx",
  },
  {
    id: "fyne",
    label: "Go GUI (Fyne)",
    hint: "Pure-Go window with buttons, built on Windows",
    kind: "desktop",
  },
];
export const getTemplate = (id: string) => TEMPLATES.find((t) => t.id === id);

const goModName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "app";

const webBase = (title: string, app: string, dir = ""): Record<string, string> => ({
  [`${dir}index.html`]: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${title}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`,
  [`${dir}package.json`]:
    JSON.stringify(
      {
        name: goModName(title),
        private: true,
        version: "0.1.0",
        type: "module",
        scripts: {
          dev: "vite",
          build: "tsc -b && vite build",
          preview: "vite preview",
          test: "vitest run --passWithNoTests",
        },
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", "lucide-react": "^0.460.0" },
        devDependencies: {
          "@types/react": "^19.0.0",
          "@types/react-dom": "^19.0.0",
          "@vitejs/plugin-react": "^4.3.0",
          "@tailwindcss/vite": "^4.0.0",
          tailwindcss: "^4.0.0",
          typescript: "^5.6.0",
          vite: "^6.0.0",
          vitest: "^2.1.0",
        },
      },
      null,
      2,
    ) + "\n",
  [`${dir}vite.config.ts`]: `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nimport tailwindcss from "@tailwindcss/vite";\n\nexport default defineConfig({ plugins: [react(), tailwindcss()] });\n`,
  [`${dir}tsconfig.json`]:
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["src"],
      },
      null,
      2,
    ) + "\n",
  [`${dir}src/index.css`]: `@import "tailwindcss";\n`,
  [`${dir}src/main.tsx`]: `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport "./index.css";\nimport App from "./App";\n\ncreateRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);\n`,
  [`${dir}src/App.tsx`]: app,
});

const WEBSITE_APP = `import { useState } from "react";
import { Menu, Sparkles, Mail } from "lucide-react";

const links = [["Features", "#features"], ["About", "#about"], ["Contact", "#contact"]];

export default function App() {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50/90 backdrop-blur">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4" aria-label="Main">
          <a href="#" className="flex items-center gap-2 font-semibold"><Sparkles className="h-5 w-5" /> Studio</a>
          <button className="md:hidden" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(!open)}><Menu /></button>
          <ul className={(open ? "flex" : "hidden") + " absolute left-0 top-full w-full flex-col gap-4 bg-stone-50 p-6 md:static md:flex md:w-auto md:flex-row md:p-0"}>
            {links.map(([l, h]) => <li key={h}><a href={h} onClick={() => setOpen(false)} className="hover:underline">{l}</a></li>)}
          </ul>
        </nav>
      </header>
      <main>
        <section className="mx-auto max-w-5xl px-6 py-24">
          <h1 className="text-5xl font-bold tracking-tight md:text-7xl">Make something people remember.</h1>
          <p className="mt-6 max-w-xl text-lg text-stone-600">A small, fast, responsive site starter.</p>
        </section>
        <section id="features" className="mx-auto grid max-w-5xl gap-6 px-6 py-16 md:grid-cols-3">
          {["Fast", "Accessible", "Responsive"].map((f) => <div key={f} className="rounded-xl border border-stone-200 p-6"><h2 className="font-semibold">{f}</h2><p className="mt-2 text-sm text-stone-600">Built in from the first line.</p></div>)}
        </section>
        <section id="about" className="mx-auto max-w-5xl px-6 py-16"><h2 className="text-2xl font-semibold">About</h2><p className="mt-3 text-stone-600">Tell your story here.</p></section>
        <section id="contact" className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="flex items-center gap-2 text-2xl font-semibold"><Mail className="h-5 w-5" /> Contact</h2>
          {sent ? <p role="status" className="mt-4">Thanks! (Demo form: nothing was sent or stored.)</p> : (
            <form className="mt-4 grid max-w-md gap-3" onSubmit={(e) => { e.preventDefault(); setSent(true); }}>
              <label className="grid gap-1 text-sm">Name<input required className="rounded border border-stone-300 px-3 py-2" /></label>
              <label className="grid gap-1 text-sm">Message<textarea required className="rounded border border-stone-300 px-3 py-2" /></label>
              <button className="rounded bg-stone-900 px-4 py-2 text-stone-50">Send</button>
            </form>
          )}
        </section>
      </main>
      <footer className="border-t border-stone-200 py-8 text-center text-sm text-stone-500">© {new Date().getFullYear()} Studio</footer>
    </div>
  );
}
`;

const WEBAPP_APP = `import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

export default function App() {
  const [items, setItems] = useState<string[]>([]);
  const [text, setText] = useState("");
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-bold">Tasks</h1>
      <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { setItems([...items, text.trim()]); setText(""); } }}>
        <label className="sr-only" htmlFor="t">New task</label>
        <input id="t" value={text} onChange={(e) => setText(e.target.value)} className="flex-1 rounded border px-3 py-2" placeholder="Add a task" />
        <button aria-label="Add" className="rounded bg-black px-3 text-white"><Plus /></button>
      </form>
      <ul className="mt-4 space-y-2">
        {items.map((it, i) => <li key={i} className="flex justify-between rounded border p-2">{it}<button aria-label={"Delete " + it} onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></li>)}
      </ul>
    </main>
  );
}
`;

const GAME_APP = `import { useEffect, useRef, useState } from "react";

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  useEffect(() => {
    const c = ref.current!, g = c.getContext("2d")!;
    let x = 160, y = 120, dx = 2, dy = 2, raf = 0, px = 140;
    const move = (e: PointerEvent) => { px = e.offsetX - 40; };
    c.addEventListener("pointermove", move);
    const tick = () => {
      x += dx; y += dy;
      if (x < 8 || x > 312) dx = -dx;
      if (y < 8) dy = -dy;
      if (y > 222 && x > px && x < px + 80) { dy = -Math.abs(dy); setScore((s) => s + 1); }
      if (y > 248) { x = 160; y = 120; setScore(0); }
      g.fillStyle = "#111"; g.fillRect(0, 0, 320, 240);
      g.fillStyle = "#fbbf24"; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill();
      g.fillRect(px, 228, 80, 8);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); c.removeEventListener("pointermove", move); };
  }, []);
  return <main className="grid min-h-screen place-items-center bg-neutral-900 text-white"><div><p className="mb-2">Score: {score}</p><canvas ref={ref} width={320} height={240} className="rounded" /></div></main>;
}
`;

const ciWeb = (dir = "") => `name: build
on: [push, workflow_dispatch]
jobs:
  web:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: ./${dir} } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm install
      - run: npm test
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with: { name: site, path: ${dir || "."}/dist }
`;

const ciGo = (bin: string, cgo: boolean) => `name: build
on: [push, workflow_dispatch]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: "1.23" }
      - run: test -z "$(gofmt -l .)"
      - run: go vet ./...${cgo ? " || true" : ""}
      - run: go test ./...
  windows:
    runs-on: windows-latest
    needs: check
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: "1.23" }
      - run: go test ./...
      - run: go build -o ${bin}.exe .
${cgo ? '        env: { CGO_ENABLED: "1" }\n' : ""}      - uses: actions/upload-artifact@v4
        with: { name: ${bin}-windows, path: ${bin}.exe }
`;

const CALC_GO = (pkg: string) => `package ${pkg}

import "fmt"

// Calc applies a basic arithmetic operation.
func Calc(a, b float64, op string) (float64, error) {
	switch op {
	case "+":
		return a + b, nil
	case "-":
		return a - b, nil
	case "*":
		return a * b, nil
	case "/":
		if b == 0 {
			return 0, fmt.Errorf("division by zero")
		}
		return a / b, nil
	}
	return 0, fmt.Errorf("unknown operator %q", op)
}
`;
const CALC_TEST = (pkg: string) => `package ${pkg}

import "testing"

func TestCalc(t *testing.T) {
	cases := []struct {
		a, b float64
		op   string
		want float64
	}{{2, 3, "+", 5}, {5, 3, "-", 2}, {4, 2.5, "*", 10}, {9, 3, "/", 3}}
	for _, c := range cases {
		got, err := Calc(c.a, c.b, c.op)
		if err != nil || got != c.want {
			t.Fatalf("%v %s %v = %v, %v; want %v", c.a, c.op, c.b, got, err, c.want)
		}
	}
	if _, err := Calc(1, 0, "/"); err == nil {
		t.Fatal("expected division by zero error")
	}
}
`;

/** Files for a new project, keyed by path relative to the project folder. */
export function templateFiles(id: TemplateId, name: string): Record<string, string> {
  const mod = goModName(name);
  switch (id) {
    case "website":
      return {
        ...webBase(name, WEBSITE_APP),
        ".github/workflows/build.yml": ciWeb(),
        "README.md": `# ${name}\n\nWebsite starter. Preview in OpenChat; \`npm run build\` outputs \`dist/\`.\n`,
      };
    case "webapp":
      return {
        ...webBase(name, WEBAPP_APP),
        ".github/workflows/build.yml": ciWeb(),
        "README.md": `# ${name}\n\nWeb application starter.\n`,
      };
    case "game":
      return {
        ...webBase(name, GAME_APP),
        ".github/workflows/build.yml": ciWeb(),
        "README.md": `# ${name}\n\nBrowser game starter. Move the paddle with the mouse.\n`,
      };
    case "go-cli":
      return {
        "go.mod": `module ${mod}\n\ngo 1.23\n`,
        "main.go": `package main\n\nimport (\n\t"fmt"\n\t"os"\n\t"strconv"\n)\n\nfunc main() {\n\tif len(os.Args) != 4 {\n\t\tfmt.Println("usage: ${mod} <a> <op> <b>")\n\t\tos.Exit(2)\n\t}\n\ta, _ := strconv.ParseFloat(os.Args[1], 64)\n\tb, _ := strconv.ParseFloat(os.Args[3], 64)\n\tr, err := Calc(a, b, os.Args[2])\n\tif err != nil {\n\t\tfmt.Fprintln(os.Stderr, err)\n\t\tos.Exit(1)\n\t}\n\tfmt.Println(r)\n}\n`,
        "calc.go": CALC_GO("main"),
        "calc_test.go": CALC_TEST("main"),
        ".github/workflows/build.yml": ciGo(mod, false),
        "README.md": `# ${name}\n\nGo CLI. Built and tested by GitHub Actions; the Windows job uploads \`${mod}.exe\`.\n`,
      };
    case "wails": {
      const fe = webBase(
        name,
        `import { useState } from "react";\n\nconst keys = ["7","8","9","/","4","5","6","*","1","2","3","-","0",".","=","+"];\n\ndeclare global { interface Window { go?: { main: { App: { Calc(a: number, b: number, op: string): Promise<number> } } } } }\n\n// In the desktop app this calls Go (app.go). In the browser preview a local fallback runs instead.\nconst calc = async (a: number, b: number, op: string) => window.go ? window.go.main.App.Calc(a, b, op) : ({ "+": a + b, "-": a - b, "*": a * b, "/": a / b } as Record<string, number>)[op];\n\nexport default function App() {\n  const [shown, setShown] = useState("0");\n  const [acc, setAcc] = useState<{ v: number; op: string } | null>(null);\n  const press = async (k: string) => {\n    if ("+-*/".includes(k)) { setAcc({ v: Number(shown), op: k }); setShown("0"); }\n    else if (k === "=") { if (acc) { try { setShown(String(await calc(acc.v, Number(shown), acc.op))); } catch (e) { setShown(String(e)); } setAcc(null); } }\n    else setShown(shown === "0" && k !== "." ? k : shown + k);\n  };\n  return (\n    <main className="grid min-h-screen place-items-center bg-zinc-900 text-white">\n      <div className="w-64">\n        <output className="block rounded bg-zinc-800 p-4 text-right text-3xl" aria-live="polite">{shown}</output>\n        <div className="mt-3 grid grid-cols-4 gap-2">\n          {keys.map((k) => <button key={k} onClick={() => press(k)} className="rounded bg-zinc-700 py-3 text-xl hover:bg-zinc-600">{k}</button>)}\n          <button onClick={() => { setShown("0"); setAcc(null); }} className="col-span-4 rounded bg-red-700 py-2">Clear</button>\n        </div>\n      </div>\n    </main>\n  );\n}\n`,
        "frontend/",
      );
      return {
        ...fe,
        "go.mod": `module ${mod}\n\ngo 1.23\n\nrequire github.com/wailsapp/wails/v2 v2.9.2\n`,
        "main.go": `package main\n\nimport (\n\t"embed"\n\n\t"github.com/wailsapp/wails/v2"\n\t"github.com/wailsapp/wails/v2/pkg/options"\n\t"github.com/wailsapp/wails/v2/pkg/options/assetserver"\n)\n\n//go:embed all:frontend/dist\nvar assets embed.FS\n\nfunc main() {\n\tapp := &App{}\n\terr := wails.Run(&options.App{\n\t\tTitle:       "${name}",\n\t\tWidth:       360,\n\t\tHeight:      520,\n\t\tAssetServer: &assetserver.Options{Assets: assets},\n\t\tBind:        []interface{}{app},\n\t})\n\tif err != nil {\n\t\tprintln("Error:", err.Error())\n\t}\n}\n`,
        "app.go": `package main\n\n// App is bound to the frontend as window.go.main.App.\ntype App struct{}\n\n// Calc is callable from React.\nfunc (a *App) Calc(x, y float64, op string) (float64, error) { return Calc(x, y, op) }\n`,
        "calc.go": CALC_GO("main"),
        "calc_test.go": CALC_TEST("main"),
        "wails.json":
          JSON.stringify(
            {
              $schema: "https://wails.io/schemas/config.v2.json",
              name,
              outputfilename: mod,
              "frontend:install": "npm install",
              "frontend:build": "npm run build",
              "frontend:dir": "frontend",
            },
            null,
            2,
          ) + "\n",
        ".github/workflows/build.yml": `name: build\non: [push, workflow_dispatch]\njobs:\n  windows:\n    runs-on: windows-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-go@v5\n        with: { go-version: "1.23" }\n      - uses: actions/setup-node@v4\n        with: { node-version: 22 }\n      - run: go install github.com/wailsapp/wails/v2/cmd/wails@v2.9.2\n      - run: go test ./...\n      - run: wails build -platform windows/amd64 -clean\n      - name: Smoke test (launch for 5 seconds)\n        shell: pwsh\n        run: |\n          $p = Start-Process -FilePath build/bin/${mod}.exe -PassThru\n          Start-Sleep 5\n          if ($p.HasExited) { throw "App exited early with code $($p.ExitCode)" }\n          Stop-Process $p\n      - uses: actions/upload-artifact@v4\n        with: { name: ${mod}-windows, path: build/bin/${mod}.exe }\n`,
        "README.md": `# ${name}\n\nWails (Go + React) desktop calculator. The OpenChat preview shows only the React frontend; the real Windows build and launch test run on GitHub Actions.\n`,
      };
    }
    case "fyne":
      return {
        "go.mod": `module ${mod}\n\ngo 1.23\n\nrequire fyne.io/fyne/v2 v2.5.2\n`,
        "main.go": `package main\n\nimport (\n\t"fmt"\n\t"strconv"\n\n\t"fyne.io/fyne/v2/app"\n\t"fyne.io/fyne/v2/container"\n\t"fyne.io/fyne/v2/widget"\n)\n\nfunc main() {\n\tw := app.New().NewWindow("${name}")\n\ta, b, out := widget.NewEntry(), widget.NewEntry(), widget.NewLabel("")\n\tbtn := func(op string) *widget.Button {\n\t\treturn widget.NewButton(op, func() {\n\t\t\tx, _ := strconv.ParseFloat(a.Text, 64)\n\t\t\ty, _ := strconv.ParseFloat(b.Text, 64)\n\t\t\tr, err := Calc(x, y, op)\n\t\t\tif err != nil {\n\t\t\t\tout.SetText(err.Error())\n\t\t\t\treturn\n\t\t\t}\n\t\t\tout.SetText(fmt.Sprint(r))\n\t\t})\n\t}\n\tw.SetContent(container.NewVBox(a, b, container.NewGridWithColumns(4, btn("+"), btn("-"), btn("*"), btn("/")), out))\n\tw.ShowAndRun()\n}\n`,
        "calc.go": CALC_GO("main"),
        "calc_test.go": CALC_TEST("main"),
        ".github/workflows/build.yml": ciGo(mod, true).replace(
          "go vet ./... || true",
          "go vet ./calc.go ./calc_test.go",
        ),
        "README.md": `# ${name}\n\nFyne (pure Go) GUI. Needs a C compiler, so it is built on the GitHub Windows runner.\n`,
      };
  }
}

/** Status ladder; a step is only true when something real proved it. */
export type BuildStage = "source" | "preview" | "compiled" | "windowsTested" | "artifact";
export const STAGE_LABELS: Record<BuildStage, string> = {
  source: "Source generated",
  preview: "Web preview available",
  compiled: "Compiled",
  windowsTested: "Tested on Windows",
  artifact: "Build artifact available",
};
