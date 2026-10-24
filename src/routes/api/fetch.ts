import { createFileRoute } from "@tanstack/react-router";
import { jsonErr, verifySession } from "@/lib/session.server";

// Internal "fetch a web page" tool for the studio. Owner-only; public http(s) addresses only.
const MAX_BYTES = 3_000_000;
const MAX_CHARS = 40_000;

function blockedHost(host: string) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^(0|10|127)\./.test(h) || /^169\.254\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;
  if (h.includes(":") && (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h === "::")) return true;
  return false;
}

export function htmlToText(html: string) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const text = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  return { title, text };
}

export const Route = createFileRoute("/api/fetch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await verifySession(request))) return jsonErr(401, "Not signed in");
        let url: URL;
        let asImage = false;
        try { const b = (await request.json()) as { url?: string; as?: string }; asImage = b.as === "image"; url = new URL(String(b.url ?? "")); } catch { return jsonErr(400, "Invalid URL"); }
        if (!/^https?:$/.test(url.protocol)) return jsonErr(400, "Only http and https addresses can be fetched");
        if (blockedHost(url.hostname)) return jsonErr(400, "Private network addresses can't be fetched from the server");
        let r: Response;
        try {
          r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "OBH/1.0 (+fetch tool)", Accept: "text/html,application/json,text/plain,*/*" }, signal: request.signal });
        } catch (e) {
          return jsonErr(502, `Could not reach ${url.hostname}`);
        }
        if (blockedHost(new URL(r.url || url.href).hostname)) return jsonErr(400, "Redirected to a private address");
        const type = r.headers.get("content-type") ?? "";
        if (asImage) {
          if (!r.ok) return jsonErr(502, `The image link returned HTTP ${r.status}`);
          if (!/^image\/(png|jpe?g|gif|webp|bmp)/i.test(type)) return jsonErr(400, `That link is not an image (${type || "unknown type"})`);
          const bytes = new Uint8Array(await r.arrayBuffer());
          if (bytes.length > 15_000_000) return jsonErr(400, "Image is larger than 15 MB");
          let bin = "";
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return Response.json({ url: r.url, dataUrl: `data:${type.split(";")[0]};base64,${btoa(bin)}` });
        }
        if (!/text|json|xml|javascript/i.test(type) && type) return Response.json({ status: r.status, url: r.url, contentType: type, text: `(Binary content of type ${type} was not read.)` });
        const buf = await r.arrayBuffer();
        let raw = new TextDecoder().decode(buf.slice(0, MAX_BYTES));
        let title = "";
        if (/html/i.test(type) || /^\s*<(!doctype|html)/i.test(raw)) ({ title, text: raw } = htmlToText(raw));
        const truncated = raw.length > MAX_CHARS;
        return Response.json({ status: r.status, url: r.url, title, contentType: type, text: raw.slice(0, MAX_CHARS) + (truncated ? "\n…(truncated)" : "") });
      },
    },
  },
});
