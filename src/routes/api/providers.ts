import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifySession, jsonErr } from "@/lib/session.server";
import { KEY_PROVIDERS } from "@/lib/providers";
import { userUpstream } from "@/lib/provider-keys.server";
import { providerFetch } from "@/lib/provider-http.server";
import { parseOpenRouterModels, parseCompatibleModels } from "@/lib/model-discovery";
import { readBounded } from "@/lib/public-fetch.server";
import { readRequestJson, RequestBodyError } from "@/lib/request-body.server";
export const Route = createFileRoute("/api/providers")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await verifySession(request))) return jsonErr(401, "Not signed in");
        let input: unknown;
        try {
          input = await readRequestJson(request, 4096);
        } catch (error) {
          return jsonErr(
            error instanceof RequestBodyError ? error.status : 400,
            "Invalid provider request body",
          );
        }
        const parsed = z
          .object({ provider: z.enum(KEY_PROVIDERS), action: z.enum(["test", "models"]) })
          .safeParse(input);
        if (!parsed.success) return jsonErr(400, "Invalid provider request");
        const { provider, action } = parsed.data;
        const up = await userUpstream(request, provider);
        if (typeof up === "string") return jsonErr(400, up);
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
        try {
          const target =
            provider === "google"
              ? {
                  base: "https://generativelanguage.googleapis.com/v1beta",
                  headers: { "x-goog-api-key": up.headers["Authorization"]!.slice(7) },
                }
              : up;
          const r = await providerFetch(target, "/models", { signal });
          if (!r.ok) {
            await r.body?.cancel();
            return jsonErr(
              r.status === 429 ? 429 : 400,
              `Provider returned HTTP ${r.status}. Check the key, account access and rate limits.`,
            );
          }
          const data: unknown = JSON.parse(
            new TextDecoder().decode(await readBounded(r, 8_000_000)),
          );
          if (action === "test")
            return Response.json(
              {
                ok: true,
                checked: "Authenticated model listing; inference and billing were not tested.",
              },
              { headers: { "Cache-Control": "no-store" } },
            );
          const models =
            up.base === "https://openrouter.ai/api/v1" &&
            (provider === "openrouter" || provider === "custom")
              ? parseOpenRouterModels(data, provider)
              : provider === "google"
                ? []
                : parseCompatibleModels(data, provider);
          return Response.json({ models }, { headers: { "Cache-Control": "no-store" } });
        } catch {
          return jsonErr(
            502,
            "Provider discovery failed or timed out. No inference request was made.",
          );
        }
      },
    },
  },
});
