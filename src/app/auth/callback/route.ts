import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { finishInvitation, verifyAuthenticationLink } from "@/lib/invitations";
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = process.env.NEXT_PUBLIC_SITE_URL || url.origin;
  const db = await supabase();
  const token = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (!token || !["invite", "email", "recovery"].includes(type || ""))
    return NextResponse.redirect(
      new URL("/login?message=Invalid+authentication+link", origin),
    );
  const { error } = await verifyAuthenticationLink(
    db,
    token,
    type as "invite" | "email" | "recovery",
  );
  if (error)
    return NextResponse.redirect(
      new URL("/login?message=" + encodeURIComponent(error), origin),
    );
  return NextResponse.redirect(
    new URL(
      type === "recovery" ? "/settings/password" : await finishInvitation(db),
      origin,
    ),
  );
}
