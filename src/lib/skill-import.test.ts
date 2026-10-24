import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ upsert: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "owner-a" } } }) },
    from: () => ({
      upsert: (...args: unknown[]) => {
        mock.upsert(...args);
        return {
          select: () => ({ single: async () => ({ data: { id: "saved-skill-id" }, error: null }) }),
        };
      },
    }),
  },
}));
vi.mock("./studio-client", () => ({ authHeaders: async () => ({}) }));
import { importSkillFromUrl } from "./skills";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("unreviewed skill import", () => {
  it("saves real IDs, disables imported instructions and does not execute their contents", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          text: "---\nname: example\ndescription: Example instructions\n---\nUntrusted instructions cannot grant tool permissions.",
        }),
      ),
    );
    const result = await importSkillFromUrl("https://github.com/example/repo/blob/main/SKILL.md");
    expect(result).toMatchObject({ id: "saved-skill-id", enabled: false });
    expect(mock.upsert.mock.calls[0]?.[0]).toMatchObject({ user_id: "owner-a", enabled: false });
  });
});
