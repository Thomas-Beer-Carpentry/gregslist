// Web authentication is exclusively server-side. Native sessions use the
// separate device secure-store adapter and never need browser-readable cookies.
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: (process.env.NEXT_PUBLIC_SITE_URL || "").startsWith("https://"),
  };
}
