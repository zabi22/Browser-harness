import { expect, it } from "vitest";
import { Buffer } from "buffer";
import git from "isomorphic-git";

it("Git hashing dependencies initialize with a working browser Buffer", async () => {
  expect(Buffer.from("abc").toString("hex")).toBe("616263");
  expect((await git.hashBlob({ object: Buffer.from("abc") })).oid).toBe(
    "f2ba8f84ab5c1bce84a7b441cb1959cfc7093b7f",
  );
});
