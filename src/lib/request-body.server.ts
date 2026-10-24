export class RequestBodyError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
/** Bound bytes while reading, before parsing JSON; do not trust Content-Length alone. */
export async function readRequestJson(request: Request, maxBytes: number): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new RequestBodyError(413, "Request exceeds the size limit");
  if (!request.body) throw new RequestBodyError(400, "Missing JSON body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "",
    size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      request.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RequestBodyError(413, "Request exceeds the size limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    request.signal.throwIfAborted();
    text += decoder.decode();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new RequestBodyError(400, "Invalid JSON");
    }
  } finally {
    request.signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
