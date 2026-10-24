import { z } from "zod";
const toolName = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const identifier = z.string().min(1).max(300);
const toolCallSchema = z.object({
  id: identifier,
  name: toolName,
  args: z.string().max(1_000_000),
  meta: z.unknown().optional(),
});
const messageSchema = z
  .object({
    role: z.enum(["user", "assistant", "tool"]),
    content: z.string().max(2_000_000),
    images: z
      .array(
        z
          .string()
          .max(8_000_000)
          .regex(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/),
      )
      .max(20)
      .optional(),
    toolCalls: z.array(toolCallSchema).max(128).optional(),
    toolCallId: identifier.optional(),
    name: toolName.optional(),
  })
  .superRefine((message, context) => {
    if (message.role === "tool" && !message.toolCallId)
      context.addIssue({ code: "custom", message: "Tool result requires its call ID" });
    if (message.role !== "assistant" && message.toolCalls?.length)
      context.addIssue({
        code: "custom",
        message: "Only assistant messages can contain tool calls",
      });
    if (message.role !== "user" && message.images?.length)
      context.addIssue({ code: "custom", message: "Images belong in user messages" });
  });
const toolSchema = z.object({
  name: toolName,
  description: z.string().max(16000).optional(),
  parameters: z.record(z.unknown()).optional(),
});
export const chatRequestSchema = z
  .object({
    model: z.string().min(1).max(200),
    system: z.string().max(1_000_000).optional(),
    messages: z.array(messageSchema).min(1).max(1000),
    tools: z.array(toolSchema).max(128).optional(),
    params: z
      .object({
        temperature: z.number().finite().min(0).max(2).optional(),
        maxTokens: z.number().int().min(1).max(64000).optional(),
        frequencyPenalty: z.number().finite().min(-2).max(2).optional(),
        presencePenalty: z.number().finite().min(-2).max(2).optional(),
        thinking: z.boolean().optional(),
        thinkingEffort: z.string().max(64).optional(),
      })
      .optional(),
  })
  .superRefine((body, context) => {
    const names = (body.tools ?? []).map((tool) => tool.name);
    if (new Set(names).size !== names.length)
      context.addIssue({ code: "custom", message: "Duplicate tool names" });
  });
export type InBody = z.infer<typeof chatRequestSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ToolDef = z.infer<typeof toolSchema>;
