import { expect, it } from "vitest";
import { atConsoleBottom, cleanConsole, commandScriptPath } from "./linux-console";

it("places every command on the guest root share with a unique path", () => {
  expect(commandScriptPath("first")).toBe("/obh-command-first.sh");
  expect(commandScriptPath("second")).not.toBe(commandScriptPath("first"));
});
it("follows output only at the absolute bottom, allowing fractional scroll rounding", () => {
  expect(atConsoleBottom({ scrollHeight: 1000, clientHeight: 256, scrollTop: 744 })).toBe(true);
  expect(atConsoleBottom({ scrollHeight: 1000, clientHeight: 256, scrollTop: 742 })).toBe(false);
});
it("removes terminal control sequences and normalizes serial newlines", () => {
  expect(cleanConsole("\x1b[32mhello\x1b[0m\r\nworld\r\n")).toBe("hello\nworld\n");
});