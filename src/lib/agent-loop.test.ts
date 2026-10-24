import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("./studio-client", () => ({ streamChat: mock.stream }));
vi.mock("./tools", () => ({
  buildTools: async () => ({ defs: [], run: new Map(), labels: new Map() }),
}));
vi.mock("./linux-environment", () => ({ linuxFor: vi.fn() }));
vi.mock("./wasm-processes", () => ({ stopSessionProcesses: vi.fn() }));
import { runAgentLoop } from "./agent-loop";
import type { Settings } from "./studio-client";

const settings = {
  model: "anthropic/claude-opus-5-5",
  modelTimeout: 600,
  continueAtLimit: true,
} as Settings;
const run = (s = settings, signal = new AbortController().signal) =>
  runAgentLoop({
    settings: s,
    system: "",
    messages: [{ role: "user", content: "Solve" }],
    skills: [],
    onSkillsChanged: () => {},
    ctx: {},
    signal,
    onUpdate: () => {},
  });
beforeEach(() => {
  mock.stream.mockReset();
});
describe("output-limit continuation", () => {
  it("retains all reasoning and partial text when the model errors", async () => {
    const thinking = "x".repeat(45000);
    mock.stream.mockImplementationOnce(async (_body, d, _signal, reason) => {
      reason(thinking);
      d("Partial answer");
      reason("Later thinking");
      throw new Error("Connection failed");
    });
    const snapshots: { text: string; segments: { text?: string }[] }[] = [];
    await expect(
      runAgentLoop({
        settings,
        system: "",
        messages: [],
        skills: [],
        onSkillsChanged: () => {},
        ctx: {},
        signal: new AbortController().signal,
        onUpdate: (r) => snapshots.push(r),
      }),
    ).rejects.toThrow("Connection failed");
    expect(snapshots.at(-1)?.text).toBe("Partial answer");
    expect(snapshots.at(-1)?.segments.map((s) => s.text)).toEqual([thinking, "Later thinking"]);
    expect(mock.stream).toHaveBeenCalledTimes(1);
  });
  it("carries the reasoning and [Didn't reply] to a fresh request", async () => {
    mock.stream
      .mockImplementationOnce(async (_body, _d, _signal, reason, truncated) => {
        reason("Intermediate calculation");
        truncated();
        return [];
      })
      .mockImplementationOnce(async (_body, d) => {
        d("Answer");
        return [];
      });
    expect((await run()).text).toBe("Answer");
    const body = mock.stream.mock.calls[1]?.[0];
    expect(body.messages[1].content).toMatch(/^\[Didn't reply\]/);
    expect(body.messages[1].content).not.toContain("Intermediate calculation");
    expect(body.messages[2].content).not.toContain("Intermediate calculation");
    expect(mock.stream).toHaveBeenCalledTimes(2);
  });
  it("joins partial output without injecting the limit note into its input", async () => {
    mock.stream
      .mockImplementationOnce(async (_body, d, _signal, _r, truncated) => {
        d("Part one. ");
        truncated();
        return [];
      })
      .mockImplementationOnce(async (_body, d) => {
        d("Part two.");
        return [];
      });
    expect((await run()).text).toBe("Part one. Part two.");
    expect(mock.stream.mock.calls[1]?.[0].messages[1].content).toBe("Part one. ");
  });
  it("makes no follow-up when the toggle is off", async () => {
    mock.stream.mockImplementation(async (_body, _d, _signal, r, truncated) => {
      r("Thinking");
      truncated();
      return [];
    });
    expect((await run({ ...settings, continueAtLimit: false })).text).toContain("[Didn't reply]");
    expect(mock.stream).toHaveBeenCalledTimes(1);
  });
  it("stops after three continuations instead of billing forever", async () => {
    mock.stream.mockImplementation(async (_body, _d, _signal, _r, truncated) => {
      truncated();
      return [];
    });
    expect((await run()).text).toContain("automatic continuation stopped");
    expect(mock.stream).toHaveBeenCalledTimes(4);
  });
  it("respects a configured follow-up count", async () => {
    mock.stream.mockImplementation(async (_body, _d, _signal, _r, truncated) => {
      truncated();
      return [];
    });
    await run({ ...settings, maxContinuations: 5 });
    expect(mock.stream).toHaveBeenCalledTimes(6);
  });
  it("keeps continuing past the step limit when unlimited", async () => {
    let n = 0;
    mock.stream.mockImplementation(async (_body, d, _signal, _r, truncated) => {
      if (++n < 60) truncated();
      else d("Done");
      return [];
    });
    expect((await run({ ...settings, infiniteContinuations: true })).text).toBe("Done");
    expect(mock.stream).toHaveBeenCalledTimes(60);
  });
  it("never continues a provider denial", async () => {
    mock.stream.mockRejectedValue(new Error("Provider denied"));
    await expect(run()).rejects.toThrow("Provider denied");
    expect(mock.stream).toHaveBeenCalledTimes(1);
  });
  it("does not continue after Stop", async () => {
    const ctrl = new AbortController();
    mock.stream.mockImplementation(async (_body, _d, _signal, _r, truncated) => {
      truncated();
      ctrl.abort();
      return [];
    });
    await run(settings, ctrl.signal);
    expect(mock.stream).toHaveBeenCalledTimes(1);
  });
});
