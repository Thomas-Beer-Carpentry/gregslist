import { apiMemberSession } from "@/lib/api-auth";
import { z } from "zod";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await apiMemberSession(request);
  if (!session)
    return new Response("Active membership required", { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return new Response("Not found", { status: 404 });
  const { data: photo } = await session.db
    .from("post_photos")
    .select("object_path")
    .eq("id", id)
    .single();
  if (!photo) return new Response("Not found", { status: 404 });
  const { data, error } = await session.db.storage
    .from("community-photos")
    .download(photo.object_path);
  if (error || !data) return new Response("Photo unavailable", { status: 404 });
  return new Response(data, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": 'inline; filename="community-photo.webp"',
    },
  });
}
