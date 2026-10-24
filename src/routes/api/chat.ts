import { createFileRoute } from "@tanstack/react-router";
import { getModel } from "@/lib/models";
import { buildRequest, err, makeExtractor, type InBody } from "@/lib/chat-protocol.server";
import { verifySession } from "@/lib/session.server";
import { userUpstream } from "@/lib/provider-keys.server";
import { providerFetch } from "@/lib/provider-http.server";
import { chatRequestSchema } from "@/lib/chat-request";
import { readRequestJson, RequestBodyError } from "@/lib/request-body.server";
import { readSse } from "@/lib/sse";
import { streamTerminal } from "@/lib/stream-terminal";

// Internal (non-public) streaming proxy for the studio. Requires the owner's session token.

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await verifySession(request))) return err(401, "Not signed in");
        let body: InBody;
        try {
          const parsed = chatRequestSchema.safeParse(await readRequestJson(request, 16_000_000));
          if (!parsed.success)
            return err(
              400,
              "Invalid chat request: check messages, tool definitions and parameter limits",
            );
          body = parsed.data;
        } catch (error) {
          return err(
            error instanceof RequestBodyError ? error.status : 400,
            error instanceof RequestBodyError ? error.message : "Invalid request body",
          );
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
        const upstreamAbort = new AbortController();
        const callUpstream = (pl: unknown) =>
          providerFetch(up, path, {
            method: "POST",
            body: JSON.stringify(pl),
            signal: AbortSignal.any([
              request.signal,
              upstreamAbort.signal,
              AbortSignal.timeout(1800000),
            ]),
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
              let completed = false;
              for await (const data of readSse(b)) {
                if (data === "[DONE]") {
                  completed = true;
                  break;
                }
                let ev: unknown;
                try {
                  ev = JSON.parse(data);
                } catch {
                  return { error: "The provider returned a malformed stream event" };
                }
                completed ||= streamTerminal(model.provider, ev);
                for (const out of ex.step(ev)) {
                  if (out.d) send({ d: out.d });
                  if (out.r) send({ r: out.r });
                  if (out.tool) send({ tool: out.tool });
                  if (out.truncated) send({ truncated: true });
                  if (out.error) {
                    return { error: out.error, native: out.native, refusal: out.refusal };
                  }
                }
              }
              if (!completed)
                return {
                  error:
                    "The AI stream ended before completion. Your partial reply has been preserved.",
                };
              for (const out of ex.flush()) send(out);
              return {};
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
                console.error("[api/chat] upstream returned a terminal error");
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
              console.error("[api/chat] stream read failed");
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
            upstreamAbort.abort();
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
