import { it, expect } from "vitest";
import { chooseDisk, sha256 } from "./disk-codec";
it("matching revision reuses cache", () =>
  expect(chooseDisk({ revision: "r", dirty: false }, "r")).toBe("local"));
it("new cloud revision downloads", () =>
  expect(chooseDisk({ revision: "r", dirty: false }, "new")).toBe("cloud"));
it("never overwrite divergent unsynced disk", () =>
  expect(chooseDisk({ revision: "r", dirty: true }, "new")).toBe("conflict"));
it("missing cache downloads", () => expect(chooseDisk(undefined, "r")).toBe("cloud"));
it("sha256 content address is deterministic", async () =>
  expect(await sha256(new TextEncoder().encode("abc"))).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  ));
