/** Anthropic flags any replay of thinking text (even in the assistant role) as reasoning_extraction,
 *  so only a neutral marker says thinking happened. */
export const NOTES_OMITTED = "[Earlier thinking omitted]";
export const DIDNT_REPLY = "[Didn't reply]";
export const MAX_CONTINUATIONS = 3;
/** Explicit, non-empty opener so models never receive a blank continuation turn. */
export const CONTINUE_RESPONSE = "[Continue response]";

/** Notes are ordinary assistant text, never fabricated provider thinking blocks, and never
 *  quoted back in a user turn (that trips Anthropic's "reasoning_extraction" filter). */
export function continuationMessages(text: string, reasoning: string) {
  const content = [text.trim() ? text : DIDNT_REPLY, reasoning.trim() && NOTES_OMITTED].filter(Boolean).join("\n\n");
  return [
    { role: "assistant" as const, content },
    { role: "user" as const, content: [
      CONTINUE_RESPONSE,
      "Your previous response reached its output limit. Continue from where it stopped without repeating the partial answer, and finish with a visible answer.",
    ].join("\n\n") },
  ];
}
export const USER_NOTE = "[User note while you were working]";
export function steeringNote(notes: string[]) {
  return [USER_NOTE, ...notes, "Take this into account and carry on with the task."].join("\n\n");
}
/** Partial step stays assistant text (never blank); the steer is a plain user turn with no reasoning quoted. */
export function steeringMessages(text: string, reasoning: string, notes: string[]) {
  const content = [text.trim() ? text : "[Interrupted by user note]", reasoning.trim() && NOTES_OMITTED].filter(Boolean).join("\n\n");
  return [
    { role: "assistant" as const, content },
    { role: "user" as const, content: steeringNote(notes) },
  ];
}
