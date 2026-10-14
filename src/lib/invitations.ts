import "server-only";

import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { adminClient } from "@/lib/supabase/admin";
import { supabase } from "@/lib/supabase/server";

const contextSchema = z.object({
  id: z.uuid(),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
const contextCookie = "gregslist-invitation";
export type InvitationContext = z.infer<typeof contextSchema>;

export function parseInvitationContext(id: unknown, token: unknown) {
  return contextSchema.safeParse({ id, token });
}
export async function saveInvitationContext(context: InvitationContext) {
  const store = await cookies();
  store.set(contextCookie, JSON.stringify(context), {
    httpOnly: true,
    sameSite: "lax",
    secure:
      new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000")
        .protocol === "https:",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}
export async function invitationContext(): Promise<InvitationContext | null> {
  const value = (await cookies()).get(contextCookie)?.value;
  if (!value) return null;
  try {
    const parsed = contextSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export async function clearInvitationContext() {
  (await cookies()).delete(contextCookie);
}

/** Verify without changing the cookie session until the account is checked. */
export async function verifyAuthenticationLink(
  db: Awaited<ReturnType<typeof supabase>>,
  token: string,
  type: "invite" | "email" | "recovery",
): Promise<{ error: string }> {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token))
    return { error: "This authentication link is invalid." };
  const {
    data: { user: previous },
  } = await db.auth.getUser();
  const verifier = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const { data, error } = await verifier.auth.verifyOtp({
    token_hash: token,
    type,
  });
  if (error || !data.user || !data.session)
    return {
      error:
        "This link is invalid, expired or already used. Request a fresh verification email or recovery link.",
    };
  if (previous && previous.id !== data.user.id) {
    await verifier.auth.signOut({ scope: "local" });
    return {
      error:
        "This link belongs to a different account. Your current account has been kept signed in. Sign out, then request a fresh email link for the intended account.",
    };
  }
  const { error: sessionError } = await db.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  return {
    error: sessionError
      ? "Your email was verified, but sign-in could not be completed. Request a fresh email link."
      : "",
  };
}

export async function sendInvitationEmail(
  email: string,
  context: InvitationContext,
): Promise<{ error: string }> {
  const verification = await adminClient().rpc("invitation_verification", {
    target_invitation: context.id,
    raw_token: context.token,
    intended_email: email,
  });
  const record = Array.isArray(verification.data)
    ? verification.data[0]
    : verification.data;
  if (verification.error || !record || typeof record.email !== "string")
    return {
      error:
        "This invitation is invalid, expired or unavailable for that email address.",
    };
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  if (record.account_exists && record.account_confirmed) {
    const db = await supabase();
    const { error } = await db.auth.signInWithOtp({
      email: record.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${origin}/auth/confirm`,
      },
    });
    return {
      error: error
        ? "The verification email could not be sent. Please try again shortly."
        : "",
    };
  }
  const { error } = await adminClient().auth.admin.inviteUserByEmail(
    record.email,
    { redirectTo: `${origin}/auth/confirm` },
  );
  return {
    error: error
      ? "The verification email could not be sent. Please try again shortly."
      : "",
  };
}

/** Runs only after Supabase has verified the account's email. Tokens stay server-side. */
export async function finishInvitation(
  db: Awaited<ReturnType<typeof supabase>>,
) {
  const context = await invitationContext();
  if (context) {
    const { error } = await db.rpc("accept_member_invitation", {
      target_invitation: context.id,
      raw_token: context.token,
    });
    if (!error) {
      await clearInvitationContext();
      return "/settings/password";
    }
    // An old copy-link context must not block a separate, valid email-delivery
    // invitation. This API never activates copy invitations without their secret.
    const emailActivation = await db.rpc("activate_membership");
    if (!emailActivation.error) {
      await clearInvitationContext();
      return "/settings/password";
    }
    return (
      "/invite?message=" +
      encodeURIComponent(
        "Your email is verified, but this invitation could not be accepted. Reopen the original invitation link or contact your administrator.",
      )
    );
  }
  const { error } = await db.rpc("activate_membership");
  if (!error) return "/settings/password";
  // A copy link's secret must never be inferred from a verified email session.
  // Keep that session so its owner can reopen their original copy link and accept.
  return (
    "/invite?message=" +
    encodeURIComponent(
      "Your email is verified. Reopen your original invitation link to accept it, or ask your administrator for a new invitation.",
    )
  );
}
