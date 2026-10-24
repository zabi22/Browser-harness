/// <reference lib="webworker" />
import { openDB } from "idb";
import { sha256, type DiskManifest } from "./disk-codec";
import { cleanConsole, commandScriptPath } from "./linux-console";
import starterStateAsset from "../assets/starter-state.bin.asset.json";
const scope = self as unknown as DedicatedWorkerGlobalScope;
const BASE = "/vendor/linux/";
let vm: any,
  pending:
    | {
        id: number;
        marker: string;
        started: boolean;
        output: string;
        resolve: (s: string) => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
let log = "",
  ready = false;
let outputBuffer = "";
const db = openDB("obh-linux-base-v1", 1, {
  upgrade(d) {
    d.createObjectStore("assets");
  },
});
async function asset(url: string, version?: string): Promise<ArrayBuffer> {
  const d = await db;
  const path = new URL(url, scope.location.origin).pathname;
  const key = version ? path + "@" + version : path;
  const cached = await d.get("assets", key);
  if (cached) return cached;
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Linux asset unavailable: ${r.status}`);
  const b = await r.arrayBuffer();
  await d.put("assets", b, key);
  return b;
}
// v86's browser loader expects XHR. This adapter caches only pinned Linux assets, not guest network requests.
class CachedXHR {
  responseType = "";
  response: any;
  status = 0;
  readyState = 0;
  onload: any;
  onerror: any;
  onprogress: any;
  onreadystatechange: any;
  private url = "";
  private headers = new Headers();
  private aborted = false;
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers.set(k, v);
  }
  getResponseHeader() {
    return null;
  }
  abort() {
    this.aborted = true;
  }
  send() {
    void (async () => {
      try {
        const b = await asset(this.url);
        if (this.aborted) return;
        this.response = this.responseType === "json" ? JSON.parse(new TextDecoder().decode(b)) : b;
        this.status = 200;
        this.readyState = 4;
        this.onload?.({});
      } catch (e) {
        this.status = 500;
        this.onerror?.(e);
      }
    })();
  }
}
function emit(state: string, error?: string) {
  scope.postMessage({ type: "state", state, error });
}
async function boot(snapshot?: { manifest: DiskManifest; bytes: [string, Uint8Array][] }, warm?: boolean, memoryMib = 512) {
  emit("starting");
  ready = false;
  log = "";
  // v86 selects its non-window scheduler in dedicated workers.
  const scheduler=new MessageChannel();
  const ticks:(()=>void)[]=[];
  scheduler.port1.onmessage=()=>ticks.shift()?.();
  Object.defineProperty(globalThis, 'global', {value:{setImmediate:(fn:(...args:unknown[])=>void,...args:unknown[])=>{ticks.push(()=>fn(...args));scheduler.port2.postMessage(0);}},configurable:true});
  Object.defineProperty(globalThis, "XMLHttpRequest", { value: CachedXHR, configurable: true });
  const integrity = JSON.parse(new TextDecoder().decode(await asset(BASE + "integrity.json")));
  for (const name of ["libv86.mjs", "v86.wasm", "alpine-fs.json", "seabios.bin", "vgabios.bin"]) {
    if ((await sha256(new Uint8Array(await asset(BASE + name)))) !== integrity[name])
      throw new Error("Linux runtime integrity check failed");
  }
  // Preloaded "starter" RAM state: a fully booted Alpine, versioned by its integrity hash.
  let warmState: ArrayBuffer | undefined;
  // The starter RAM state was captured at 512 MiB; other sizes must cold-boot.
  if (warm && memoryMib === 512 && integrity["starter-state.bin"]) {
    try {
      const candidate = await asset(starterStateAsset.url, integrity["starter-state.bin"]);
      if ((await sha256(new Uint8Array(candidate))) === integrity["starter-state.bin"])
        warmState = candidate;
    } catch {
      warmState = undefined;
    }
  }
  const moduleUrl = URL.createObjectURL(
    new Blob([await asset(BASE + "libv86.mjs")], { type: "text/javascript" }),
  );
  const { V86 } = await import(/* @vite-ignore */ moduleUrl);
  URL.revokeObjectURL(moduleUrl);
  vm = new V86({
    wasm_path: BASE + "v86.wasm",
    memory_size: memoryMib * 1024 * 1024,
    vga_memory_size: 2 * 1024 * 1024,
    bios: { buffer: await asset(BASE + "seabios.bin") },
    vga_bios: { buffer: await asset(BASE + "vgabios.bin") },
    filesystem: {
      baseurl: BASE + "alpine-rootfs-flat",
      basefs: BASE + "alpine-fs.json",
    },
    bzimage_initrd_from_filesystem: true,
    cmdline:
      "rw root=host9p rootfstype=9p rootflags=trans=virtio,cache=loose modules=virtio_pci tsc=reliable console=ttyS0",
    autostart: false,
    disable_keyboard: true,
    disable_mouse: true,
    ...(warmState ? { initial_state: { buffer: warmState } } : {}),
  });
  outputBuffer='';
  setInterval(()=>{if(outputBuffer){scope.postMessage({type:'output',text:outputBuffer});outputBuffer='';}},100);
  const initMarker = "OBH_READY_" + crypto.randomUUID().replace(/-/g, "");
  let initializing = false;
  let serialLine = "";
  const flushLine = (line: string) => {
    const text = cleanConsole(line);
    if (!ready) {
      if (initializing && text.trim() === initMarker) {
        ready = true;
        log = "";
        emit("running");
        scope.postMessage({ type: "ready" });
      } else outputBuffer += text;
      return;
    }
    if (!pending) return;
    if (text.trim() === pending.marker + "_BEGIN") { pending.started = true; return; }
    const match = new RegExp("^" + pending.marker + ":(\\d+)$").exec(text.trim());
    if (match) {
      const p = pending;
      pending = undefined;
      clearTimeout(p.timer);
      const result = p.output.slice(-30000) + "\nexit " + match[1];
      outputBuffer += "exit " + match[1] + "\n";
      p.resolve(result);
    } else if (pending.started) {
      pending.output += text;
      outputBuffer += text;
    }
  };
  vm.add_listener("serial0-output-byte", (b: number) => {
    const ch = String.fromCharCode(b);
    log = (log + ch).slice(-100000);
    serialLine += ch;
    if (ch === "\n") { flushLine(serialLine); serialLine = ""; }
    if (!ready && !initializing && /localhost:.*#\s*$/.test(log)) {
      if (warmState) {
        // Warm boot: the restored shell is already at a prompt; declare ready directly.
        ready = true;
        log = "";
        emit("running");
        scope.postMessage({ type: "ready" });
        return;
      }
      initializing = true;
      vm.serial0_send("stty -echo; mkdir -p /workspace; cd /workspace\n");
      // Let echo disabling take effect before sending internal ready framing.
      setTimeout(() => vm.serial0_send(`printf '\\n${initMarker}\\n'\n`), 100);
    }
  });
  vm.add_listener("emulator-loaded", () => {
    if (warmState) {
      // initial_state restores memory, CPU and the 9p filesystem; nudge the shell so its prompt reprints.
      vm.run();
      setTimeout(() => vm.serial0_send("\n"), 500);
      return;
    }
    if(snapshot) vm.fs9p.set_state([snapshot.manifest.inodes,snapshot.manifest.qid,snapshot.bytes,snapshot.manifest.total,snapshot.manifest.used]);
    vm.run();
  });
}
async function exec(id: number, command: string, timeout: number) {
  if (!ready) throw new Error("Linux is not ready");
  if (pending) throw new Error("Linux is busy");
  const marker = "OBH_DONE_" + crypto.randomUUID().replace(/-/g, "");
  const path = commandScriptPath(marker);
  await vm.create_file(path, new TextEncoder().encode(command));
  log = "";
  scope.postMessage({ type: "output", text: "$ " + command + "\n" });
  return new Promise<string>((resolve, reject) => {
    pending = {
      id,
      marker,
      started: false,
      output: "",
      resolve,
      reject,
      timer: setTimeout(() => {
        vm.serial0_send("\x03");
        pending = undefined;
        reject(new Error("Linux command timed out"));
      }, timeout * 1000),
    };
    vm.serial0_send(`printf '\\n${marker}_BEGIN\\n'; sh '${path}' 2>&1; obh_status=$?; rm -f '${path}'; printf '\\n${marker}:%s\\n' "$obh_status"\n`);
  });
}
async function snapshot() {
  const fs = vm.fs9p,
    state = fs.get_state();
  const inodes = fs.inodes.map((i: any) => {
    const s = i.get_state();
    s[2] = [];
    return s;
  });
  const bytes: [string, Uint8Array][] = state[2];
  const chunks: [string, string][] = [];
  for (const [id, b] of bytes) chunks.push([id, await sha256(b)]);
  return {
    manifest: {
      version: "alpine-3.21-v86-0.5.471",
      inodes,
      qid: state[1],
      total: state[3],
      used: state[4],
      chunks,
    },
    bytes,
  };
}
scope.onmessage = async ({ data: d }) => {
  try {
    let result: any;
    switch (d.action) {
      case "boot":
        await boot(d.snapshot, d.warm, d.memory);
        return;
      case "exec":
        result = await exec(d.id, d.command, d.timeout ?? 120);
        break;
      case "snapshot":
        vm.stop();
        try {
          result = await snapshot();
        } finally {
          vm.run();
        }
        break;
      case "capture-state":
        vm.stop();
        try {
          result = await vm.save_state();
        } finally {
          vm.run();
        }
        break;
      case "write":
        await vm.create_file(d.path, d.bytes);
        result = true;
        break;
      case "read":
        result = await vm.read_file(d.path);
        break;
      case "pause":
        vm.stop();
        emit("paused");
        result = true;
        break;
      case "resume":
        vm.run();
        emit("running");
        result = true;
        break;
      case "cancel":
        vm.serial0_send("\x03");
        if (pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error("Cancelled"));
          pending = undefined;
        }
        result = true;
        break;
      case "stop":
        vm?.destroy();
        ready = false;
        emit("stopped");
        result = true;
        break;
      default:
        throw new Error("Unknown Linux action");
    }
    if (outputBuffer) { scope.postMessage({ type: "output", text: outputBuffer }); outputBuffer = ""; }
    scope.postMessage({ type: "result", id: d.id, result });
  } catch (e) {
    scope.postMessage({ type: "result", id: d.id, error: (e as Error).message });
    if (d.action === "boot") emit("failed", (e as Error).message);
  }
};
