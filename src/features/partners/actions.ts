"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
export async function managePartner(form: FormData) {
  const { db } = await requireMember();
  const intent = z
      .enum(["request", "accept", "decline", "unlink"])
      .safeParse(form.get("intent")),
    id = z.uuid().safeParse(form.get("id"));
  if (!intent.success || !id.success)
    redirect("/settings/partner?message=Choose+a+valid+member+or+request");
  const { error } =
    intent.data === "request"
      ? await db.rpc("request_partner", { target_user: id.data })
      : intent.data === "unlink"
        ? await db.rpc("unlink_partner", { target_relationship: id.data })
        : await db.rpc("respond_partner", {
            target_relationship: id.data,
            decision: intent.data,
          });
  const known = [
    "One of these accounts",
    "Only the recipient",
    "Both partners",
    "This partner request",
    "Choose another active member",
    "Partner relationship unavailable",
  ];
  const message = error
    ? known.some((p) => error.message.startsWith(p))
      ? error.message
      : "Could not update this partner link. Refresh and try again."
    : intent.data === "request"
      ? "Partner request sent. The other member must accept."
      : intent.data === "accept"
        ? "Partner link confirmed."
        : intent.data === "decline"
          ? "Partner request declined."
          : "Partner link ended. Existing reservations are unchanged.";
  revalidatePath("/settings/partner");
  revalidatePath("/", "layout");
  redirect(`/settings/partner?message=${encodeURIComponent(message)}`);
}
