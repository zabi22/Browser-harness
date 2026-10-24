// Browser-side MCP client: the user's browser talks to MCP servers directly, so private/LAN servers work.
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

export interface McpServer { id: string; name: string; url: string; headers: string; enabled: boolean }
export interface McpTool { name: string; description?: string; inputSchema?: Record<string, unknown> }

const cache = new Map<string, { key: string; client: Client; tools: McpTool[] }>();

export function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

async function open(s: McpServer): Promise<Client> {
  const [{ Client }, { StreamableHTTPClientTransport }, { SSEClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
    import("@modelcontextprotocol/sdk/client/sse.js"),
  ]);
  const headers = parseHeaders(s.headers);
  const url = new URL(s.url);
  try {
    const c = new Client({ name: "OBH", version: "1.0.0" });
    await c.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }) as never);
    return c;
  } catch (first) {
    // Older servers only speak the SSE transport.
    try {
      const c = new Client({ name: "OBH", version: "1.0.0" });
      await c.connect(new SSEClientTransport(url, { requestInit: { headers }, eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers as Record<string, string>), ...headers } }) } }) as never);
      return c;
    } catch {
      const msg = (first as Error).message || "connection failed";
      throw new Error(/fetch|network|cors/i.test(msg) ? `${s.name}: couldn't connect (is the server running, and does it allow this site via CORS?)` : `${s.name}: ${msg}`);
    }
  }
}

/** Connect (or reuse a connection) and list tools. */
export async function mcpTools(s: McpServer, refresh = false): Promise<McpTool[]> {
  const key = `${s.url}\n${s.headers}`;
  const hit = cache.get(s.id);
  if (hit && hit.key === key && !refresh) return hit.tools;
  if (hit) { cache.delete(s.id); hit.client.close().catch(() => {}); }
  const client = await open(s);
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools.map((t) => ({ name: t.name, ...(t.description ? { description: t.description } : {}), inputSchema: t.inputSchema as Record<string, unknown> })));
    cursor = page.nextCursor;
  } while (cursor && tools.length < 500);
  cache.set(s.id, { key, client, tools });
  return tools;
}

export async function mcpCall(s: McpServer, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  await mcpTools(s);
  const { client } = cache.get(s.id)!;
  const r = (await client.callTool({ name, arguments: args }, undefined, { ...(signal ? { signal } : {}), timeout: 120_000 })) as {
    content?: { type: string; text?: string; mimeType?: string; resource?: { text?: string; uri?: string } }[]; isError?: boolean; structuredContent?: unknown;
  };
  const parts = (r.content ?? []).map((c) =>
    c.type === "text" ? c.text ?? "" : c.type === "resource" ? c.resource?.text ?? `[resource ${c.resource?.uri ?? ""}]` : `[${c.type}${c.mimeType ? ` ${c.mimeType}` : ""} content]`);
  if (!parts.length && r.structuredContent) parts.push(JSON.stringify(r.structuredContent));
  const text = parts.join("\n").slice(0, 40_000) || "(no output)";
  return r.isError ? `Tool error: ${text}` : text;
}
