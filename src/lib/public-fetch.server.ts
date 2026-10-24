import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

export class OutboundError extends Error {}
/** Fail closed for IPv6 except global unicast; mapped IPv4/private/reserved ranges are denied. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) !== 6) return false;
  const h = address.toLowerCase();
  const second = parseInt(h.split(":")[1] || "0", 16);
  return (
    /^[23][0-9a-f]{0,3}:/.test(h) &&
    !h.startsWith("2001:db8:") &&
    !(h.startsWith("2001:") && second < 0x200) &&
    !h.startsWith("2002:") &&
    !h.startsWith("3fff:")
  );
}
export function publicUrl(value: string | URL) {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port)) ||
    (!hostname.includes(".") && !isIP(hostname)) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(hostname) ||
    (isIP(hostname) && !isPublicAddress(hostname))
  )
    throw new OutboundError("Only public HTTP(S) addresses on standard ports are allowed");
  return url;
}
export async function publicAddress(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new OutboundError("Private or reserved network destination blocked");
  return addresses[0]!;
}
/** DNS answers are validated, then the socket uses that exact IP. TLS still verifies the original host. */
export async function pinnedFetch(
  value: string | URL,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  } = {},
) {
  const url = publicUrl(value);
  const address = await publicAddress(url.hostname);
  init.signal?.throwIfAborted();
  return new Promise<Response>((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        signal: init.signal,
        agent: false,
        family: address.family,
        lookup: (_host, _options, callback) => callback(null, address.address, address.family),
      },
      (incoming) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        // node:http returns encoded bytes, unlike fetch; never treat them as decoded content.
        if (headers.get("content-encoding") && headers.get("content-encoding") !== "identity") {
          incoming.destroy();
          reject(new OutboundError("Encoded upstream responses are unsupported"));
          return;
        }
        const status = incoming.statusCode ?? 502;
        if (status < 200 || status > 599) {
          incoming.destroy();
          reject(new OutboundError("Invalid upstream response status"));
          return;
        }
        const stream = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
        const response = new Response([204, 205, 304].includes(status) ? null : stream, {
          status,
          headers,
        });
        if ([204, 205, 304].includes(status)) incoming.resume();
        Object.defineProperty(response, "url", { value: url.href });
        resolve(response);
      },
    );
    req.setTimeout(30000, () => req.destroy(new Error("Upstream timed out")));
    req.on("error", reject);
    req.end(init.body);
  });
}
/** Validate every redirect BEFORE contacting it. This tool carries no app cookies or credentials. */
export async function fetchPublic(value: string | URL, signal: AbortSignal): Promise<Response> {
  let url = publicUrl(value);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const response = await pinnedFetch(url, {
      headers: {
        Accept: "text/html,application/json,text/plain,image/*",
        "Accept-Encoding": "identity",
        "User-Agent": "OBH/1.0",
      },
      signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location) throw new OutboundError("Redirect has no destination");
    url = publicUrl(new URL(location, url));
  }
  throw new OutboundError("Too many redirects");
}
export async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const advertised = Number(response.headers.get("content-length"));
  if (advertised > maxBytes) {
    await response.body?.cancel();
    throw new OutboundError("Response exceeds the size limit");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new OutboundError("Response exceeds the size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
