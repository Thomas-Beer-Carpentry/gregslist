import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
export const metadata: Metadata = {
  title: "Gregslist · A little closer together",
  description: "Your private community noticeboard",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Every HTML response needs its own CSP nonce; never prerender credential pages.
  await headers();
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
