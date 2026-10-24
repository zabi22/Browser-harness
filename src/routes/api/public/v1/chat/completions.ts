import { createFileRoute } from "@tanstack/react-router";
import {
  CORS_HEADERS,
  FALLBACK_MODEL,
  PRIMARY_MODEL,
  buildBody,
  callUpstream,
  extractApiKey,
  jsonError,
  sha256Hex,
  shouldFallback,
} from "@/lib/gateway.server";

export const Route = createFileRoute("/api/public/v1/chat/completions")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        // 1. Authenticate against api_keys
        const key = extractApiKey(request);
        if (!key) return jsonError(401, "Missing API key", "authentication_error");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const hash = await sha256Hex(key);
        const { data: row, error } = await supabaseAdmin
          .from("api_keys")
          .select("id, is_active")
          .eq("key_hash", hash)
          .maybeSingle();
        if (error) return jsonError(500, "Key lookup failed");
        if (!row || !row.is_active) return jsonError(401, "Invalid API key", "authentication_error");
        void supabaseAdmin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);

        // 2. Parse body
        let input: Record<string, unknown>;
        try {
          input = await request.json();
        } catch {
          return jsonError(400, "Body must be JSON", "invalid_request_error");
        }
        if (!Array.isArray(input?.["messages"]) || input["messages"].length === 0) {
          return jsonError(400, "`messages` must be a non-empty array", "invalid_request_error");
        }

        const lovableKey = process.env["LOVABLE_API_KEY"];
        if (!lovableKey) return jsonError(500, "AI gateway is not configured");

        // 3. Primary call, with fallback on transient failures
        let upstream: Response | null = null;
        let model = PRIMARY_MODEL;
        try {
          upstream = await callUpstream(buildBody(input, PRIMARY_MODEL), lovableKey, request.signal);
        } catch (e) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          console.error("primary call failed", e);
        }
        if (shouldFallback(upstream?.status ?? null)) {
          console.warn(`primary ${PRIMARY_MODEL} failed (${upstream?.status ?? "network"}), falling back`);
          model = FALLBACK_MODEL;
          try {
            upstream = await callUpstream(buildBody(input, FALLBACK_MODEL), lovableKey, request.signal);
          } catch (e) {
            if (request.signal.aborted) return new Response(null, { status: 499 });
            return jsonError(502, "Upstream unavailable");
          }
        }
        if (!upstream) return jsonError(502, "Upstream unavailable");

        // 4. Pass through (JSON or SSE) preserving status
        const headers = new Headers(CORS_HEADERS);
        headers.set("Content-Type", upstream.headers.get("content-type") ?? "application/json");
        headers.set("X-Gateway-Model", model);
        upstream.headers.forEach((v, k) => {
          if (k.toLowerCase().startsWith("x-lovable-aig-")) headers.set(k, v);
        });
        if (input["stream"] === true) {
          headers.set("Cache-Control", "no-cache, no-transform");
          headers.set("Connection", "keep-alive");
        }
        return new Response(upstream.body, { status: upstream.status, headers });
      },
    },
  },
});
