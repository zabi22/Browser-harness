import { describe, expect, it } from "vitest";
import { providerStatusMessage, redactProviderError } from "./provider-errors.server";
describe("provider error privacy", () => {
  it("redacts bearer and native API credentials echoed by an upstream", () => {
    const key = ["dummy", "provider", "credential"].join("-");
    expect(
      redactProviderError(`Invalid credential ${key}`, {
        base: "https://api.example.com",
        headers: { Authorization: `Bearer ${key}` },
      }),
    ).not.toContain(key);
    expect(
      redactProviderError(`Invalid credential ${key}`, {
        base: "https://api.example.com",
        headers: { "x-api-key": key },
      }),
    ).not.toContain(key);
  });
  it("keeps denial and quota errors actionable without relaying raw upstream content", () => {
    expect(providerStatusMessage(401)).toContain("API key");
    expect(providerStatusMessage(403)).toContain("denied");
    expect(providerStatusMessage(429)).toContain("quota");
  });
});
