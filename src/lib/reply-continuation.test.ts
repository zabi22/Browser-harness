import { describe as d2, it as i2, expect as e2 } from "vitest";
import { continuationMessages as cm, CONTINUE_RESPONSE as CR } from "./reply-continuation";
import { recoveryMessages as rm } from "./run-recovery";
d2("continue marker", () => {
  i2("continuation and resume turns start with [Continue response]", () => {
    e2(cm("", "")[1]!.content.startsWith(CR)).toBe(true);
    e2(
      rm({ role: "assistant", content: "", attachments: [] } as never)[1]!.content.startsWith(CR),
    ).toBe(true);
  });
});

import { steeringMessages as sm } from "./reply-continuation";
import { it as it2, expect as ex2 } from "vitest";
it2("steering never sends a blank assistant turn and keeps notes in the assistant role", () => {
  const [a, u] = sm("  ", "plan X", ["use Y"]);
  ex2(a!.content.trim().length).toBeGreaterThan(0);
  ex2(a!.content).not.toContain("plan X");
  ex2(u!.content).toContain("use Y");
  ex2(u!.content).not.toContain("plan X");
});
