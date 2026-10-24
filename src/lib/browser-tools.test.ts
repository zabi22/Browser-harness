import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTools } from "./tools";
import { DEFAULT_SETTINGS } from "./studio-client";
import { LocalBrowserBackend, registerBrowser, stopBrowsers } from "./browser-engine";
const scope = { ownerId: "owner-a", workspaceId: "workspace-a" };
afterEach(async () => {
  await stopBrowsers();
  vi.restoreAllMocks();
});
function active() {
  const browser = new LocalBrowserBackend(
    scope,
    "http://127.0.0.1:8931/v1/browser",
    "b".repeat(64),
  );
  browser.state = "ready";
  const execute = vi
    .spyOn(browser, "run")
    .mockResolvedValue({ snapshot: "Untrusted webpage content" });
  registerBrowser(browser);
  return execute;
}
describe("browser agent execution gates", () => {
  it("does not register another owner or workspace browser as an available tool", async () => {
    active();
    const kit = await buildTools({ ...DEFAULT_SETTINGS, permissionMode: "ask" }, [], undefined, {
      ...scope,
      ownerId: "owner-b",
    });
    expect(kit.defs.map((tool) => tool.name)).not.toContain("browser_read");
  });
  it("asks before execution and enforces a live permission change", async () => {
    const execute = active(),
      approve = vi.fn().mockResolvedValue(false);
    let current = { ...DEFAULT_SETTINGS, permissionMode: "ask" };
    const kit = await buildTools(current, [], undefined, {
      ...scope,
      approve,
      getSettings: () => current,
    });
    const run = kit.run.get("browser_read");
    expect(run).toBeDefined();
    await expect(run!({ action: "snapshot" }, new AbortController().signal)).rejects.toThrow(
      "User denied",
    );
    expect(execute).not.toHaveBeenCalled();
    current = { ...current, permissionMode: "none" };
    await expect(run!({ action: "snapshot" }, new AbortController().signal)).rejects.toThrow(
      "Permission denied",
    );
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects unregistered browser actions even after approval", async () => {
    const execute = active();
    const kit = await buildTools({ ...DEFAULT_SETTINGS, permissionMode: "ask" }, [], undefined, {
      ...scope,
      approve: async () => true,
    });
    await expect(
      kit.run.get("browser_read")!(
        { action: "execute-script", script: "anything" },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
    const result = await kit.run.get("browser_read")!(
      { action: "snapshot" },
      new AbortController().signal,
    );
    expect(result.output).toContain("Untrusted webpage content");
    expect(execute).toHaveBeenCalledOnce();
  });
});
