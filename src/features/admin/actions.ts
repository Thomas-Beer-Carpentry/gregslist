"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { sendInvitationEmail } from "@/lib/invitations";

type InvitationResult = { error: string; message: string; link: string };
const empty: InvitationResult = { error: "", message: "", link: "" };
function message(text: string): never {
  redirect(`/admin?message=${encodeURIComponent(text)}`);
}
function refresh() {
  revalidatePath("/admin");
  revalidatePath("/members");
  revalidatePath("/");
}
export async function createInvitation(
  _previous: InvitationResult,
  form: FormData,
): Promise<InvitationResult> {
  const { db } = await requireMember(true);
  const email = z.email().max(254).safeParse(form.get("email"));
  const delivery = z.enum(["email", "copy"]).safeParse(form.get("delivery"));
  if (!email.success || !delivery.success)
    return {
      ...empty,
      error: "Enter a valid email address and delivery option.",
    };
  const { data, error } = await db.rpc("create_member_invitation", {
    target_email: email.data,
    delivery: delivery.data,
  });
  if (error || !data)
    return {
      ...empty,
      error:
        "Could not create an invitation. Check for an existing member or pending invitation, and your administrator access.",
    };
  if (delivery.data === "email") {
    const sent = await sendInvitationEmail(email.data, {
      id: data.id,
      token: data.token,
    });
    if (sent.error) {
      const revoked = await db.rpc("revoke_invitation", {
        invitation_id: data.id,
      });
      refresh();
      return {
        ...empty,
        error: revoked.error
          ? "The email could not be sent. Review and revoke the pending invitation before trying again."
          : "The email could not be sent; this invitation was revoked. Check Supabase email settings, or create a copy link.",
      };
    }
    refresh();
    return {
      ...empty,
      message:
        "Invitation sent. Membership invitations expire after seven days; email verification links expire sooner.",
    };
  }
  refresh();
  const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return {
    ...empty,
    message:
      "Invitation created. Copy this link now and share it privately with the intended recipient. It expires after seven days.",
    link: `${site}/invite#id=${encodeURIComponent(data.id)}&token=${encodeURIComponent(data.token)}`,
  };
}
export async function revokeInvitation(form: FormData) {
  const { db } = await requireMember(true);
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) message("Invalid invitation.");
  const { error } = await db.rpc("revoke_invitation", {
    invitation_id: id.data,
  });
  if (error)
    message("Could not revoke this invitation. It may already be accepted.");
  refresh();
  message("Invitation revoked.");
}
export async function manageMembership(form: FormData) {
  const { db } = await requireMember(true);
  const id = z.uuid().safeParse(form.get("id"));
  const intent = z
    .enum(["suspend", "reactivate", "remove"])
    .safeParse(form.get("intent"));
  if (!id.success || !intent.success) message("Invalid membership change.");
  if (intent.data !== "reactivate" && form.get("confirm") !== "on")
    message(
      "Confirm that you understand the event, ride and access changes first.",
    );
  const statuses = {
    suspend: "suspended",
    reactivate: "active",
    remove: "removed",
  };
  const { error } = await db.rpc("set_member_status", {
    target_user: id.data,
    new_status: statuses[intent.data],
  });
  if (error)
    message(
      "Could not change access. The final administrator is protected, your own access must be changed by another administrator, and removed memberships cannot be reactivated.",
    );
  refresh();
  message(
    intent.data === "reactivate"
      ? "Community access restored. Previous events, rides, bookings and partner links remain closed."
      : "Community access changed. Relevant events, rides, bookings and partner links have been closed; history is retained.",
  );
}
export async function manageRole(form: FormData) {
  const { db } = await requireMember(true);
  const id = z.uuid().safeParse(form.get("id"));
  const role = z.enum(["member", "admin"]).safeParse(form.get("role"));
  if (!id.success || !role.success || form.get("confirm") !== "on")
    message("Confirm a valid role change first.");
  const { error } = await db.rpc("set_member_role", {
    target_user: id.data,
    new_role: role.data,
  });
  if (error)
    message(
      "Could not change this role. Only active members may become administrators, and the final active administrator is protected.",
    );
  refresh();
  message(
    "Administrator role updated. Permissions apply to the next protected operation.",
  );
}
