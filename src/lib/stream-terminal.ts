export function streamTerminal(provider: string, value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  if (provider === "openai")
    return ["response.completed", "response.incomplete", "response.failed", "error"].includes(
      String(event["type"]),
    );
  if (provider === "anthropic")
    return event["type"] === "message_stop" || event["type"] === "error";
  const first: unknown = Array.isArray(event["choices"]) ? event["choices"][0] : undefined;
  if (!first || typeof first !== "object") return false;
  const reason = (first as Record<string, unknown>)["finish_reason"];
  return typeof reason === "string" && reason.length > 0;
}
