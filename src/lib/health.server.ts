import { encryptionConfigured } from "./provider-keys.server";
import { verifySession, jsonErr } from "./session.server";
export const liveness = () =>
  Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
export async function readiness(request: Request) {
  if (!(await verifySession(request))) return jsonErr(401, "Not signed in");
  const configured = Boolean(
    process.env["SUPABASE_URL"] &&
    process.env["SUPABASE_PUBLISHABLE_KEY"] &&
    encryptionConfigured(),
  );
  return Response.json(
    {
      status: configured ? "configured" : "not_ready",
      scope: "configuration-only",
      liveIntegrationsVerified: false,
    },
    {
      status: configured ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
