/** Read bounded SSE data frames, including CRLF and fragmented UTF-8. Always release/cancel the reader. */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  maxEventChars = 2_000_000,
): AsyncGenerator<string> {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    data: string[] = [],
    eventChars = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        eventChars += line.length;
        if (eventChars > maxEventChars) throw new Error("Stream event exceeds the size limit");
        if (!line) {
          if (data.length) yield data.join("\n");
          data = [];
          eventChars = 0;
        } else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (buffer.length + eventChars > maxEventChars)
        throw new Error("Stream event exceeds the size limit");
    }
    // EOF does not complete a partially framed event. Callers require a terminal provider event.
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
