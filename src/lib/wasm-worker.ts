/// <reference lib="webworker" />
import { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory } from "@bjorn3/browser_wasi_shim";
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async ({ data: d }) => {
  try {
    const module = await WebAssembly.compile(d.bytes);
    const imports = WebAssembly.Module.imports(module);
    if (imports.some((i) => i.module !== "wasi_snapshot_preview1"))
      throw new Error("Only WASI preview1 programs with no external host imports are supported");
    const out = (text: string) => scope.postMessage({ type: "output", text });
    const wasi = new WASI(
      d.args ?? ["program"],
      [],
      [
        new OpenFile(new File(new TextEncoder().encode(d.stdin ?? ""))),
        ConsoleStdout.lineBuffered(out),
        ConsoleStdout.lineBuffered(out),
        new PreopenDirectory("/tmp", new Map()),
      ],
    );
    const instance = await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: wasi.wasiImport,
    });
    const exports = instance.exports;
    if (!(exports["memory"] instanceof WebAssembly.Memory) || typeof exports["_start"] !== "function")
      throw new Error("WASI program must export memory and _start");
    const exit = wasi.start(instance as unknown as Parameters<typeof wasi.start>[0]);
    scope.postMessage({ type: "exit", exit });
  } catch (e) {
    scope.postMessage({ type: "error", error: (e as Error).message });
  }
};
