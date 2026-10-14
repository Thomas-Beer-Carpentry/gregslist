import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Gregslist · A little closer together",
  description: "Your private community noticeboard",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
