import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserPanel } from "./BrowserPanel";
import { stopBrowsers } from "@/lib/browser-engine";
const fixture = vi.hoisted(() => ({ eq: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: "fixture-owner" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => ({
      select: () => {
        const query = {
          eq: (...args: unknown[]) => {
            fixture.eq(...args);
            return query;
          },
          maybeSingle: async () => ({ data: { id: "fixture-workspace" }, error: null }),
        };
        return query;
      },
    }),
  },
}));
afterEach(async () => {
  cleanup();
  await stopBrowsers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("Browser QA controls", () => {
  it("connects the scoped UI to real adapter requests and clears observations on workspace changes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const data = JSON.parse(String(init?.body)) as { action: string };
      return Response.json({
        ...(data.action === "start"
          ? {
              sessionId: "11111111-1111-4111-8111-111111111111",
              origin: "https://owned.example",
              expiresAt: new Date(Date.now() + 60000).toISOString(),
            }
          : { output: { snapshot: "Observed fixture DOM" } }),
        receipt: {
          id: crypto.randomUUID(),
          action: data.action,
          ok: true,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const view = render(<BrowserPanel workspaceId="fixture-workspace" />);
    fireEvent.change(screen.getByLabelText("Pairing token"), { target: { value: "a".repeat(64) } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start isolated session" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start isolated session" }));
    await screen.findByText("Approved origin: https://owned.example");
    expect(fixture.eq).toHaveBeenCalledWith("user_id", "fixture-owner");
    expect(fixture.eq).toHaveBeenCalledWith("id", "fixture-workspace");
    fireEvent.click(screen.getByRole("button", { name: /^DOM$/ }));
    await screen.findByText(/Observed fixture DOM/);
    expect(fetcher).toHaveBeenCalledTimes(2);
    view.rerender(<BrowserPanel workspaceId="another-workspace" />);
    await waitFor(() => expect(screen.queryByText(/Observed fixture DOM/)).not.toBeInTheDocument());
    expect(screen.getByLabelText("Pairing token")).toHaveValue("");
  });
});
