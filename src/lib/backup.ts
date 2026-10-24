// Password-encrypted backups (PBKDF2 + AES-GCM, Web Crypto).
const ITER = 250_000;

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITER, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function chunkedB64(u: Uint8Array) {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface EncryptedBackup {
  app: "openchat";
  v: 1;
  salt: string;
  iv: string;
  data: string;
}

export async function encryptBackup(payload: unknown, password: string): Promise<EncryptedBackup> {
  if (!password) throw new Error("A password is required");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return {
    app: "openchat",
    v: 1,
    salt: b64(salt),
    iv: b64(iv),
    data: chunkedB64(new Uint8Array(ct)),
  };
}

export async function decryptBackup<T = unknown>(
  file: EncryptedBackup,
  password: string,
): Promise<T> {
  if (file?.app !== "openchat") throw new Error("This is not an OBH backup");
  const key = await deriveKey(password, unb64(file.salt));
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(file.iv) as BufferSource },
      key,
      unb64(file.data) as BufferSource,
    );
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    throw new Error("Wrong password or damaged backup");
  }
}
