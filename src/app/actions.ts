"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { configured, supabase } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { requireMember } from "@/lib/auth";
const emailSchema = z.email();
function site() {
  return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}
function message(path: string, text: string): never {
  redirect(`${path}?message=${encodeURIComponent(text)}`);
}
export async function login(form: FormData) {
  if (!configured())
    message("/login", "Supabase is not configured. Follow docs/setup.md.");
  const email = emailSchema.safeParse(form.get("email"));
  const password = String(form.get("password") || "");
  if (!email.success || !password)
    message("/login", "Enter your email and password.");
  const db = await supabase();
  const { error } = await db.auth.signInWithPassword({
    email: email.data,
    password,
  });
  if (error)
    message(
      "/login",
      "Unable to sign in. Check your details or recover your password.",
    );
  redirect("/");
}
export async function logout() {
  const db = await supabase();
  await db.auth.signOut();
  redirect("/login");
}
export async function recover(form: FormData) {
  if (!configured()) message("/recover", "Supabase is not configured.");
  const email = emailSchema.safeParse(form.get("email"));
  if (!email.success) message("/recover", "Enter a valid email address.");
  const db = await supabase();
  await db.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${site()}/settings/password`,
  });
  message(
    "/recover",
    "If an account exists, a recovery email will arrive shortly.",
  );
}
export async function setPassword(form: FormData) {
  const password = z.string().min(12).max(128).safeParse(form.get("password"));
  if (!password.success)
    message(
      "/settings/password",
      "Use a password between 12 and 128 characters.",
    );
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await db.auth.updateUser({ password: password.data });
  if (error)
    message(
      "/settings/password",
      "Could not update your password. Request a new recovery link.",
    );
  redirect("/");
}
export async function sendInvite(form: FormData) {
  const { db } = await requireMember(true);
  const email = emailSchema.safeParse(form.get("email"));
  if (!email.success) message("/admin", "Enter a valid email address.");
  const { data: id, error } = await db.rpc("issue_invitation", {
    target_email: email.data,
  });
  if (error)
    message(
      "/admin",
      "An active invitation may already exist for this address.",
    );
  const { error: sendError } = await adminClient().auth.admin.inviteUserByEmail(
    email.data,
    { redirectTo: `${site()}/auth/callback` },
  );
  if (sendError) {
    await db.rpc("revoke_invitation", { invitation_id: id });
    message(
      "/admin",
      "The invitation could not be delivered. Its membership invitation has been revoked.",
    );
  }
  message(
    "/admin",
    "Invitation sent. It is single-use and expires in seven days; email links may expire sooner.",
  );
}
export async function revokeInvite(form: FormData) {
  const { db } = await requireMember(true);
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) message("/admin", "Invalid invitation.");
  const { error } = await db.rpc("revoke_invitation", {
    invitation_id: id.data,
  });
  if (error) message("/admin", "Could not revoke invitation.");
  redirect("/admin");
}
export async function revokeMember(form: FormData) {
  const { db } = await requireMember(true);
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) message("/admin", "Invalid member.");
  const { error } = await db.rpc("revoke_membership", { target_user: id.data });
  if (error)
    message(
      "/admin",
      "Could not revoke membership. You cannot revoke yourself.",
    );
  redirect("/admin");
}
export async function updateProfile(form: FormData) {
  const { db, user } = await requireMember();
  const name = z
    .string()
    .trim()
    .min(1)
    .max(80)
    .safeParse(form.get("display_name"));
  if (!name.success)
    message("/settings", "Use a display name between 1 and 80 characters.");
  const { error } = await db
    .from("profiles")
    .update({ display_name: name.data })
    .eq("id", user.id);
  if (error) message("/settings", "Could not save your name.");
  message("/settings", "Your display name has been saved.");
}
