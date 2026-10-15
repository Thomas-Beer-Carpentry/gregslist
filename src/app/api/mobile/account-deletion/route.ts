import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { boundedJson } from "@/lib/api-auth";
import { eraseOwnAccount } from "@/features/privacy/erase";
import { z } from "zod";
export const runtime = "nodejs";
const reply = (body: Record<string, unknown>, status: number) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function POST(request: Request) {
  const token = /^Bearer ([A-Za-z0-9_.-]{32,8192})$/i.exec(
    request.headers.get("authorization") || "",
  )?.[1];
  if (!token)
    return reply({ error: "Sign in before deleting your account." }, 401);
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const {
    data: { user },
    error,
  } = await db.auth.getUser(token);
  if (error || !user)
    return reply({ error: "Sign in again before deleting your account." }, 401);
  let input;
  try {
    input = z
      .object({
        password: z.string().min(1).max(128),
        confirmation: z.literal("DELETE"),
      })
      .strict()
      .safeParse(await boundedJson(request));
  } catch {
    return reply({ error: "Verify your password and confirm deletion." }, 400);
  }
  if (!input.success)
    return reply({ error: "Verify your password and confirm deletion." }, 400);
  const result = await eraseOwnAccount(user, input.data.password);
  if (result.error) return reply({ error: result.error }, 409);
  return reply(
    {
      complete: result.complete,
      message: result.complete
        ? "Your account and personal content have been deleted."
        : "Access and visible personal content have been removed. Remaining account/media removal is queued; deletion is not yet fully complete.",
    },
    result.complete ? 200 : 202,
  );
}
