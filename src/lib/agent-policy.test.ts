import { describe, it, expect } from "vitest";
import { decision, defaultRules, boundedTimeout, type Capability } from "./agent-policy";
describe("agent permissions", () => {
  for (const cap of [
    "search",
    "shell",
    "filesRead",
    "filesWrite",
    "cloudSync",
    "skills",
    "media",
  ] as Capability[])
    it(`None permits ${cap}`, () => expect(decision("none", cap)).toBe("yes"));
  for (const cap of [
    "fetch",
    "mcp",
    "skillImport",
    "network",
    "restart",
    "wasm",
    "timeout",
    "git",
  ] as Capability[]) {
    it(`None denies ${cap}`, () => expect(decision("none", cap)).toBe("no"));
    it(`Ask requires approval for ${cap}`, () => expect(decision("ask", cap)).toBe("ask"));
    it(`YOLO permits ${cap}`, () => expect(decision("yolo", cap)).toBe("yes"));
  }
  it("custom can deny baseline cloud sync", () =>
    expect(
      decision("p", "cloudSync", [
        { id: "p", name: "p", rules: { ...defaultRules(), cloudSync: "no" } },
      ]),
    ).toBe("no"));
  it("unknown presets fail closed", () => expect(decision("missing", "shell")).toBe("no"));
  it("timeouts bound resource use", () => {
    expect(boundedTimeout(120)).toBe(120);
    expect(() => boundedTimeout(1801)).toThrow();
    expect(() => boundedTimeout(9)).toThrow();
  });
  for (const cap of ["build", "publish", "filesDelete"] as Capability[]) {
    it(`YOLO still asks before ${cap}`, () => expect(decision("yolo", cap)).toBe("ask"));
    it(`custom "allow" still asks before ${cap}`, () =>
      expect(
        decision("p", cap, [{ id: "p", name: "p", rules: { ...defaultRules(), [cap]: "yes" } }]),
      ).toBe("ask"));
    it(`None blocks ${cap}`, () => expect(decision("none", cap)).toBe("no"));
  }
  for (const cap of ["shell", "filesWrite", "cloudSync", "media", "browser"] as Capability[])
    it(`Ask requires approval for risky ${cap}`, () => expect(decision("ask", cap)).toBe("ask"));
});
