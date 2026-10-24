import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/studio/Workspace";

export const Route = createFileRoute("/_authenticated/studio/{-$chatId}")({
  head: () => ({
    meta: [
      { title: "Studio — OBH" },
      { name: "description", content: "Your private Open Browser Harness AI studio workspace." },
      { property: "og:title", content: "Studio — OBH" },
      {
        property: "og:description",
        content: "Your private Open Browser Harness AI studio workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StudioPage,
});

function StudioPage() {
  const { chatId } = Route.useParams();
  return <Workspace chatId={chatId} />;
}
