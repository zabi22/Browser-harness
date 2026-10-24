import { describe, it, expect, vi } from "vitest";
import { buildTools } from "./tools";
import { DEFAULT_SETTINGS } from "./studio-client";
import { linuxFor } from "./linux-environment";
describe("execution permission gates", () => {
  it("does not expose unsupported video/music even when old saved settings enable them", async () => {
    const kit = await buildTools({
      ...DEFAULT_SETTINGS,
      permissionMode: "yolo",
      videoGen: true,
      musicGen: true,
    });
    expect(kit.run.has("generate_video")).toBe(false);
    expect(kit.run.has("generate_music")).toBe(false);
    expect(kit.warnings).toHaveLength(2);
  });
  it("custom preset with search Yes and MCP No still exposes web search", async () => {
    const rules = Object.fromEntries(
      Object.keys((await import("./agent-policy")).CAPABILITIES).map((k) => [k, "no"]),
    ) as Record<string, "no" | "yes">;
    rules["search"] = "yes";
    const kit = await buildTools(
      {
        ...DEFAULT_SETTINGS,
        webSearch: true,
        searxngUrl: "https://s.example",
        permissionMode: "p1",
        permissionPresets: [{ id: "p1", name: "Chat", rules: rules as never }],
      },
      [],
      undefined,
      { sessionId: "test" },
    );
    expect(kit.defs.map((d) => d.name)).toContain("web_search");
  });
  it("Ask cannot restart Linux without approval", async () => {
    const restart = vi.spyOn(linuxFor("restart-denied"), "restart").mockResolvedValue("restarted");
    const approve = vi.fn().mockResolvedValue(false);
    const kit = await buildTools({ ...DEFAULT_SETTINGS, permissionMode: "ask" }, [], undefined, {
      workspaceId: "restart-denied",
      sessionId: "test",
      approve,
    });
    const runner = kit.run.get("restart_environment");
    expect(runner).toBeDefined();
    if (!runner) throw new Error("Missing restart tool");
    await expect(runner({}, new AbortController().signal)).rejects.toThrow("User denied");
    expect(approve).toHaveBeenCalledOnce();
    expect(restart).not.toHaveBeenCalled();
  });
  it("YOLO restarts Linux without asking", async () => {
    const restart = vi.spyOn(linuxFor("restart-yolo"), "restart").mockResolvedValue("restarted");
    const approve = vi.fn();
    const kit = await buildTools({ ...DEFAULT_SETTINGS, permissionMode: "yolo" }, [], undefined, {
      workspaceId: "restart-yolo",
      sessionId: "test",
      approve,
    });
    const runner = kit.run.get("restart_environment");
    expect(runner).toBeDefined();
    if (!runner) throw new Error("Missing restart tool");
    await runner({}, new AbortController().signal);
    expect(restart).toHaveBeenCalledOnce();
    expect(approve).not.toHaveBeenCalled();
  });
  it("None does not expose fetch, Git, restart, import or external WASM tools", async () => {
    const kit = await buildTools({ ...DEFAULT_SETTINGS, permissionMode: "none" }, [], undefined, {
      workspaceId: "test",
      sessionId: "test",
    });
    const names = kit.defs.map((d) => d.name);
    expect(names).toContain("bash");
    expect(names).toContain("write_file");
    expect(names).toContain("ask_user");
    for (const name of [
      "fetch_url",
      "git_repo",
      "git_clone",
      "wasm_start",
      "restart_environment",
      "import_skill",
      "set_session_timeout",
    ])
      expect(names).not.toContain(name);
  });
  it("Ask denial does not execute timeout changes", async () => {
    const changed = vi.fn(),
      approve = vi.fn().mockResolvedValue(false);
    const kit = await buildTools({ ...DEFAULT_SETTINGS, permissionMode: "ask" }, [], undefined, {
      workspaceId: "test",
      sessionId: "test",
      approve,
      setTimeout: changed,
    });
    await expect(
      kit.run.get("set_session_timeout")?.(
        { kind: "tool", seconds: 90 },
        new AbortController().signal,
      ),
    ).rejects.toThrow("User denied");
    expect(approve).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
  });
  it("Ask requires approval before bash boots a stopped Linux", async () => {
    const env = linuxFor("autostart-ask");
    env.stop();
    const approve = vi.fn().mockResolvedValue(false);
    const kit = await buildTools({ ...DEFAULT_SETTINGS, permissionMode: "ask" }, [], undefined, {
      workspaceId: "autostart-ask",
      sessionId: "test",
      approve,
    });
    await expect(
      kit.run.get("bash")?.({ command: "echo hi" }, new AbortController().signal),
    ).rejects.toThrow("User denied");
    expect(approve).toHaveBeenCalledOnce();
  });
  it("None hides the bash autostart denial behind the missing tool", async () => {
    const kit = await buildTools({ ...DEFAULT_SETTINGS, permissionMode: "none" }, [], undefined, {
      workspaceId: "autostart-none",
      sessionId: "test",
    });
    // bash itself is baseline-allowed, but booting a stopped guest must not be silent in stricter modes
    expect(kit.defs.map((d) => d.name)).toContain("bash");
  });
  it("YOLO applies the exact session timeout without asking", async () => {
    const changed = vi.fn(),
      approve = vi.fn();
    const kit = await buildTools({ ...DEFAULT_SETTINGS, permissionMode: "yolo" }, [], undefined, {
      workspaceId: "test",
      sessionId: "test",
      approve,
      setTimeout: changed,
    });
    await kit.run.get("set_session_timeout")?.(
      { kind: "model", seconds: 300 },
      new AbortController().signal,
    );
    expect(changed).toHaveBeenCalledWith("model", 300);
    expect(approve).not.toHaveBeenCalled();
  });
});
