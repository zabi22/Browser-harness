import { z } from "zod";
export interface BrowserScope {
  ownerId: string;
  workspaceId: string;
}
export const browserOperation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("navigate"), url: z.string().url().max(2000) }).strict(),
  z.object({ action: z.literal("new-tab"), url: z.string().url().max(2000) }).strict(),
  z.object({ action: z.literal("snapshot") }).strict(),
  z.object({ action: z.literal("screenshot") }).strict(),
  z.object({ action: z.literal("diagnostics") }).strict(),
  z.object({ action: z.literal("viewport"), viewport: z.enum(["mobile", "desktop"]) }).strict(),
  z.object({ action: z.literal("tabs"), tab: z.number().int().min(0).max(2).optional() }).strict(),
]);
export type BrowserOperation = z.infer<typeof browserOperation>;
const receiptSchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  ok: z.boolean(),
});
export type BrowserReceipt = z.infer<typeof receiptSchema> & {
  output?: Record<string, unknown>;
  error?: string;
};
const responseSchema = z.object({
  sessionId: z.string().uuid().optional(),
  origin: z.string().url().optional(),
  expiresAt: z.string().optional(),
  receipt: receiptSchema.optional(),
  output: z.record(z.unknown()).optional(),
  error: z.string().max(2000).optional(),
});
export interface BrowserBackend {
  start(signal?: AbortSignal): Promise<void>;
  run(operation: BrowserOperation, signal?: AbortSignal): Promise<Record<string, unknown>>;
  stop(): Promise<void>;
}
export function browserEndpoint(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.pathname !== "/v1/browser" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Use the local companion endpoint http://127.0.0.1:8931/v1/browser");
  return url.href;
}
export class LocalBrowserBackend implements BrowserBackend {
  readonly scope: BrowserScope;
  readonly endpoint: string;
  #credential: string;
  private sessionId: string | undefined;
  private abort = new AbortController();
  private listeners = new Set<() => void>();
  receipts: BrowserReceipt[] = [];
  state: "disconnected" | "connecting" | "ready" | "busy" | "error" = "disconnected";
  origin = "";
  get id() {
    return this.sessionId ?? null;
  }
  expiresAt = "";
  error = "";
  constructor(
    scope: BrowserScope,
    endpoint: string,
    credential: string,
    private transport: typeof fetch = (input, init) => globalThis.fetch(input, init),
  ) {
    this.scope = { ...scope };
    this.endpoint = browserEndpoint(endpoint);
    if (!/^[a-f0-9]{64}$/.test(credential))
      throw new Error("Enter the pairing token from the local runner file");
    this.#credential = credential;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private changed() {
    for (const listener of this.listeners) listener();
  }
  private async call(action: string, args: Record<string, unknown>, signal?: AbortSignal) {
    const response = await this.transport(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-openchat-pairing": this.#credential },
      credentials: "omit",
      redirect: "error",
      body: JSON.stringify({
        ...args,
        ...this.scope,
        action,
        ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      }),
      signal: AbortSignal.any([
        this.abort.signal,
        AbortSignal.timeout(30000),
        ...(signal ? [signal] : []),
      ]),
    });
    const result = responseSchema.parse((await response.json()) as unknown);
    if ([404, 410, 429].includes(response.status) && action !== "start") {
      this.state = "error";
      this.sessionId = undefined;
    }
    if (result.receipt) {
      if (result.receipt.action !== action)
        throw new Error("Browser receipt does not match the requested action");
      this.receipts = [
        ...this.receipts.slice(-99),
        {
          ...result.receipt,
          ...(result.output ? { output: result.output } : {}),
          ...(result.error ? { error: result.error } : {}),
        },
      ];
      this.changed();
    }
    if (!response.ok || result.error || !result.receipt?.ok)
      throw new Error(result.error || `Browser action failed (${response.status})`);
    return result;
  }
  async start(signal?: AbortSignal) {
    if (this.state !== "disconnected") throw new Error("Browser session already started");
    this.state = "connecting";
    this.changed();
    try {
      const result = await this.call("start", {}, signal);
      if (!result.sessionId || !result.origin || !result.expiresAt)
        throw new Error("Missing browser session metadata");
      this.sessionId = result.sessionId;
      this.origin = result.origin;
      this.expiresAt = result.expiresAt;
      this.state = "ready";
    } catch (error) {
      this.state = "error";
      this.error = (error as Error).message;
      throw error;
    } finally {
      this.changed();
    }
  }
  async run(input: BrowserOperation, signal?: AbortSignal) {
    const operation = browserOperation.parse(input);
    if (this.state !== "ready" || !this.sessionId)
      throw new Error("Start an available browser session first");
    if (Date.now() >= Date.parse(this.expiresAt)) {
      this.state = "error";
      this.error = "Session expired; reconnect to start fresh";
      this.changed();
      throw new Error(this.error);
    }
    if ("url" in operation && new URL(operation.url).origin !== this.origin)
      throw new Error("Navigation is limited to the runner-approved origin");
    this.state = "busy";
    this.changed();
    try {
      return (await this.call(operation.action, operation, signal)).output ?? {};
    } catch (error) {
      this.error = (error as Error).message;
      throw error;
    } finally {
      if (this.sessionId && !this.abort.signal.aborted) this.state = "ready";
      this.changed();
    }
  }
  async stop() {
    try {
      if (this.sessionId) await this.call("close", {});
    } finally {
      this.abort.abort();
      this.#credential = "";
      this.sessionId = undefined;
      this.state = "disconnected";
      this.changed();
    }
  }
}
const active = new Map<string, LocalBrowserBackend>();
const scopeKey = (scope: BrowserScope) => `${scope.ownerId}/${scope.workspaceId}`;
export function activeBrowser(scope: BrowserScope) {
  return active.get(scopeKey(scope));
}
export function registerBrowser(browser: LocalBrowserBackend) {
  active.set(scopeKey(browser.scope), browser);
}
export async function stopBrowsers(ownerId?: string) {
  for (const [key, browser] of active)
    if (!ownerId || browser.scope.ownerId === ownerId) {
      active.delete(key);
      await browser.stop().catch(() => {});
    }
}
