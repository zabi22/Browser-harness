// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifySession } from "./session.server";
import { liveness, readiness } from "./health.server";
vi.mock("./session.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session.server")>()),
  verifySession: vi.fn(),
}));
beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://database.example.com");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-public");
  vi.stubEnv("PROVIDER_KEY_SECRET", "test-only-strong-encryption-secret-at-least-32");
  vi.stubEnv("PROVIDER_KEY_PREVIOUS_SECRETS", "{}");
  vi.stubEnv("PROVIDER_KEY_ID", "test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("operational checks", () => {
  it("liveness is public and does not call external services", async () => {
    const response = liveness();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(verifySession).not.toHaveBeenCalled();
  });
  it("readiness requires a verified session", async () => {
    vi.mocked(verifySession).mockResolvedValue(null);
    expect((await readiness(new Request("https://app.example.com"))).status).toBe(401);
  });
  it("reports configuration scope honestly and never serializes configuration values", async () => {
    vi.mocked(verifySession).mockResolvedValue("user-a");
    const response = await readiness(new Request("https://app.example.com"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "configured",
      scope: "configuration-only",
      liveIntegrationsVerified: false,
    });
    vi.stubEnv("PROVIDER_KEY_SECRET", "");
    expect((await readiness(new Request("https://app.example.com"))).status).toBe(503);
  });
});
