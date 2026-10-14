import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { memberSession } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
export const runtime = "nodejs";
function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  if (request.headers.get("origin") !== origin)
    return error("Request origin is not permitted.", 403);
  const session = await memberSession();
  if (!session) return error("Active membership required.", 401);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return error("Invalid post.");
  const { db, user } = session;
  const { data: post } = await db
    .from("posts")
    .select("author_id")
    .eq("id", id)
    .single();
  if (post?.author_id !== user.id)
    return error("Only the author can upload photos.", 403);
  const reader = request.body?.getReader();
  if (!reader) return error("Choose a photo.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const maxBody = 6 * 1024 * 1024;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBody) {
        await reader.cancel();
        return error("Photos must be no larger than 5 MB.", 413);
      }
      chunks.push(chunk.value);
    }
  } catch {
    return error("Upload was interrupted. Please try again.");
  }
  let file: File;
  try {
    const multipart = new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") || "" },
      body: Buffer.concat(chunks),
    });
    const entry = (await multipart.formData()).get("photo");
    if (!(entry instanceof File)) return error("Choose a photo.");
    file = entry;
  } catch {
    return error("The photo upload could not be read.");
  }
  if (file.size === 0 || file.size > 5 * 1024 * 1024)
    return error("Photos must be between 1 byte and 5 MB.", 413);
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return error("Choose a JPEG, PNG or WebP photo.");
  let bytes: Buffer;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const jpeg =
      input.length >= 3 &&
      input[0] === 0xff &&
      input[1] === 0xd8 &&
      input[2] === 0xff;
    const png = input
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp =
      input.length >= 12 &&
      input.toString("ascii", 0, 4) === "RIFF" &&
      input.toString("ascii", 8, 12) === "WEBP";
    if (!jpeg && !png && !webp)
      return error("This file is not a valid JPEG, PNG or WebP photo.");
    const image = sharp(input, { limitInputPixels: 20000000, animated: false });
    const metadata = await image.metadata();
    if (
      !["jpeg", "png", "webp"].includes(metadata.format || "") ||
      (metadata.pages || 1) > 1
    )
      return error("Choose a still JPEG, PNG or WebP photo.");
    bytes = await image
      .rotate()
      .resize({
        width: 1920,
        height: 1920,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return error(
      "This file is not a valid photo, or it is too large to process.",
    );
  }
  const objectPath = `${user.id}/${id}/${randomUUID()}.webp`;
  const admin = adminClient();
  const { error: uploadError } = await admin.storage
    .from("community-photos")
    .upload(objectPath, bytes, { contentType: "image/webp", upsert: false });
  if (uploadError)
    return error("Photo storage is unavailable. Please try again.", 503);
  const { data: photoId, error: attachError } = await db.rpc(
    "attach_post_photo",
    { target_post: id, object_name: objectPath },
  );
  if (attachError) {
    const { error: removeError } = await admin.storage
      .from("community-photos")
      .remove([objectPath]);
    if (removeError)
      await admin.from("photo_cleanup").upsert({ object_path: objectPath });
    return error(
      "Could not add this photo. A post can have up to six photos.",
      409,
    );
  }
  return NextResponse.json(
    { id: photoId },
    { status: 201, headers: { "Cache-Control": "private, no-store" } },
  );
}
