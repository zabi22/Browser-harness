import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Open Browser Harness — Private AI Studio" },
      {
        name: "description",
        content: "A self-hosted, single-owner AI studio for chatting with frontier models.",
      },
      { property: "og:title", content: "Open Browser Harness — Private AI Studio" },
      {
        property: "og:description",
        content: "A self-hosted, single-owner AI studio for chatting with frontier models.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/studio/{-$chatId}", params: { chatId: undefined } });
  },
});
