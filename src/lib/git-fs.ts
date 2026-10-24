// Small repository filesystem shared by browser Git and read-only Worker upload-pack.
import { Buffer } from "buffer";
if (typeof globalThis.Buffer === "undefined")
  globalThis.Buffer = Buffer as typeof globalThis.Buffer;
export type RepoData = Record<string, string>;
export function bytesTo64(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
}
export function from64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
export function repoFs(data: RepoData) {
  const dirs = new Set<string>(["/"]);
  const path = (p: string) => {
    const a: string[] = [];
    for (const s of p.split("/")) {
      if (s === "..") a.pop();
      else if (s && s !== ".") a.push(s);
    }
    return "/" + a.join("/");
  };
  const parents = (p: string) => {
    let cur = path(p);
    while (cur !== "/") {
      cur = cur.slice(0, cur.lastIndexOf("/")) || "/";
      dirs.add(cur);
    }
  };
  Object.keys(data).forEach(parents);
  const fail = (code: string, p: string) => Object.assign(new Error(`${code}: ${p}`), { code });
  const stat = async (p: string) => {
    p = path(p);
    const isDir = dirs.has(p);
    if (!isDir && !(p in data)) throw fail("ENOENT", p);
    return {
      isFile: () => !isDir,
      isDirectory: () => isDir,
      isSymbolicLink: () => false,
      size: isDir ? 0 : from64(data[p] ?? "").length,
      mode: isDir ? 16877 : 33188,
      mtimeMs: 0,
      ctimeMs: 0,
      uid: 0,
      gid: 0,
    };
  };
  const fs = {
    readFile: async (p: string, opts?: any) => {
      p = path(p);
      if (!(p in data)) throw fail("ENOENT", p);
      const b = from64(data[p] ?? "");
      return (typeof opts === "string" ? opts : opts?.encoding) ? new TextDecoder().decode(b) : b;
    },
    writeFile: async (p: string, b: any) => {
      p = path(p);
      parents(p);
      data[p] = bytesTo64(typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b));
    },
    unlink: async (p: string) => {
      p = path(p);
      if (!(p in data)) throw fail("ENOENT", p);
      delete data[p];
    },
    mkdir: async (p: string) => {
      p = path(p);
      parents(p);
      dirs.add(p);
    },
    rmdir: async (p: string) => {
      dirs.delete(path(p));
    },
    readdir: async (p: string) => {
      p = path(p);
      if (!dirs.has(p)) throw fail("ENOENT", p);
      const prefix = p === "/" ? "/" : p + "/";
      return [
        ...new Set(
          [...Object.keys(data), ...dirs]
            .filter((k) => k.startsWith(prefix) && k !== p)
            .map((k) => k.slice(prefix.length).split("/")[0])
            .filter(Boolean),
        ),
      ];
    },
    stat,
    lstat: stat,
    readlink: async (p: string) => {
      throw fail("EINVAL", p);
    },
    symlink: async () => {
      throw new Error("Symlinks unsupported in repository editor");
    },
    chmod: async () => {},
  };
  return { promises: fs };
}
