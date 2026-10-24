import { createFileRoute } from "@tanstack/react-router";
import { jsonErr, verifySession } from "@/lib/session.server";
import { fetchPublic, publicUrl, readBounded, OutboundError } from "@/lib/public-fetch.server";

// Internal "fetch a web page" tool for the studio. Owner-only; public http(s) addresses only.
const MAX_BYTES = 3_000_000;
const MAX_CHARS = 40_000;

export function htmlToText(html: string) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const text = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return { title, text };
}

export const Route = createFileRoute("/api/fetch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await verifySession(request))) return jsonErr(401, "Not signed in");
        let url: URL;
        let asImage = false;
        try {
          const b = (await request.json()) as { url?: string; as?: string };
          asImage = b.as === "image";
          url = new URL(String(b.url ?? ""));
        } catch {
          return jsonErr(400, "Invalid URL");
        }
        try {
          publicUrl(url);
        } catch {
          return jsonErr(400, "Only public HTTP(S) addresses are allowed");
        }
        let r: Response;
        try {
          r = await fetchPublic(url, AbortSignal.any([request.signal, AbortSignal.timeout(30000)]));
        } catch (e) {
          if (e instanceof OutboundError) return jsonErr(400, e.message);
          return jsonErr(502, `Could not reach ${url.hostname}`);
        }
        const type = r.headers.get("content-type") ?? "";
        if (asImage) {
          if (!r.ok) return jsonErr(502, `The image link returned HTTP ${r.status}`);
          if (!/^image\/(png|jpe?g|gif|webp|bmp)/i.test(type))
            return jsonErr(400, `That link is not an image (${type || "unknown type"})`);
          let bytes: Uint8Array;
          try {
            bytes = await readBounded(r, 15_000_000);
          } catch {
            return jsonErr(413, "Image exceeds 15 MB or could not be read");
          }
          let bin = "";
          for (let i = 0; i < bytes.length; i += 0x8000)
            bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return Response.json({
            url: r.url,
            dataUrl: `data:${type.split(";")[0]};base64,${btoa(bin)}`,
          });
        }
        if (!/text|json|xml|javascript/i.test(type) && type) {
          await r.body?.cancel();
          return Response.json({
            status: r.status,
            url: r.url,
            contentType: type,
            text: `(Binary content of type ${type} was not read.)`,
          });
        }
        let buf: Uint8Array;
        try {
          buf = await readBounded(r, MAX_BYTES);
        } catch {
          return jsonErr(413, "Page exceeds 3 MB or could not be read");
        }
        let raw = new TextDecoder().decode(buf);
        let title = "";
        if (/html/i.test(type) || /^\s*<(!doctype|html)/i.test(raw))
          ({ title, text: raw } = htmlToText(raw));
        const truncated = raw.length > MAX_CHARS;
        return Response.json({
          status: r.status,
          url: r.url,
          title,
          contentType: type,
          text: raw.slice(0, MAX_CHARS) + (truncated ? "\n…(truncated)" : ""),
        });
      },
    },
  },
});
