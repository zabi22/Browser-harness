import { createFileRoute } from "@tanstack/react-router";
import { verifySession, jsonErr } from "@/lib/session.server";
export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await verifySession(request))) return jsonErr(401, "Not signed in");
        const key = process.env["BRAVE_SEARCH_API_KEY"];
        if (!key)
          return jsonErr(
            503,
            "Add a Brave Search API key to enable API search. SearXNG remains available.",
          );
        let q = "";
        try {
          const b = await request.json();
          q = String(b.query ?? "").trim();
        } catch {
          return jsonErr(400, "Invalid query");
        }
        if (!q || q.length > 2000) return jsonErr(400, "Query must be 1–2000 characters");
        const url = new URL("https://api.search.brave.com/res/v1/web/search");
        url.searchParams.set("q", q);
        url.searchParams.set("count", "5");
        const r = await fetch(url, {
          headers: { Accept: "application/json", "X-Subscription-Token": key },
          signal: AbortSignal.timeout(20000),
        });
        if (!r.ok) return jsonErr(502, `Search provider returned ${r.status}`);
        const j = (await r.json()) as {
          web?: { results?: { title: string; url: string; description: string }[] };
        };
        return Response.json({
          results: (j.web?.results ?? []).map((x) => ({
            title: x.title,
            url: x.url,
            content: x.description,
          })),
        });
      },
    },
  },
});
