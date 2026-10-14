"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
export type RsvpState = { error: string; message: string };
export async function respondToEvent(
  _previous: RsvpState,
  form: FormData,
): Promise<RsvpState> {
  const { db } = await requireMember();
  const id = z.uuid().safeParse(form.get("event_id"));
  const response = z
    .enum(["going", "maybe", "not_going"])
    .safeParse(form.get("response"));
  if (!id.success || !response.success)
    return { error: "Choose a valid RSVP response.", message: "" };
  const { error } = await db.rpc("set_event_rsvp", {
    target_event: id.data,
    chosen_response: response.data,
  });
  if (error) {
    revalidatePath(`/posts/${id.data}`);
    const known = [
      "This event is full. Your previous response has been kept",
      "RSVPs are closed for this event",
      "RSVPs are closed because this event has started",
    ];
    return {
      error: known.includes(error.message)
        ? error.message
        : "Could not update your RSVP. Refresh the event and try again.",
      message: "",
    };
  }
  revalidatePath(`/posts/${id.data}`);
  revalidatePath("/events");
  revalidatePath("/");
  return {
    error: "",
    message: `Your response is ${response.data === "not_going" ? "Not Going" : response.data === "going" ? "Going" : "Maybe"}.`,
  };
}
export async function readUpdate(form: FormData) {
  const { db } = await requireMember();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) redirect("/notifications?message=Invalid+update");
  const { error } = await db.rpc("read_notification", { target_id: id.data });
  revalidatePath("/notifications");
  redirect(
    `/notifications?message=${error ? "Could+not+mark+this+update+as+read" : "Update+marked+as+read"}`,
  );
}
