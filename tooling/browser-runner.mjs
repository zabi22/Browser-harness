// Explicitly started, per-device experimental companion. Never import this into the app server.
import { createServer } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { startBrowserEgress } from "./browser-egress.mjs";

const environment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|HOME|DISPLAY)$/i.test(
        key,
      ),
    ),
  );
const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export async function startBrowserRunner({
  target,
  appOrigin,
  port = 8931,
  allowLocalTarget = false,
  maxAgeMs = 600000,
  channel = "chrome",
}) {
  const app = new URL(appOrigin);
  if (
    !["http:", "https:"].includes(app.protocol) ||
    app.origin !== appOrigin ||
    app.username ||
    app.password
  )
    throw new Error("Use an exact app origin");
  const egress = await startBrowserEgress(target, { allowLocalTarget });
  const pairingToken = randomBytes(32).toString("hex"),
    sessions = new Map(),
    sockets = new Set();
  let owner = null,
    creating = false;
  const closeSession = async (session) => {
    sessions.delete(session.id);
    clearTimeout(session.timer);
    session.abort.abort();
    await session.browser.close().catch(() => {});
  };
  const json = (response, status, value) => {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(value));
  };
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin !== appOrigin || request.headers.host !== `127.0.0.1:${server.address().port}`) {
      json(response, 403, { error: "Origin or host denied" });
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", appOrigin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "content-type, x-openchat-pairing");
    response.setHeader("Access-Control-Expose-Headers", "content-type");
    if (request.headers["access-control-request-private-network"] === "true")
      response.setHeader("Access-Control-Allow-Private-Network", "true");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    const credential = request.headers["x-openchat-pairing"];
    if (
      typeof credential !== "string" ||
      !/^[a-f0-9]{64}$/.test(credential) ||
      !timingSafeEqual(Buffer.from(credential), Buffer.from(pairingToken))
    ) {
      json(response, 401, { error: "Pairing required" });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/browser") {
      json(response, 404, { error: "Unknown route" });
      return;
    }
    let input;
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk.toString();
        if (body.length > 8192) throw new Error("Too large");
      }
      input = JSON.parse(body);
      if (
        !validId(input.ownerId) ||
        !validId(input.workspaceId) ||
        typeof input.action !== "string"
      )
        throw new Error("Invalid scope");
    } catch {
      json(response, 400, { error: "Invalid browser request" });
      return;
    }
    if (owner && owner !== input.ownerId) {
      json(response, 403, {
        error: "Runner is paired to another account; restart it to change owner",
      });
      return;
    }
    const receipt = { id: randomUUID(), action: input.action, startedAt: new Date().toISOString() };
    if (input.action === "start") {
      if (creating || sessions.size >= 1) {
        json(response, 409, { error: "One local browser session is allowed" });
        return;
      }
      owner = input.ownerId;
      creating = true;
      let browser;
      try {
        browser = await chromium.launch({
          channel,
          headless: true,
          chromiumSandbox: true,
          env: environment(),
          proxy: { server: egress.url, bypass: "<-loopback>" },
          args: ["--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
        });
        const context = await browser.newContext({
          viewport: { width: 1280, height: 720 },
          acceptDownloads: false,
          serviceWorkers: "block",
          permissions: [],
        });
        context.setDefaultTimeout(10000);
        context.setDefaultNavigationTimeout(20000);
        await context.route("**/*", async (route) => {
          const req = route.request();
          let allowed = false;
          try {
            allowed = new URL(req.url()).origin === egress.origin;
          } catch {
            /* deny */
          }
          if (!allowed || !["GET", "HEAD"].includes(req.method()))
            await route.abort("blockedbyclient");
          else await route.continue();
        });
        const session = {
          id: randomUUID(),
          ownerId: input.ownerId,
          workspaceId: input.workspaceId,
          browser,
          context,
          pages: [],
          current: 0,
          errors: [],
          failures: [],
          steps: 0,
          busy: false,
          abort: new AbortController(),
          timer: null,
        };
        const observePage = (page) => {
          session.pages.push(page);
          page.on("pageerror", (error) => {
            if (session.errors.length < 100)
              session.errors.push(String(error.message).slice(0, 1000));
          });
          page.on("console", (msg) => {
            if (msg.type() === "error" && session.errors.length < 100)
              session.errors.push(msg.text().slice(0, 1000));
          });
          page.on("requestfailed", (req) => {
            if (session.failures.length < 100)
              session.failures.push({
                url: req.url().slice(0, 2000),
                error: req.failure()?.errorText ?? "Request failed",
              });
          });
          page.on("response", (result) => {
            if (result.status() >= 400 && session.failures.length < 100)
              session.failures.push({
                url: result.url().slice(0, 2000),
                error: `HTTP ${result.status()}`,
              });
          });
          page.on("download", (download) => {
            void download.cancel();
          });
        };
        context.on("page", observePage);
        await context.newPage();
        session.timer = setTimeout(() => {
          void closeSession(session);
        }, maxAgeMs);
        session.timer.unref();
        sessions.set(session.id, session);
        json(response, 200, {
          sessionId: session.id,
          origin: egress.origin,
          expiresAt: new Date(Date.now() + maxAgeMs).toISOString(),
          receipt: { ...receipt, ok: true, endedAt: new Date().toISOString() },
        });
      } catch {
        await browser?.close().catch(() => {});
        json(response, 503, {
          error:
            "Local Chrome could not start with its sandbox. Install Chrome or review local execution permissions.",
        });
      } finally {
        creating = false;
      }
      return;
    }
    const session = sessions.get(input.sessionId);
    if (!session && input.action === "close") {
      json(response, 200, { receipt: { ...receipt, ok: true, endedAt: new Date().toISOString() } });
      return;
    }
    if (
      !session ||
      session.ownerId !== input.ownerId ||
      session.workspaceId !== input.workspaceId
    ) {
      json(response, 404, { error: "Browser session is unavailable for this workspace" });
      return;
    }
    if (input.action === "close") {
      await closeSession(session);
      json(response, 200, { receipt: { ...receipt, ok: true, endedAt: new Date().toISOString() } });
      return;
    }
    if (session.busy) {
      json(response, 409, { error: "Browser is busy; wait or stop the session" });
      return;
    }
    if (++session.steps > 50) {
      await closeSession(session);
      json(response, 429, { error: "Browser action budget exhausted" });
      return;
    }
    session.busy = true;
    try {
      let page = session.pages[session.current],
        output;
      if (!page || page.isClosed()) throw new Error("The tab is closed");
      if (input.action === "navigate" || input.action === "new-tab") {
        const url = new URL(input.url);
        if (url.origin !== egress.origin || url.username || url.password)
          throw new Error("Navigation is limited to the runner-approved origin");
        if (input.action === "new-tab") {
          if (session.pages.length >= 3) throw new Error("Three-tab limit reached");
          page = await session.context.newPage();
          session.current = session.pages.indexOf(page);
        }
        const result = await page.goto(url.href, { waitUntil: "domcontentloaded" });
        if (new URL(page.url()).origin !== egress.origin) {
          await closeSession(session);
          throw new Error("Redirect left the approved origin");
        }
        output = {
          url: page.url(),
          title: await page.title(),
          status: result?.status() ?? null,
          snapshot: (await page.locator("body").ariaSnapshot()).slice(0, 40000),
        };
      } else if (input.action === "snapshot") {
        output = {
          url: page.url(),
          title: await page.title(),
          snapshot: (await page.locator("body").ariaSnapshot()).slice(0, 40000),
        };
      } else if (input.action === "screenshot") {
        output = {
          url: page.url(),
          screenshot: `data:image/jpeg;base64,${(await page.screenshot({ type: "jpeg", quality: 65, timeout: 10000 })).toString("base64")}`,
        };
      } else if (input.action === "viewport") {
        const mobile = input.viewport === "mobile";
        if (!mobile && input.viewport !== "desktop") throw new Error("Unknown viewport");
        await page.setViewportSize(
          mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 },
        );
        output = { viewport: input.viewport };
      } else if (input.action === "diagnostics") {
        const dom = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          brokenImages: [...document.images]
            .filter((image) => image.complete && image.naturalWidth === 0)
            .slice(0, 50)
            .map((image) => image.src),
          links: [...document.querySelectorAll("a[href]")]
            .slice(0, 100)
            .map((link) => ({ text: link.textContent?.trim().slice(0, 100), href: link.href })),
          unnamedButtons: [...document.querySelectorAll("button")].filter(
            (button) =>
              !button.textContent?.trim() &&
              !button.getAttribute("aria-label") &&
              !button.getAttribute("aria-labelledby") &&
              !button.getAttribute("title"),
          ).length,
        }));
        const evidence = { url: page.url(), viewport: page.viewportSize() };
        const finding = (id, severity, summary, expected, observed) => ({
          id,
          severity,
          summary,
          expected,
          observed,
          evidence,
          reproduction: [
            `Open ${page.url()}`,
            `Use viewport ${page.viewportSize()?.width}x${page.viewportSize()?.height}`,
            "Run Browser QA diagnostics",
          ],
          sourceFixVerified: false,
        });
        const findings = [
          ...(dom.overflow
            ? [
                finding(
                  "horizontal-overflow",
                  "medium",
                  "Horizontal page overflow",
                  "Page fits the selected viewport",
                  "Document scroll width exceeds the viewport",
                ),
              ]
            : []),
          ...dom.brokenImages.map((url, index) =>
            finding(
              `broken-image-${index}`,
              "medium",
              "Image did not load",
              "Image decodes successfully",
              url,
            ),
          ),
          ...session.errors.map((message, index) =>
            finding(
              `page-error-${index}`,
              "high",
              "Browser reported an error",
              "Page runs without console or runtime errors",
              message,
            ),
          ),
          ...session.failures.map((failure, index) =>
            finding(
              `network-${index}`,
              /BLOCKED|DENIED/i.test(failure.error) ? "info" : "medium",
              "Network observation",
              "Permitted page resources load successfully",
              `${failure.error}: ${failure.url}`,
            ),
          ),
        ];
        output = {
          url: page.url(),
          title: await page.title(),
          ...dom,
          findings,
          errors: [...session.errors],
          failures: [...session.failures],
          note: "Heuristic observations, not a complete accessibility audit. Blocked cross-origin resources reflect runner policy.",
        };
      } else if (input.action === "tabs") {
        if (Number.isInteger(input.tab)) {
          if (!session.pages[input.tab] || session.pages[input.tab].isClosed())
            throw new Error("Unknown tab");
          session.current = input.tab;
        }
        output = {
          current: session.current,
          tabs: await Promise.all(
            session.pages.map(async (tab, index) => ({
              index,
              closed: tab.isClosed(),
              url: tab.url(),
              title: tab.isClosed() ? "" : await tab.title(),
            })),
          ),
        };
      } else throw new Error("Unsupported read-only browser action");
      json(response, 200, {
        output,
        receipt: { ...receipt, ok: true, endedAt: new Date().toISOString() },
      });
    } catch (error) {
      json(response, sessions.has(session.id) ? 400 : 410, {
        error: String(error.message).slice(0, 1000),
        receipt: { ...receipt, ok: false, endedAt: new Date().toISOString() },
      });
    } finally {
      session.busy = false;
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    endpoint: `http://127.0.0.1:${server.address().port}/v1/browser`,
    pairingToken,
    close: async () => {
      await Promise.all([...sessions.values()].map(closeSession));
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      await egress.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const option = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
  const target = option("--target"),
    appOrigin = option("--app-origin");
  if (!target || !appOrigin)
    throw new Error(
      "Usage: node tooling/browser-runner.mjs --target https://your-site.example --app-origin http://localhost:8080 [--allow-local-target]",
    );
  const runner = await startBrowserRunner({
    target,
    appOrigin,
    allowLocalTarget: process.argv.includes("--allow-local-target"),
  });
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/browser-runner.local.json",
    JSON.stringify({ endpoint: runner.endpoint, pairingToken: runner.pairingToken }),
    { mode: 0o600 },
  );
  process.stdout.write(
    `Local browser companion: ${runner.endpoint}\nPairing details saved to ignored artifacts/browser-runner.local.json; do not share them.\n`,
  );
  const stop = async () => {
    await runner.close();
    process.exit();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
