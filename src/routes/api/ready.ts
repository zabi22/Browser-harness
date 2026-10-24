import { createFileRoute } from "@tanstack/react-router";
import { readiness } from "@/lib/health.server";
export const Route = createFileRoute("/api/ready")({
  server: { handlers: { GET: ({ request }) => readiness(request) } },
});
