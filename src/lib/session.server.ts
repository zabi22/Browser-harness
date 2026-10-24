// Server-only helpers shared by the studio's internal API routes.
import { providerStatusMessage } from "./provider-errors.server";
export const GATEWAY = "https://ai.gateway.lovable.dev/v1";

export function jsonErr(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Verify the bearer session; returns the signed-in user's id or null. */
export async function verifySession(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: auth },
      redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
    });
    if (!r.ok) return null;
    const u = (await r.json().catch(() => null)) as { id?: string } | null;
    return typeof u?.id === "string" ? u.id : null;
  } catch {
    return null;
  }
}

export async function upstreamError(res: Response) {
  await res.body?.cancel();
  return jsonErr(res.ok ? 502 : res.status, providerStatusMessage(res.status));
}
