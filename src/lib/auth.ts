import "server-only";
import { redirect } from "next/navigation";
import { configured, supabase } from "@/lib/supabase/server";
export async function requireMember(admin = false) {
  if (!configured()) redirect("/login?message=Local+setup+is+required");
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await db
    .from("memberships")
    .select("role,status")
    .eq("user_id", user.id)
    .single();
  if (membership?.status !== "active" || (admin && membership.role !== "admin"))
    redirect("/login?message=Active+membership+is+required");
  return { db, user, membership };
}
