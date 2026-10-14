import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = process.env.NEXT_PUBLIC_SITE_URL || url.origin;
  const db = await supabase();
  const token = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (!token || !["invite", "recovery"].includes(type || ""))
    return NextResponse.redirect(
      new URL("/login?message=Invalid+authentication+link", origin),
    );
  const { error } = await db.auth.verifyOtp({
    token_hash: token,
    type: type as "invite" | "recovery",
  });
  if (error)
    return NextResponse.redirect(
      new URL("/login?message=Link+invalid,+expired,+or+already+used", origin),
    );
  if (type === "invite") {
    const { error: activation } = await db.rpc("activate_membership");
    if (activation) {
      await db.auth.signOut();
      return NextResponse.redirect(
        new URL(
          "/login?message=" +
            encodeURIComponent(
              [
                "Invitation invalid",
                "Invitation revoked",
                "Invitation already used",
                "Invitation expired",
              ].includes(activation.message)
                ? activation.message +
                    ". Contact your administrator for a new invitation."
                : "This membership cannot be activated. Contact your administrator.",
            ),
          origin,
        ),
      );
    }
  }
  return NextResponse.redirect(new URL("/settings/password", origin));
}
