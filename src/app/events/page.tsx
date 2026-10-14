import { Feed, type FeedParams } from "@/features/posts/feed";
export const dynamic = "force-dynamic";
export default async function Events({
  searchParams,
}: {
  searchParams: Promise<FeedParams>;
}) {
  return <Feed mode="events" params={await searchParams} />;
}
