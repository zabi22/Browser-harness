import { createFileRoute } from "@tanstack/react-router";
import { liveness } from "@/lib/health.server";
export const Route = createFileRoute("/api/health")({ server: { handlers: { GET: liveness } } });
