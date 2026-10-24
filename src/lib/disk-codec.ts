export interface DiskManifest {
  version: string;
  inodes: unknown[][];
  qid: number;
  total: number;
  used: number;
  chunks: [string, string][];
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer)),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export function chooseDisk(
  local: { revision: string | null; dirty: boolean } | undefined,
  cloudRevision: string | null,
): "local" | "cloud" | "conflict" {
  if (local?.dirty && local.revision !== cloudRevision) return "conflict";
  return local && (local.dirty || local.revision === cloudRevision) ? "local" : "cloud";
}
