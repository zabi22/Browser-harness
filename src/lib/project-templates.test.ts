import { describe, it, expect } from "vitest";
import { TEMPLATES, templateFiles } from "./project-templates";
import { findWebProjects, importMap, pkgName, resolveLocal } from "./web-preview";

describe("project templates", () => {
  it("offers the six requested project types", () =>
    expect(TEMPLATES.map((t) => t.id)).toEqual(["website", "webapp", "game", "go-cli", "wails", "fyne"]));
  for (const t of TEMPLATES) {
    it(`${t.id} includes a build workflow and readme`, () => {
      const f = templateFiles(t.id, "My App");
      expect(f[".github/workflows/build.yml"]).toBeTruthy();
      expect(f["README.md"]).toBeTruthy();
    });
  }
  it("web templates have a preview entry that exists", () => {
    for (const t of TEMPLATES.filter((t) => t.previewEntry)) expect(templateFiles(t.id, "x")[t.previewEntry!]).toBeTruthy();
  });
  it("Go templates have unit tests and a module", () => {
    for (const id of ["go-cli", "wails", "fyne"] as const) {
      const f = templateFiles(id, "My App");
      expect(f["go.mod"]).toMatch(/^module my-app/);
      expect(f["calc_test.go"]).toContain("func TestCalc");
    }
  });
  it("desktop builds run on a real Windows runner and upload the .exe", () => {
    for (const id of ["wails", "fyne", "go-cli"] as const) {
      const ci = templateFiles(id, "calc")[".github/workflows/build.yml"]!;
      expect(ci).toContain("windows-latest");
      expect(ci).toContain("calc.exe");
    }
  });
  it("website contact form does not send data anywhere", () => {
    const app = templateFiles("website", "x")["src/App.tsx"]!;
    expect(app).toContain("preventDefault");
    expect(app).not.toMatch(/fetch\(|action=/);
  });
});

describe("web preview helpers", () => {
  it("finds web and Wails frontends", () =>
    expect(findWebProjects([{ path: "site/src/main.tsx" }, { path: "calc/frontend/src/main.tsx" }, { path: "x/main.go" }]))
      .toEqual([{ root: "site", entry: "src/main.tsx" }, { root: "calc", entry: "frontend/src/main.tsx" }]));
  it("resolves extensionless and index imports", () => {
    const files = new Set(["s/src/App.tsx", "s/src/ui/index.ts"]);
    expect(resolveLocal("s/src/main.tsx", "./App", files)).toBe("s/src/App.tsx");
    expect(resolveLocal("s/src/main.tsx", "./ui", files)).toBe("s/src/ui/index.ts");
    expect(resolveLocal("s/src/main.tsx", "./nope", files)).toBeNull();
  });
  it("maps packages to esm.sh sharing one React", () => {
    expect(pkgName("@a/b/c")).toBe("@a/b");
    expect(importMap(["lucide-react"]).imports["lucide-react"]).toBe("https://esm.sh/lucide-react?external=react,react-dom");
  });
});
