import { describe, expect, it } from "vitest";
import { deepestLeaf, pathTo, siblingsOf } from "./tree";
import { decryptBackup, encryptBackup } from "./backup";

const msgs = [
  { id: "u1", parent_id: null, role: "user", created_at: "1" },
  { id: "a1", parent_id: "u1", role: "assistant", created_at: "2" },
  { id: "u2", parent_id: "a1", role: "user", created_at: "3" },
  { id: "u2b", parent_id: "a1", role: "user", created_at: "4" },
  { id: "a2b", parent_id: "u2b", role: "assistant", created_at: "5" },
];

describe("branching", () => {
  it("an edited prompt becomes a second branch of the same turn", () => {
    expect(siblingsOf(msgs[2]!, msgs).map((m) => m.id)).toEqual(["u2", "u2b"]);
  });
  it("switching to a branch shows that branch's reply", () => {
    expect(deepestLeaf("u2b", msgs)).toBe("a2b");
    expect(pathTo("a2b", msgs).map((m) => m.id)).toEqual(["u1", "a1", "u2b", "a2b"]);
  });
});

describe("backup", () => {
  it("restores with the right password and rejects a wrong one", async () => {
    const enc = await encryptBackup({ hello: "world" }, "secret");
    expect(await decryptBackup(enc, "secret")).toEqual({ hello: "world" });
    await expect(decryptBackup(enc, "nope")).rejects.toThrow();
  });
});
