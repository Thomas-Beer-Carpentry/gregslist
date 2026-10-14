import { Feed, type FeedParams } from "@/features/posts/feed";
export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<FeedParams>;
}) {
  return <Feed params={await searchParams} />;
}
