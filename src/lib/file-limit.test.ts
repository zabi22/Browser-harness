import { describe, expect, it } from "vitest";
import { chunkText, fileTokenLimit } from "./context";

describe("file size limits", () => {
  it("allows a file up to half the model context", () => {
    expect(fileTokenLimit(400_000)).toBe(200_000);
    expect(fileTokenLimit(200_000)).toBe(100_000);
  });
  it("chunks text without losing characters", () => {
    const t = "a".repeat(2500);
    const parts = chunkText(t, 1000);
    expect(parts.map((p) => p.length)).toEqual([1000, 1000, 500]);
    expect(parts.join("")).toBe(t);
  });
});
