import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey } from "./api-key-format";

describe("api key format", () => {
  it("starts with sk_lovable_", () => {
    expect(generateApiKey()).toMatch(/^sk_lovable_[0-9a-f]{64}$/);
  });
  it("hashes with SHA-256", async () => {
    expect(await hashApiKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
