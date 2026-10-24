import { createFileRoute } from "@tanstack/react-router";
import { gitResponse } from "@/lib/git-http.server";
export const Route = createFileRoute("/api/public/git/$repoId/git-upload-pack")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (Number(request.headers.get("content-length") ?? 0) > 1000000)
          return new Response("Request too large", { status: 413 });
        return gitResponse(request, params.repoId, "pack");
      },
    },
  },
});
