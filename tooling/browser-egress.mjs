// Local browser companion only. This proxy is never mounted in the production app.
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { publicAddress, publicUrl } from "../src/lib/public-fetch.server.ts";

export async function startBrowserEgress(target, { allowLocalTarget = false } = {}) {
  const origin = new URL(target);
  if (origin.username || origin.password || !["http:", "https:"].includes(origin.protocol))
    throw new Error("Invalid target origin");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (local && !allowLocalTarget)
    throw new Error("Local targets require explicit --allow-local-target");
  if (!local) publicUrl(origin);
  const sockets = new Set();
  let transferred = 0;
  const resolve = async () =>
    local
      ? {
          address: origin.hostname === "[::1]" ? "::1" : "127.0.0.1",
          family: origin.hostname === "[::1]" ? 6 : 4,
        }
      : publicAddress(origin.hostname);
  const account = (chunk, socket) => {
    transferred += chunk.length;
    if (transferred > 64_000_000) socket.destroy();
  };
  const proxy = createServer(async (incoming, response) => {
    let url;
    try {
      url = new URL(incoming.url);
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (
      url.origin !== origin.origin ||
      url.protocol !== "http:" ||
      !["GET", "HEAD"].includes(incoming.method)
    ) {
      response.writeHead(403).end("Browser egress denied");
      return;
    }
    try {
      const address = await resolve();
      const headers = { ...incoming.headers, host: url.host };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstream = request(
        url,
        {
          method: incoming.method,
          headers,
          agent: false,
          family: address.family,
          lookup: (_host, _options, callback) => callback(null, address.address, address.family),
        },
        (result) => {
          response.writeHead(result.statusCode ?? 502, result.headers);
          result.on("data", (chunk) => account(chunk, result));
          result.pipe(response);
        },
      );
      upstream.setTimeout(20000, () => upstream.destroy());
      upstream.on("error", () => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      incoming.on("aborted", () => upstream.destroy());
      upstream.end();
    } catch {
      response.writeHead(403).end("Browser destination denied");
    }
  });
  proxy.on("connect", async (incoming, socket, head) => {
    try {
      const destination = new URL(`https://${incoming.url}`);
      if (destination.origin !== origin.origin || origin.protocol !== "https:")
        throw new Error("Denied");
      const address = await resolve();
      const upstream = connect({ host: address.address, port: Number(origin.port) || 443 });
      upstream.setTimeout(20000, () => upstream.destroy());
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      socket.on("close", () => upstream.destroy());
      upstream.on("connect", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.on("data", (chunk) => account(chunk, socket));
        upstream.on("data", (chunk) => account(chunk, upstream));
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
    } catch {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  });
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${proxy.address().port}`,
    origin: origin.origin,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => proxy.close(resolve));
    },
  };
}
