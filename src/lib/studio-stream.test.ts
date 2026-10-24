import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
import { streamChat } from './studio-client';
afterEach(() => vi.unstubAllGlobals());
describe('connection interruption detection', () => {
  it('rejects unexpected stream shutdown while preserving already delivered text and thinking', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"d":"Saved answer"}\n\ndata: {"r":"Saved thinking"}\n\n')));
    const text = vi.fn(), reasoning = vi.fn();
    await expect(streamChat({}, text, new AbortController().signal, reasoning)).rejects.toThrow('Connection interrupted');
    expect(text).toHaveBeenCalledWith('Saved answer');
    expect(reasoning).toHaveBeenCalledWith('Saved thinking');
  });
  it('accepts only explicit completed streams', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"d":"Done"}\n\ndata: [DONE]\n\n')));
    await expect(streamChat({}, vi.fn(), new AbortController().signal)).resolves.toEqual([]);
  });
});