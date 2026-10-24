import { createFileRoute } from "@tanstack/react-router";
import { gitResponse } from "@/lib/git-http.server";
export const Route = createFileRoute("/api/public/git/$repoId/info/refs")({
  server: {
    handlers: {
      GET: async ({ request, params }) =>
        new URL(request.url).searchParams.get("service") === "git-upload-pack"
          ? gitResponse(request, params.repoId, "refs")
          : new Response("Unsupported service", { status: 400 }),
    },
  },
});
