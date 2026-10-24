import { openDB } from "idb";
import { supabase } from "@/integrations/supabase/client";
import { chooseDisk, sha256, type DiskManifest } from "./disk-codec";
export type LinuxState =
  | "stopped"
  | "starting"
  | "running"
  | "checkpointing"
  | "paused"
  | "unsynced"
  | "conflict"
  | "failed";
type Snapshot = { manifest: DiskManifest; bytes: [string, Uint8Array][] };
type Cache = Snapshot & { revision: string | null; dirty: boolean };
const getDb = () =>
  openDB("obh-environments-v1", 1, {
    upgrade(d) {
      d.createObjectStore("disks");
    },
  });
const environments = new Map<string, LinuxEnvironment>();
export function linuxFor(ws: string) {
  let e = environments.get(ws);
  if (!e) {
    e = new LinuxEnvironment(ws);
    environments.set(ws, e);
  }
  return e;
}
export class LinuxEnvironment {
  state: LinuxState = "stopped";
  error = "";
  output = "";
  private worker: Worker | undefined;
  private seq = 0;
  private pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();
  private listeners = new Set<() => void>();
  private booting: Promise<void> | undefined;
  private revision: string | null = null;
  private user = "";
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  /** VM memory in MiB; read at boot, so changes apply on the next start. */
  memoryMib = 512;
  constructor(readonly workspace: string) {}
  setMemory(mib: number) {
    this.memoryMib = mib;
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private notify() {
    this.listeners.forEach((f) => f());
  }
  private set(s: LinuxState, error = "") {
    this.state = s;
    this.error = error;
    this.notify();
  }
  private rpc(action: string, data: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker?.postMessage({ id, action, ...data });
    });
  }
  async start(): Promise<void> {
    if (this.worker && this.state === "paused") {
      await this.resume();
      return;
    }
    if (this.state === "conflict")
      throw new Error(this.error || "Resolve the disk conflict before running commands");
    if (this.worker && ["running", "unsynced", "checkpointing"].includes(this.state)) return;
    if (this.booting) return this.booting;
    this.booting = this.boot();
    try {
      await this.booting;
    } finally {
      this.booting = undefined;
    }
  }
  private async boot() {
    this.set("starting");
    this.output = "";
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      this.user = u.user.id;
      const key = this.user + "/" + this.workspace;
      const local: Cache | undefined = await (await getDb()).get("disks", key);
      const { data: cloud, error } = await supabase
        .from("environment_manifests")
        .select("*")
        .eq("workspace_id", this.workspace)
        .maybeSingle();
      if (error) throw error;
      this.revision = cloud?.revision ?? null;
      const choice = chooseDisk(local, this.revision);
      if (choice === "conflict") {
        this.set(
          "conflict",
          "Unsynced local disk differs from cloud. Export the local disk before choosing a version.",
        );
        throw new Error(this.error);
      }
      let saved: Snapshot | undefined = choice === "local" ? local : undefined;
      if (choice === "cloud" && cloud) {
        const manifest = cloud.manifest as unknown as DiskManifest;
        if (manifest.version !== "alpine-3.21-v86-0.5.471")
          throw new Error("Saved disk uses a different Linux base");
        const bytes: [string, Uint8Array][] = [];
        for (const [id, hash] of manifest.chunks) {
          const { data: b, error: e } = await supabase.storage
            .from("environment-disks")
            .download(`${this.user}/${this.workspace}/${hash}`);
          if (e || !b) throw new Error("Saved disk chunk is missing");
          const raw = new Uint8Array(await b.arrayBuffer());
          if ((await sha256(raw)) !== hash) throw new Error("Saved disk integrity failed");
          bytes.push([id, raw]);
        }
        saved = { manifest, bytes };
        await (
          await getDb()
        ).put("disks", { ...saved, revision: this.revision, dirty: false }, key);
      }
      this.worker = new Worker(new URL("./linux-worker.ts", import.meta.url), { type: "module" });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Linux boot timed out after 4 minutes")),
          240000,
        );
        this.worker &&
          (this.worker.onmessage = ({ data: d }) => {
            if (d.type === "output") {
              this.output = (this.output + d.text).slice(-50000);
              this.notify();
            }
            if (d.type === "state") {
              this.set(d.state, d.error);
              if (d.state === "failed") {
                clearTimeout(timeout);
                reject(new Error(d.error));
              }
            }
            if (d.type === "ready") {
              clearTimeout(timeout);
              resolve();
            }
            if (d.type === "result") {
              const p = this.pending.get(d.id);
              this.pending.delete(d.id);
              if (d.error) p?.reject(new Error(d.error));
              else p?.resolve(d.result);
            }
          });
        this.worker?.addEventListener("error", () => {
          clearTimeout(timeout);
          reject(new Error("Linux worker failed"));
        });
        // Warm boot from the preloaded starter RAM state only when no saved disk
        // overlay exists; a saved disk must win so user changes are never lost.
        this.worker?.postMessage({
          action: "boot",
          snapshot: saved,
          warm: !saved,
          memory: this.memoryMib,
        });
      });
      this.timer = setInterval(() => {
        if (this.state === "running") void this.checkpoint(false).catch(() => {});
      }, 60000);
      void navigator.storage?.persist?.();
    } catch (e) {
      if (this.state !== "conflict") this.set("failed", (e as Error).message);
      this.worker?.terminate();
      this.worker = undefined;
      throw e;
    }
  }
  async exec(command: string, signal?: AbortSignal, timeout = 120) {
    await this.start();
    const task = async () => {
      if (signal?.aborted) throw new Error("Cancelled");
      const stop = () => void this.rpc("cancel");
      signal?.addEventListener("abort", stop, { once: true });
      try {
        return await this.rpc("exec", { command, timeout });
      } finally {
        signal?.removeEventListener("abort", stop);
      }
    };
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run as Promise<string>;
  }
  async write(path: string, bytes: Uint8Array) {
    await this.start();
    await this.rpc("write", { path, bytes });
  }
  async read(path: string): Promise<Uint8Array> {
    await this.start();
    return this.rpc("read", { path });
  }
  async checkpoint(cloud = true) {
    const task = () => this.saveCheckpoint(cloud);
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }
  private async saveCheckpoint(cloud: boolean) {
    if (!this.worker || !["running", "unsynced", "paused"].includes(this.state)) return;
    const paused = this.state === "paused";
    if (paused) await this.resume();
    this.set("checkpointing");
    try {
      await this.rpc("exec", { command: "sync", timeout: 30 });
      const snap: Snapshot = await this.rpc("snapshot");
      const key = this.user + "/" + this.workspace;
      await (await getDb()).put("disks", { ...snap, revision: this.revision, dirty: true }, key);
      if (!cloud) {
        this.set("running");
        if (paused) await this.pause();
        return;
      }
      const { data: current, error: ce } = await supabase
        .from("environment_manifests")
        .select("revision,manifest")
        .eq("workspace_id", this.workspace)
        .maybeSingle();
      if (ce) throw ce;
      if ((current?.revision ?? null) !== this.revision) {
        this.set("conflict", "Cloud disk changed in another tab. Local changes are preserved.");
        return;
      }
      const known = new Set(
        ((current?.manifest as unknown as DiskManifest)?.chunks ?? []).map((c) => c[1]),
      );
      const byId = new Map(snap.bytes);
      for (const [id, hash] of snap.manifest.chunks) {
        if (known.has(hash)) continue;
        const bytes = byId.get(id);
        if (!bytes) throw new Error("Missing local disk chunk");
        if (bytes.byteLength > 25000000)
          throw new Error("A disk file exceeds the 25 MB cloud chunk limit");
        const { error: e } = await supabase.storage
          .from("environment-disks")
          .upload(`${this.user}/${this.workspace}/${hash}`, new Blob([bytes.slice().buffer]), {
            upsert: true,
          });
        if (e) throw e;
      }
      const revision = crypto.randomUUID();
      const row = {
        workspace_id: this.workspace,
        user_id: this.user,
        revision,
        base_version: snap.manifest.version,
        manifest: snap.manifest as never,
        updated_at: new Date().toISOString(),
      };
      const result = this.revision
        ? await supabase
            .from("environment_manifests")
            .update(row)
            .eq("workspace_id", this.workspace)
            .eq("revision", this.revision)
            .select("revision")
            .maybeSingle()
        : await supabase.from("environment_manifests").insert(row).select("revision").single();
      if (result.error || !result.data) {
        const { data: latest, error: readError } = await supabase
          .from("environment_manifests")
          .select("revision")
          .eq("workspace_id", this.workspace)
          .maybeSingle();
        if (!readError && (latest?.revision ?? null) !== this.revision) {
          this.set("conflict", "Disk changed during save; local checkpoint preserved");
          return;
        }
        throw new Error(result.error?.message ?? "Disk save failed; local checkpoint preserved");
      }
      this.revision = revision;
      await (await getDb()).put("disks", { ...snap, revision, dirty: false }, key);
      this.set("running");
      if (paused) await this.pause();
    } catch (e) {
      this.set("unsynced", (e as Error).message);
      throw e;
    }
  }
  async restart() {
    if (this.state === "paused") await this.resume();
    await this.checkpoint();
    if (this.state === "conflict" || this.state === "unsynced")
      throw new Error("Save disk before restarting");
    this.stop();
    await this.start();
    return "Linux restarted from the saved disk. Continue the task.";
  }
  async captureState(): Promise<ArrayBuffer> {
    if (!this.worker || this.state !== "running")
      throw new Error("Linux must be running to capture its state");
    return this.rpc("capture-state");
  }
  async pause() {
    await this.rpc("pause");
    this.set("paused");
  }
  async resume() {
    await this.rpc("resume");
    this.set("running");
  }
  stop() {
    clearInterval(this.timer);
    this.worker?.terminate();
    this.worker = undefined;
    for (const p of this.pending.values()) p.reject(new Error("Environment stopped"));
    this.pending.clear();
    this.set("stopped");
  }
  async exportLocal() {
    const c = (await (await getDb()).get("disks", this.user + "/" + this.workspace)) as
      Cache | undefined;
    if (!c) return;
    const JSZip = (await import("jszip")).default,
      z = new JSZip();
    z.file("manifest.json", JSON.stringify(c.manifest));
    for (const [id, bytes] of c.bytes) z.file("chunks/" + id, bytes);
    return z.generateAsync({ type: "blob" });
  }
  async resolveConflict(useCloud: boolean) {
    this.stop();
    const key = this.user + "/" + this.workspace;
    const d = await getDb();
    if (useCloud) await d.delete("disks", key);
    else {
      const local = await d.get("disks", key);
      const { data } = await supabase
        .from("environment_manifests")
        .select("revision")
        .eq("workspace_id", this.workspace)
        .maybeSingle();
      if (local)
        await d.put("disks", { ...local, revision: data?.revision ?? null, dirty: true }, key);
    }
    await this.start();
  }
}
