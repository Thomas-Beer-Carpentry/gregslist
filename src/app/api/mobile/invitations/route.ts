import { NextResponse } from "next/server";
import { z } from "zod";
import { apiMemberSession, boundedJson } from "@/lib/api-auth";
import { sendInvitationEmail } from "@/lib/invitations";

export const runtime = "nodejs";
function result(body: Record<string, string>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function POST(request: Request) {
  if (!request.headers.has("authorization"))
    return result({ error: "An administrator access token is required." }, 401);
  const session = await apiMemberSession(request, true);
  if (!session)
    return result({ error: "Active administrator access is required." }, 403);
  let input;
  try {
    input = z
      .object({ email: z.email().max(254) })
      .strict()
      .safeParse(await boundedJson(request));
  } catch {
    return result({ error: "Enter a valid email address." }, 400);
  }
  if (!input.success)
    return result({ error: "Enter a valid email address." }, 400);
  const { data, error } = await session.db.rpc("create_member_invitation", {
    target_email: input.data.email,
    delivery: "email",
  });
  if (error || !data)
    return result(
      {
        error:
          "Could not create an invitation. Check for an existing member or pending invitation and your administrator access.",
      },
      409,
    );
  const sent = await sendInvitationEmail(
    input.data.email,
    { id: data.id, token: data.token },
    session.db,
  );
  if (sent.error) {
    const revoked = await session.db.rpc("revoke_invitation", {
      invitation_id: data.id,
    });
    return result(
      {
        error: revoked.error
          ? "The email could not be sent. An administrator must review and revoke the pending invitation before retrying."
          : "The email could not be sent; its invitation has been revoked. Check email settings or create a copy link.",
      },
      503,
    );
  }
  return result(
    {
      id: data.id,
      message:
        "Invitation sent. The membership invitation expires in seven days; its verification email link expires sooner.",
    },
    201,
  );
}
