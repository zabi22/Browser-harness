export interface WasmProcess {
  id: string;
  name: string;
  owner: string;
  state: "running" | "exited" | "stopped" | "failed";
  output: string;
  exit?: number;
  worker?: Worker | undefined;
}
const processes = new Map<string, WasmProcess>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
export const subscribeProcesses = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};
export const listProcesses = (owner?:string) => [...processes.values()].filter(p=>!owner||p.owner===owner).map(({ worker, ...p }) => p);
export function startProcess(
  name: string,
  bytes: Uint8Array,
  args: string[] = [],
  stdin = "",
  timeout = 120,
  owner = '',
) {
  if (bytes.length > 16000000) throw new Error("WASM binary exceeds 16 MB");
  if ([...processes.values()].filter((p) => p.state === "running").length >= 4)
    throw new Error("At most four WASM processes may run");
  const id = crypto.randomUUID(),
    worker = new Worker(new URL("./wasm-worker.ts", import.meta.url), { type: "module" });
  const p: WasmProcess = { id, name, owner, state: "running", output: "", worker };
  processes.set(id, p);
  const timer = setTimeout(() => stopProcess(id), Math.min(1800, Math.max(10, timeout)) * 1000);
  worker.onmessage = ({ data: d }) => {
    if (d.type === "output") p.output = (p.output + d.text + "\n").slice(-50000);
    else {
      clearTimeout(timer);
      p.state = d.type === "exit" ? "exited" : "failed";
      p.exit = d.exit;
      if (d.error) p.output += d.error;
      worker.terminate();
      p.worker = undefined;
    }
    notify();
  };
  worker.onerror = () => {
    clearTimeout(timer);
    p.state = "failed";
    worker.terminate();
    notify();
  };
  worker.postMessage({ bytes, args: [name, ...args], stdin });
  notify();
  return id;
}
export function stopProcess(id: string) {
  const p = processes.get(id);
  if (!p) throw new Error("No such process");
  p.worker?.terminate();
  p.worker = undefined;
  if (p.state === "running") p.state = "stopped";
  notify();
  return "Process stopped";
}
export function controlProcess(id: string, action: string, owner?:string) {
  if(owner&&processes.get(id)?.owner!==owner)throw new Error('Process belongs to another session');
  if (action === "stop") return stopProcess(id);
  if (action === "pause" || action === "resume")
    return "Pause/resume is not supported by synchronous WASI programs; stop and restart instead.";
  throw new Error("stdin is supplied at startup; live input is not supported by this WASI runtime");
}
export function stopSessionProcesses(owner:string){for(const p of processes.values())if(p.owner===owner&&p.state==='running')stopProcess(p.id);}
