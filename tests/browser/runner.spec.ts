import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { LocalBrowserBackend } from "../../src/lib/browser-engine";

// Local, unauthenticated fixture only. Never navigate a production account during tests.
const appOrigin = "http://127.0.0.1:4173";
const scope = { ownerId: "test-owner", workspaceId: "test-workspace" };
let fixture: Server,
  forbidden: Server,
  target = "",
  forbiddenHits = 0;
let runner: { endpoint: string; pairingToken: string; close: () => Promise<void> };
const transport: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    headers: { ...Object.fromEntries(new Headers(init?.headers)), Origin: appOrigin },
  });
const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port");
  return `http://127.0.0.1:${address.port}`;
};
test.beforeAll(async () => {
  forbidden = createServer((_request, response) => {
    forbiddenHits++;
    response.end("Private fixture should never be contacted");
  });
  const forbiddenOrigin = await listen(forbidden);
  fixture = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: `${forbiddenOrigin}/secret` });
      response.end();
      return;
    }
    if (request.url === "/missing.png") {
      response.writeHead(404);
      response.end("missing");
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><html><head><title>OpenChat browser fixture</title></head><body><h1>Real browser fixture</h1><div style="width:1200px">Wide content</div><img src="/missing.png" alt="Broken fixture"><a href="/next">Next page</a><button aria-label="Example action"></button><script>console.error("fixture console error");setTimeout(()=>{throw new Error("fixture runtime error")},0)</script></body></html>',
    );
  });
  target = await listen(fixture);
  // The companion is an independent Node module, not part of the app server bundle.
  const { startBrowserRunner } = await import("../../tooling/browser-runner.mjs");
  runner = await startBrowserRunner({ target, appOrigin, port: 0, allowLocalTarget: true });
});
test.afterAll(async () => {
  await runner?.close();
  await Promise.all(
    [fixture, forbidden]
      .filter(Boolean)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});
test("real isolated Chrome produces DOM, screenshots, diagnostics and scoped tabs", async () => {
  const browser = new LocalBrowserBackend(scope, runner.endpoint, runner.pairingToken, transport);
  try {
    await browser.start();
    const navigation = await browser.run({ action: "navigate", url: target });
    expect(navigation["status"]).toBe(200);
    const dom = await browser.run({ action: "snapshot" });
    expect(dom["snapshot"]).toContain("Real browser fixture");
    await browser.run({ action: "viewport", viewport: "mobile" });
    const qa = await browser.run({ action: "diagnostics" });
    expect(qa["overflow"]).toBe(true);
    expect(JSON.stringify(qa["errors"])).toContain("fixture console error");
    expect(JSON.stringify(qa["failures"])).toContain("404");
    expect(qa["brokenImages"]).toHaveLength(1);
    const capture = await browser.run({ action: "screenshot" });
    expect(capture["screenshot"]).toMatch(/^data:image\/jpeg;base64,/);
    await mkdir("artifacts/browser-evidence", { recursive: true });
    await writeFile(
      "artifacts/browser-evidence/local-fixture.jpg",
      Buffer.from(String(capture["screenshot"]).split(",")[1]!, "base64"),
    );
    await browser.run({ action: "new-tab", url: `${target}/next` });
    const tabs = await browser.run({ action: "tabs" });
    expect(tabs["tabs"]).toHaveLength(2);
    const credentials = JSON.stringify(browser.receipts);
    expect(credentials).not.toContain(runner.pairingToken);
    await writeFile(
      "artifacts/browser-evidence/qa-report.json",
      JSON.stringify(
        { qa, receipts: browser.receipts.map(({ output: _output, ...receipt }) => receipt) },
        null,
        2,
      ),
    );
  } finally {
    await browser.stop();
  }
});
test("redirects cannot contact another local origin and scripts/writes are unavailable", async () => {
  const browser = new LocalBrowserBackend(scope, runner.endpoint, runner.pairingToken, transport);
  try {
    await browser.start();
    await expect(browser.run({ action: "navigate", url: `${target}/redirect` })).rejects.toThrow();
    expect(forbiddenHits).toBe(0);
    const response = await transport(runner.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-openchat-pairing": runner.pairingToken },
      body: JSON.stringify({
        ...scope,
        action: "execute-script",
        sessionId: "unknown",
        script: "arbitrary",
      }),
    });
    expect(response.ok).toBe(false);
  } finally {
    await browser.stop();
  }
});
test("pairing, origin and owner/workspace boundaries reject unauthorized requests", async () => {
  const ownBrowser = new LocalBrowserBackend(
    scope,
    runner.endpoint,
    runner.pairingToken,
    transport,
  );
  await ownBrowser.start();
  try {
    const badToken = await transport(runner.endpoint, {
      method: "POST",
      headers: { "x-openchat-pairing": "invalid" },
      body: "{}",
    });
    expect(badToken.status).toBe(401);
    const badOrigin = await fetch(runner.endpoint, {
      method: "POST",
      headers: {
        Origin: "https://attacker.example.com",
        "x-openchat-pairing": runner.pairingToken,
      },
      body: "{}",
    });
    expect(badOrigin.status).toBe(403);
    const wrongOwner = await transport(runner.endpoint, {
      method: "POST",
      headers: { "x-openchat-pairing": runner.pairingToken },
      body: JSON.stringify({
        ownerId: "another-owner",
        workspaceId: scope.workspaceId,
        action: "start",
      }),
    });
    expect(wrongOwner.status).toBe(403);
    const wrongWorkspace = await transport(runner.endpoint, {
      method: "POST",
      headers: { "x-openchat-pairing": runner.pairingToken },
      body: JSON.stringify({
        ...scope,
        workspaceId: "another-workspace",
        sessionId: ownBrowser.id,
        action: "tabs",
      }),
    });
    expect(wrongWorkspace.status).toBe(404);
    expect((await ownBrowser.run({ action: "tabs" }))["tabs"]).toHaveLength(1);
  } finally {
    await ownBrowser.stop();
  }
});
test("the actual browser client pairs over CORS and receives a real observation", async ({
  page,
}) => {
  await page.route("http://127.0.0.1:54321/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "false" }),
  );
  await page.goto("/auth");
  const result = await page.evaluate(
    async ({ endpoint, token, scope, target }) => {
      const moduleUrl = "/src/lib/browser-engine.ts";
      const { LocalBrowserBackend } = await import(moduleUrl);
      const browser = new LocalBrowserBackend(scope, endpoint, token);
      try {
        await browser.start();
        const observation = await browser.run({ action: "navigate", url: target });
        return {
          snapshot: observation.snapshot,
          receiptCount: browser.receipts.length,
          credentialsLeaked: JSON.stringify(browser.receipts).includes(token),
        };
      } finally {
        await browser.stop();
      }
    },
    { endpoint: runner.endpoint, token: runner.pairingToken, scope, target },
  );
  expect(result.snapshot).toContain("Real browser fixture");
  expect(result.receiptCount).toBe(2);
  expect(result.credentialsLeaked).toBe(false);
});
