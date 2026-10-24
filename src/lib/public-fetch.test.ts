// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  isPublicAddress,
  publicUrl,
  publicAddress,
  pinnedFetch,
  fetchPublic,
  readBounded,
} from "./public-fetch.server";
const { lookupMock, requestMock } = vi.hoisted(() => ({
  lookupMock: vi.fn<() => Promise<{ address: string; family: number }[]>>(),
  requestMock: vi.fn<(...args: unknown[]) => object>(),
}));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("node:https", () => ({ request: requestMock }));
afterEach(() => vi.clearAllMocks());
describe("public outbound requests", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.1.1",
    "192.168.1.2",
    "100.64.1.1",
    "0.0.0.0",
    "224.0.0.1",
    "198.18.0.1",
    "192.0.2.1",
    "203.0.113.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "2001:0:1234::1",
  ])("blocks private and reserved %s", (address) => expect(isPublicAddress(address)).toBe(false));
  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "allows public %s",
    (address) => expect(isPublicAddress(address)).toBe(true),
  );
  it.each([
    "http://2130706433",
    "http://0x7f000001",
    "http://127.1",
    "http://[::ffff:127.0.0.1]",
    "https://localhost",
    "https://private.internal",
    "file:///etc/passwd",
    "https://u:p@example.com",
    "https://example.com:9999",
  ])("rejects unsafe URL %s", (url) => expect(() => publicUrl(url)).toThrow());
  it("rejects DNS with any non-public address", async () => {
    lookupMock.mockResolvedValue([
      { address: "1.1.1.1", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(publicAddress("attacker.example.com")).rejects.toThrow("blocked");
  });
  it("pins the socket to the checked address and blocks redirects before contact", async () => {
    lookupMock.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
    const end = vi.fn();
    requestMock.mockImplementation((...args: unknown[]) => {
      const options = args[1] as {
        lookup: (host: string, options: object, callback: (...result: unknown[]) => void) => void;
      };
      const callback = vi.fn();
      options.lookup("attacker.example.com", {}, callback);
      expect(callback).toHaveBeenCalledWith(null, "1.1.1.1", 4);
      const incoming = Object.assign(new PassThrough(), {
        statusCode: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      });
      queueMicrotask(() => {
        (args[2] as (value: unknown) => void)(incoming);
        incoming.end();
      });
      return Object.assign(new EventEmitter(), {
        setTimeout: vi.fn(),
        end,
        destroy: vi.fn(),
      });
    });
    await expect(
      fetchPublic("https://attacker.example.com", new AbortController().signal),
    ).rejects.toThrow("public");
    expect(requestMock).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
  });
  it("does not start a socket after cancellation during DNS resolution", async () => {
    lookupMock.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
    await expect(
      pinnedFetch("https://example.com", { signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(requestMock).not.toHaveBeenCalled();
  });
  it("bounds actual response bytes even without Content-Length", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(6));
        c.enqueue(new Uint8Array(6));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(readBounded(new Response(stream), 10)).rejects.toThrow("size limit");
    expect(cancelled).toBe(true);
    await expect(readBounded(new Response("safe"), 10)).resolves.toEqual(
      new TextEncoder().encode("safe"),
    );
  });
});
