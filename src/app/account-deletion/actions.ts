"use server";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase/server";
import { eraseOwnAccount } from "@/features/privacy/erase";

export async function deleteOwnAccount(
  _previous: { error: string },
  form: FormData,
) {
  if (form.get("confirmation") !== "DELETE" || form.get("confirm") !== "on")
    return {
      error: "Type DELETE and confirm that you understand the effects first.",
    };
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const result = await eraseOwnAccount(
    user,
    String(form.get("password") || ""),
  );
  if (result.error) return { error: result.error };
  await db.auth.signOut({ scope: "local" });
  const message = result.complete
    ? "Your account and personal content have been deleted. Minimal pseudonymised arrangement and audit history expires within twelve months."
    : "Community access and visible personal content have been removed. Account or media removal is awaiting an automatic retry; deletion is not yet fully complete.";
  redirect(`/login?message=${encodeURIComponent(message)}`);
}
