import type { Attachment, Msg } from './studio-client';
import { CONTINUE_RESPONSE, DIDNT_REPLY, NOTES_OMITTED } from './reply-continuation';

export interface RunRecovery {
  ownerId: string;
  conversationId: string;
  draft: Msg;
  updatedAt: string;
  reason?: 'paused' | 'interrupted';
}
export const recoveryKey = (ownerId: string, conversationId: string) => `obh:recovery:${ownerId}:${conversationId}`;
export function recoveryMessages(draft: Msg) {
  const reasoning = draft.attachments.filter(a => a.type === 'reasoning').map(a => a.text ?? '').join('\n\n');
  const tools = draft.attachments.filter(a => a.type === 'tool').map(a => `${a.name}: ${a.output ?? 'Interrupted; outcome unknown. Verify before repeating any action.'}`).join('\n');
  return [
    // Earlier notes ride in the assistant's own turn: quoting reasoning back inside a user
    // message trips Anthropic's "reasoning_extraction" safety filter and ends the reply.
    { role: 'assistant', content: [draft.content.trim() || DIDNT_REPLY, reasoning.trim() && NOTES_OMITTED].filter(Boolean).join('\n\n') },
    { role: 'user', content: [
      CONTINUE_RESPONSE,
      'The previous run was interrupted. Pick up where it left off without repeating the partial answer. Check the state of interrupted tool actions before repeating them; do not assume they failed.',
      tools && `Previous tool activity:\n${tools}`,
    ].filter(Boolean).join('\n\n') },
  ];
}
export function inactiveAttachments(items: Attachment[]): Attachment[] {
  return items.map(a => a.type === 'tool' && a.output === undefined ? { ...a, output: 'Interrupted; outcome unknown.' } : { ...a });
}
export function partialReply(run: RunRecovery): Msg {
  return { ...run.draft, content: (run.draft.content || DIDNT_REPLY) + (run.reason === 'paused' ? '\n\n_(Paused)_' : '\n\n_(Interrupted)_'), attachments: inactiveAttachments(run.draft.attachments) };
}
export function readRecovery(storage: Pick<Storage, 'getItem'>, ownerId: string, conversationId: string): RunRecovery | null {
  try {
    const raw = storage.getItem(recoveryKey(ownerId, conversationId));
    if (!raw) return null;
    const value = JSON.parse(raw) as RunRecovery;
    if (value.ownerId !== ownerId || value.conversationId !== conversationId || value.draft?.conversation_id !== conversationId || value.draft.role !== 'assistant' || !Array.isArray(value.draft.attachments) || typeof value.draft.content !== 'string') return null;
    return value;
  } catch { return null; }
}