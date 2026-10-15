import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { retryAccountErasures } from "@/lib/privacy-worker.mjs";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const configured = process.env.CRON_SECRET;
  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!configured || configured.length < 32)
    return NextResponse.json(
      { error: "Maintenance authentication is not configured." },
      { status: 503 },
    );
  const expectedBytes = Buffer.from(configured);
  const suppliedBytes = Buffer.from(supplied);
  if (
    expectedBytes.length !== suppliedBytes.length ||
    !timingSafeEqual(expectedBytes, suppliedBytes)
  )
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  try {
    return NextResponse.json(await retryAccountErasures(adminClient(), 10), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Privacy cleanup requires a retry." },
      { status: 503 },
    );
  }
}
