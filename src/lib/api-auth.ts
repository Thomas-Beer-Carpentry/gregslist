import "server-only";
import { createClient } from "@supabase/supabase-js";
import { memberSession } from "@/lib/auth";
import { configured } from "@/lib/supabase/server";

/** Native clients authenticate with their own verified Auth access token.
 * An invalid Authorization header never falls back to browser cookies. */
export async function apiMemberSession(
  request: Request,
  administrator = false,
) {
  if (!configured()) return null;
  const authorization = request.headers.get("authorization");
  if (authorization === null) {
    const session = await memberSession();
    return session && (!administrator || session.membership.role === "admin")
      ? session
      : null;
  }
  const match = /^Bearer ([A-Za-z0-9_.-]{32,8192})$/i.exec(authorization);
  if (!match) return null;
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { headers: { Authorization: `Bearer ${match[1]}` } },
    },
  );
  const {
    data: { user },
    error,
  } = await db.auth.getUser(match[1]);
  if (error || !user) return null;
  const { data: membership } = await db
    .from("memberships")
    .select("role,status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (
    membership?.status !== "active" ||
    (administrator && membership.role !== "admin")
  )
    return null;
  return { db, user, membership };
}

export async function boundedJson(
  request: Request,
  maximum = 8192,
): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Request body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new Error("Request body too large");
    }
    chunks.push(chunk.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
