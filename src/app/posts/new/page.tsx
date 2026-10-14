import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { NoticeboardShell } from "@/components/noticeboard-shell";
import { PostForm } from "@/features/posts/post-form";
export const dynamic = "force-dynamic";
export default async function NewPost() {
  const session = await requireMember();
  const { data, error } = await session.db
    .from("categories")
    .select("id,name,active")
    .eq("active", true)
    .order("name");
  if (error) throw new Error("Categories unavailable");
  return (
    <NoticeboardShell session={session}>
      <Link href="/">← Noticeboard</Link>
      <h1>Share something.</h1>
      <p className="muted">
        A useful offer, a small request, or a plan worth making.
      </p>
      <section className="card">
        <PostForm categories={data || []} />
      </section>
    </NoticeboardShell>
  );
}
