"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { configured, supabase } from "@/lib/supabase/server";
import { finishInvitation, verifyAuthenticationLink } from "@/lib/invitations";

export async function confirmEmail(
  _previous: { error: string },
  form: FormData,
): Promise<{ error: string }> {
  if (!configured()) return { error: "Gregslist is not configured yet." };
  const token = z
    .string()
    .min(32)
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/)
    .safeParse(form.get("token_hash"));
  const type = z
    .enum(["invite", "email", "recovery"])
    .safeParse(form.get("type"));
  if (!token.success || !type.success)
    return { error: "Open the complete authentication link from your email." };
  const db = await supabase();
  const { error } = await verifyAuthenticationLink(db, token.data, type.data);
  if (error) return { error };
  redirect(
    type.data === "recovery"
      ? "/settings/password"
      : await finishInvitation(db),
  );
}
