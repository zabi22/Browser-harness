import { PROVIDER_BASES } from "./providers";
import type { Upstream } from "./provider-keys.server";
import { pinnedFetch } from "./public-fetch.server";

export function providerFetch(
  up: Upstream,
  path: string,
  init: { method?: string; body?: string; signal?: AbortSignal } = {},
) {
  const url = up.base + path;
  const headers = {
    ...up.headers,
    "Content-Type": "application/json",
    "Accept-Encoding": "identity",
  };
  if (
    ![
      ...Object.values(PROVIDER_BASES),
      "https://generativelanguage.googleapis.com/v1beta",
    ].includes(up.base)
  )
    return pinnedFetch(url, { ...init, headers });
  return fetch(url, { ...init, headers, redirect: "error" });
}
