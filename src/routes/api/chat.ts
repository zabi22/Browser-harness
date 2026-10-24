import { createFileRoute } from "@tanstack/react-router";
import { getModel } from "@/lib/models";
import { buildRequest, err, makeExtractor, type InBody } from "@/lib/chat-protocol.server";
import { verifySession } from "@/lib/session.server";
import { userUpstream } from "@/lib/provider-keys.server";
import { providerFetch } from "@/lib/provider-http.server";

// Internal (non-public) streaming proxy for the studio. Requires the owner's session token.

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await verifySession(request))) return err(401, "Not signed in");
        let body: InBody;
        try {
          body = await request.json();
        } catch {
          return err(400, "Invalid JSON");
        }
        const model = getModel(body?.model);
        if (!model) return err(400, "Unknown model");
        if (model.provider === "ollama")
          return err(
            400,
            "Local Ollama requires an explicitly enabled browser connection; server-side localhost access is disabled.",
          );
        if (!Array.isArray(body.messages) || !body.messages.length) return err(400, "No messages");
        const up = await userUpstream(request, model.provider);
        if (typeof up === "string") return err(400, up);

        const { path, payload } = buildRequest(body, model);
        const callUpstream = (pl: unknown) =>
          providerFetch(up, path, {
            method: "POST",
            body: JSON.stringify(pl),
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(1800000)]),
          });
        let upstream: Response;
        try {
          upstream = await callUpstream(payload);
        } catch {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          return err(502, "AI service unreachable");
        }
        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text().catch(() => "");
          let message = `AI request failed (${upstream.status})`;
          try {
            const j = JSON.parse(text);
            message = j.error?.message ?? j.message ?? message;
          } catch {
            /* keep default */
          }
          return err(upstream.status, message);
        }

        const enc = new TextEncoder();
        const firstBody = upstream.body;
        let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
        const stream = new ReadableStream({
          async start(controller) {
            let sentAny = false;
            const send = (o: unknown) => {
              sentAny = true;
              controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
            };
            const ex = makeExtractor(model.provider);
            const pump = async (
              b: ReadableStream<Uint8Array>,
            ): Promise<{
              error?: string;
              native?: string | undefined;
              refusal?: boolean | undefined;
            }> => {
              const reader = b.getReader();
              activeReader = reader;
              const dec = new TextDecoder();
              let buf = "";
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  for (const o of ex.flush()) send({ tool: o.tool });
                  return {};
                }
                buf += dec.decode(value, { stream: true });
                const lines = buf.split("\n");
                buf = lines.pop() ?? "";
                for (const line of lines) {
                  const t = line.trim();
                  if (!t.startsWith("data:")) continue;
                  const data = t.slice(5).trim();
                  if (!data || data === "[DONE]") continue;
                  let ev: any;
                  try {
                    ev = JSON.parse(data);
                  } catch {
                    continue;
                  }
                  for (const out of ex.step(ev)) {
                    if (out.d) send({ d: out.d });
                    if (out.r) send({ r: out.r });
                    if (out.tool) send({ tool: out.tool });
                    if (out.truncated) send({ truncated: true });
                    if (out.error) {
                      reader.cancel().catch(() => {});
                      return { error: out.error, native: out.native, refusal: out.refusal };
                    }
                  }
                }
              }
            };
            // Keep intermediate proxies from idling out while the model thinks silently.
            const keepalive = setInterval(() => {
              try {
                controller.enqueue(enc.encode(": keepalive\n\n"));
              } catch {
                /* closed */
              }
            }, 15000);
            try {
              const res = await pump(firstBody);
              if (res.error) {
                console.error("[api/chat] upstream error:", res.native ?? "", res.error);
                send(res.refusal ? { error: res.error, refusal: true } : { error: res.error });
              } else if (!sentAny) {
                console.error("[api/chat] upstream stream produced no events");
                send({
                  error: "The model did not return a response. Try again, or rephrase the message.",
                });
              }
              controller.enqueue(enc.encode("data: [DONE]\n\n"));
              controller.close();
            } catch (e) {
              if (request.signal.aborted) {
                try {
                  controller.close();
                } catch {
                  /* closed */
                }
                return;
              }
              console.error("[api/chat] stream read failed:", e);
              try {
                send({ error: "Stream interrupted" });
                controller.close();
              } catch {
                /* closed */
              }
            } finally {
              clearInterval(keepalive);
            }
          },
          cancel() {
            activeReader?.cancel().catch(() => {});
          },
        });
        const headers = new Headers({
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
        });
        upstream.headers.forEach((v, k) => {
          if (k.toLowerCase().startsWith("x-lovable-aig-")) headers.set(k, v);
        });
        return new Response(stream, { headers });
      },
    },
  },
});
