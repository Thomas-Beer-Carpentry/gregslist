"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { configured, supabase } from "@/lib/supabase/server";
import {
  parseInvitationContext,
  saveInvitationContext,
  clearInvitationContext,
  sendInvitationEmail,
} from "@/lib/invitations";

type InvitationState = { error: string; message: string };
export async function requestInvitationVerification(
  _previous: InvitationState,
  form: FormData,
): Promise<InvitationState> {
  if (!configured())
    return { error: "Gregslist is not configured yet.", message: "" };
  const context = parseInvitationContext(form.get("id"), form.get("token"));
  const email = z.email().max(254).safeParse(form.get("email"));
  if (!context.success || !email.success)
    return {
      error: "Open a valid invitation and enter its intended email address.",
      message: "",
    };
  // Persist the bearer context only in an HttpOnly cookie. The database validates
  // it again when accepting; neither cookie contents nor submitted IDs confer access.
  const { error } = await sendInvitationEmail(email.data, context.data);
  if (error) return { error, message: "" };
  await saveInvitationContext(context.data);
  return {
    error: "",
    message:
      "Check your email for a verification link. Open it in this browser to finish joining Gregslist. The invitation remains valid for seven days; verification links expire sooner.",
  };
}

export async function acceptInvitation(
  _previous: InvitationState,
  form: FormData,
): Promise<InvitationState> {
  if (!configured())
    return { error: "Gregslist is not configured yet.", message: "" };
  const context = parseInvitationContext(form.get("id"), form.get("token"));
  if (!context.success)
    return { error: "Open your original valid invitation link.", message: "" };
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user || !user.email_confirmed_at)
    return {
      error:
        "Verify the intended email address before accepting this invitation.",
      message: "",
    };
  const { error } = await db.rpc("accept_member_invitation", {
    target_invitation: context.data.id,
    raw_token: context.data.token,
  });
  if (error)
    return {
      error:
        "This invitation could not be accepted. Check that you are using its intended email address and that the invitation is still valid.",
      message: "",
    };
  await clearInvitationContext();
  redirect("/");
}
