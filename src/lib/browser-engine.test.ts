// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeBrowser,
  browserEndpoint,
  browserOperation,
  LocalBrowserBackend,
  registerBrowser,
  stopBrowsers,
} from "./browser-engine";
const scope = { ownerId: "owner-a", workspaceId: "workspace-a" };
const token = "a".repeat(64),
  endpoint = "http://127.0.0.1:8931/v1/browser";
const receipt = (action: string) => ({
  id: crypto.randomUUID(),
  action,
  ok: true,
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
});
afterEach(async () => {
  await stopBrowsers();
});
describe("browser adapter boundaries", () => {
  it.each([
    "https://evil.example/v1/browser",
    "http://localhost:8931/v1/browser",
    "http://user:pass@127.0.0.1:8931/v1/browser",
    "http://127.0.0.1:8931/other",
  ])("rejects non-companion endpoint %s", (value) =>
    expect(() => browserEndpoint(value)).toThrow(),
  );
  it("does not accept script execution, forms or undeclared arguments", () => {
    for (const input of [
      { action: "evaluate", script: "anything" },
      { action: "click", selector: "button" },
      { action: "snapshot", apiKey: "dummy" },
    ])
      expect(browserOperation.safeParse(input).success).toBe(false);
  });
  it("requires real matching receipts and scopes active sessions by owner and workspace", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const data = JSON.parse(String(init?.body)) as { action: string };
      return Response.json({
        ...(data.action === "start"
          ? {
              sessionId: crypto.randomUUID(),
              origin: "https://site.example",
              expiresAt: new Date(Date.now() + 60000).toISOString(),
            }
          : { output: { snapshot: "Observed DOM" } }),
        receipt: receipt(data.action),
      });
    });
    const browser = new LocalBrowserBackend(scope, endpoint, token, transport);
    await browser.start();
    registerBrowser(browser);
    expect(JSON.stringify(browser)).not.toContain(token);
    expect(activeBrowser(scope)).toBe(browser);
    expect(activeBrowser({ ...scope, ownerId: "owner-b" })).toBeUndefined();
    expect(activeBrowser({ ...scope, workspaceId: "workspace-b" })).toBeUndefined();
    await expect(browser.run({ action: "navigate", url: "https://other.example" })).rejects.toThrow(
      "approved origin",
    );
    expect(await browser.run({ action: "snapshot" })).toEqual({ snapshot: "Observed DOM" });
    expect(JSON.stringify(browser.receipts)).not.toContain(token);
    await browser.stop();
    await expect(browser.run({ action: "snapshot" })).rejects.toThrow("Start");
  });
  it("does not report success when the backend omits execution evidence", async () => {
    const browser = new LocalBrowserBackend(
      scope,
      endpoint,
      token,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ output: { ok: true } })),
    );
    await expect(browser.start()).rejects.toThrow("failed");
    expect(browser.state).toBe("error");
  });
});
